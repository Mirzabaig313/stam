import { newId } from "@/core/model/ids";
import type { TreeDocument } from "@/core/model/types";
import { isSharedId } from "@/io/json/parseTree";
import type { TreeRepo } from "@/storage/treeRepo";
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
  await deps.repo.setCloud(doc.id, { role: "owner", version });
}

/** Uploads the photos the tree's people use; returns the ids that did not upload. */
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
  return failed;
}

/** The same tree under a new id, replacing the local copy (the old id belongs to someone else). */
async function reId(doc: TreeDocument, repo: TreeRepo): Promise<TreeDocument> {
  const copy = { ...doc, id: newId() };
  await repo.saveTree(copy);
  await repo.deleteTree(doc.id);
  return copy;
}

/**
 * Saves a local tree to the owner's account (spec D13, and the first step of sharing): uploads
 * it, then its photos, and marks it as the owner's cloud tree. A tree whose id is taken (or not
 * usable in a shared tree) is uploaded under a new id; the returned id is the one to open.
 */
export async function uploadAndShare(
  local: TreeDocument,
  deps: { repo: TreeRepo; api: Api },
): Promise<{ treeId: string; failedPhotos: string[] }> {
  let doc = prepareForUpload(local);
  if (doc !== local) await deps.repo.saveTree(doc);
  if (!isSharedId(doc.id)) doc = await reId(doc, deps.repo);
  try {
    await deps.api.uploadTree(doc);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.code === "TREE_ID_TAKEN") {
      doc = await reId(doc, deps.repo);
      await deps.api.uploadTree(doc);
    } else if (e.code !== "ALREADY_SHARED") {
      throw e;
    }
  }
  await deps.repo.setCloud(doc.id, { role: "owner", version: 0 });
  const photoIds = Object.values(doc.persons).flatMap((p) => (p.photoId ? [p.photoId] : []));
  return { treeId: doc.id, failedPhotos: await retryPhotos(doc.id, photoIds, deps) };
}
