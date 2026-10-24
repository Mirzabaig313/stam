import { newId } from "@/core/model/ids";
import type { TreeDocument } from "@/core/model/types";
import { isSharedId } from "@/io/json/parseTree";
import { photoIdsOf, type TreeRepo } from "@/storage/treeRepo";
import { canonicalJson } from "@/sync/changes";
import { prepareForUpload } from "@/sync/upload";

import { type Api, ApiError } from "./api";
import { connectRoom } from "./transport";

type Connect = typeof connectRoom;

/** Opens the room once to read the whole tree (a welcome without `lastVersion` carries it). */
function fetchTree(
  connect: Connect,
  treeId: string,
  token?: string,
): Promise<{ doc: TreeDocument; version: number; hideLiving: boolean }> {
  return new Promise((resolve, reject) => {
    const room = connect({
      treeId,
      ...(token ? { token } : {}),
      handlers: {
        onOpen: () => room.send({ type: "hello", pending: [] }),
        onMessage: (msg) => {
          if (msg.type !== "welcome" || !msg.doc) return;
          room.stop();
          resolve({ doc: msg.doc, version: msg.version, hideLiving: msg.hideLiving });
        },
        onDown: () => {},
        onClosed: (code) => reject(new ApiError(code === 4404 ? 404 : 401, "LINK_OFF")),
        shouldRetry: async () => {
          reject(new ApiError(0, "UNREACHABLE"));
          return false;
        },
      },
    });
  });
}

/**
 * Opens a share link (`/s/<token>`): stores the tree on this device as a link tree and returns
 * its id. The owner opening their own link keeps their tree as it is.
 */
export async function openLink(
  token: string,
  deps: { repo: TreeRepo; api: Api; connect?: Connect },
): Promise<{ treeId: string }> {
  const link = await deps.api.resolveLink(token);
  const existing = await deps.repo.getMeta(link.treeId);
  if (existing?.cloud?.role === "owner") return { treeId: link.treeId };
  const { doc, version, hideLiving } = await fetchTree(
    deps.connect ?? connectRoom,
    link.treeId,
    token,
  );
  await deps.repo.saveTree(doc);
  await deps.repo.saveConfirmed(doc.id, doc, version);
  await deps.repo.setCloud(doc.id, { role: link.role, token, hideLiving, version });
  return { treeId: doc.id };
}

/** Brings one of the signed-in owner's cloud trees to this device ("In your account"). */
export async function openOwnedTree(
  treeId: string,
  deps: { repo: TreeRepo; connect?: Connect },
): Promise<void> {
  const { doc, version } = await fetchTree(deps.connect ?? connectRoom, treeId);
  await deps.repo.saveTree(doc);
  await deps.repo.saveConfirmed(doc.id, doc, version);
  await deps.repo.setCloud(doc.id, { role: "owner", version });
}

/**
 * Uploads the given photos; returns the ids that did not upload, and remembers them in the tree's
 * cloud record so a retry is offered later.
 */
export async function retryPhotos(
  treeId: string,
  photoIds: readonly string[],
  deps: { repo: TreeRepo; api: Api },
): Promise<string[]> {
  const failed: string[] = [];
  for (const photoId of photoIds) {
    try {
      const blob = await deps.repo.getPhoto(photoId);
      if (blob) await deps.api.uploadPhoto(treeId, photoId, blob);
    } catch {
      failed.push(photoId);
    }
  }
  const cloud = (await deps.repo.getMeta(treeId))?.cloud;
  if (cloud) {
    const { failedPhotos: _old, ...rest } = cloud;
    await deps.repo.setCloud(treeId, failed.length > 0 ? { ...rest, failedPhotos: failed } : rest);
  }
  return failed;
}

/** A tree's content, ignoring key order and the time stamps. */
const contentOf = (d: TreeDocument) =>
  canonicalJson({ ...d, updatedAt: undefined, createdAt: undefined });

function sameTree(a: TreeDocument, b: TreeDocument): boolean {
  return contentOf(a) === contentOf(b);
}

/**
 * Saves a local tree to the owner's account (spec D13, and the first step of sharing): uploads
 * it, then its photos, and marks it as the owner's cloud tree. A tree whose id is taken (or not
 * usable in a shared tree) goes up as a copy under a new id, and the local copy is replaced only
 * once that upload worked. A tree already in the account takes the room's version; if this
 * device's copy differs, it is kept as a separate local tree. Returns the id to open.
 */
export async function uploadAndShare(
  local: TreeDocument,
  deps: { repo: TreeRepo; api: Api; connect?: Connect },
): Promise<{ treeId: string; failedPhotos: string[] }> {
  // The device keeps exactly what is uploaded (the editor may not have saved its last edits yet).
  let doc = prepareForUpload(local);
  await deps.repo.saveTree(doc);
  if (!isSharedId(doc.id)) doc = { ...doc, id: newId() };
  let version = 0;
  try {
    await deps.api.uploadTree(doc);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.code === "TREE_ID_TAKEN") {
      doc = { ...doc, id: newId() };
      await deps.api.uploadTree(doc);
    } else if (e.code === "ALREADY_SHARED") {
      const room = await fetchTree(deps.connect ?? connectRoom, doc.id);
      if (!sameTree(room.doc, doc)) await deps.repo.saveTree({ ...doc, id: newId() });
      doc = room.doc;
      version = room.version;
    } else {
      throw e;
    }
  }
  if (doc.id !== local.id || doc !== local) await deps.repo.saveTree(doc);
  if (doc.id !== local.id) await deps.repo.deleteTree(local.id);
  await deps.repo.saveConfirmed(doc.id, doc, version);
  await deps.repo.setCloud(doc.id, { role: "owner", version });
  const photoIds = Object.values(doc.persons).flatMap((p) => (p.photoId ? [p.photoId] : []));
  return { treeId: doc.id, failedPhotos: await retryPhotos(doc.id, photoIds, deps) };
}

/**
 * Takes the owner's tree out of their account, keeping it on this device as a local tree. Photos
 * added on other devices exist only on the server, so they are downloaded first; if one cannot
 * be, nothing is removed (the error is thrown).
 */
export async function removeFromAccount(
  treeId: string,
  deps: { repo: TreeRepo; api: Api },
): Promise<void> {
  const [stored, confirmed] = await Promise.all([
    deps.repo.getTree(treeId),
    deps.repo.getConfirmed(treeId),
  ]);
  const photoIds = new Set([
    ...(stored ? photoIdsOf(stored.doc) : []),
    ...(confirmed ? photoIdsOf(confirmed.doc) : []),
  ]);
  for (const photoId of photoIds) {
    if (await deps.repo.getPhoto(photoId)) continue;
    await deps.repo.putPhoto(photoId, await deps.api.downloadPhoto(treeId, photoId));
  }
  await deps.api.deleteCloudTree(treeId);
  await deps.repo.setCloud(treeId, null);
}
