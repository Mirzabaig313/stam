import type { Command, CommandResult } from "@/core/commands/types";
import type { TreeDocument } from "@/core/model/types";
import { type CloudMeta, photoIdsOf, type TreeRepo } from "@/storage/treeRepo";
import type { EntityChange } from "@/sync/revert";
import { type DroppedEdit, type PendingOp, SyncClient } from "@/sync/syncClient";

import { type Api, ApiError } from "./api";
import type { createAuthStore } from "./auth";
import { connectRoom, type RoomConnection } from "./transport";

export type CloudStatus = "connecting" | "live" | "offline" | "signedOut" | "closed";

export type CloudSessionHandlers = {
  /** A new tree to show: someone else's edit, or the room confirming ours. */
  onView(doc: TreeDocument, cause: "remote" | "confirm"): void;
  onDropped(dropped: DroppedEdit[]): void;
  onStatus(status: CloudStatus, pendingCount: number): void;
  /** The room ended this tree for this browser: 4401 link off, 4404 deleted. */
  onClosed(code: number): void;
};

export type CloudSession = {
  readonly role: CloudMeta["role"];
  readonly canEdit: boolean;
  readonly status: CloudStatus;
  readonly pendingCount: number;
  /** The tree as shown: confirmed, with the pending edits on top. */
  readonly view: TreeDocument;
  submit(cmd: Command): CommandResult & { entities: EntityChange[] };
  submitRevert(entries: EntityChange[], direction: "undo" | "redo"): TreeDocument;
  /** Connects again (after signing in again). */
  reconnect(): void;
  stop(): void;
};

/**
 * The editor's link to a shared tree (spec §5.4): edits go through a SyncClient over the room's
 * WebSocket, the confirmed version is remembered on the device, and when the room or the server
 * says this browser may no longer see the tree, the cached copy is dealt with: a link tree is
 * removed, the owner's tree stays as a local tree.
 */
export function createCloudSession(deps: {
  treeId: string;
  cloud: CloudMeta;
  /** The tree as the room last confirmed it, at `version`. */
  doc: TreeDocument;
  version: number;
  /** The share the confirmed copy belongs to. */
  epoch?: string;
  /** Unconfirmed edits kept from before a reload. */
  pending?: PendingOp[];
  repo: TreeRepo;
  api: Api;
  auth: ReturnType<typeof createAuthStore>;
  handlers: CloudSessionHandlers;
  connect?: typeof connectRoom;
  now?: () => Date;
  newOpId?: () => string;
}): CloudSession {
  const { treeId, cloud, repo, api, auth, handlers } = deps;
  const connect = deps.connect ?? connectRoom;
  let status: CloudStatus = "connecting";
  let room: RoomConnection | null = null;

  const setStatus = (next: CloudStatus) => {
    status = next;
    handlers.onStatus(status, sync.pendingCount);
  };

  const canEdit = cloud.role === "owner" || cloud.role === "edit";
  /** Photos the room's tree already had, or that this session has tried to upload. */
  const knownPhotos = new Set(photoIdsOf(deps.doc));
  let uploads = Promise.resolve();

  /**
   * Uploads photos this device added that the room has now confirmed (the room only accepts a
   * photo its tree uses). Photos not on this device were added elsewhere and are skipped; one
   * that fails to upload is remembered in `failedPhotos` for the retry in the share dialog.
   */
  function uploadNewPhotos() {
    const fresh = photoIdsOf(sync.confirmed).filter((id) => !knownPhotos.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) knownPhotos.add(id);
    uploads = uploads
      .then(async () => {
        const failed: string[] = [];
        for (const photoId of fresh) {
          try {
            const blob = await repo.getPhoto(photoId);
            if (blob) await api.uploadPhoto(treeId, photoId, blob);
          } catch {
            failed.push(photoId);
          }
        }
        if (failed.length === 0) return;
        const current = (await repo.getMeta(treeId))?.cloud;
        if (!current) return;
        const failedPhotos = [...new Set([...(current.failedPhotos ?? []), ...failed])];
        await repo.setCloud(treeId, { ...current, failedPhotos });
      })
      .catch(() => {});
  }

  const sync = new SyncClient({
    send: (msg) => room?.send(msg),
    onView: (doc, cause) => {
      if (canEdit && cause === "confirm") uploadNewPhotos();
      handlers.onView(doc, cause);
      handlers.onStatus(status, sync.pendingCount);
    },
    onDropped: handlers.onDropped,
    // What survives a reload: every unconfirmed edit, and the confirmed tree with its version
    // (written together; a write that fails is retried by the next change).
    persist: {
      add: (op) => void repo.addPending(treeId, op).catch(() => {}),
      remove: (ids) => void repo.removePending(ids).catch(() => {}),
      confirmed: (doc, version, epoch) =>
        void repo.saveConfirmed(treeId, doc, version, epoch).catch(() => {}),
    },
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.newOpId ? { newOpId: deps.newOpId } : {}),
  });
  sync.start(deps.doc, deps.version, cloud.hideLiving ?? false, deps.pending ?? [], deps.epoch);

  /** The room says this browser is done with the tree. */
  async function closed(code: number) {
    room?.stop();
    room = null;
    sync.disconnected();
    if (code === 4401 && cloud.role === "owner") {
      // The owner's session is gone: sign in again; the pending edits wait.
      auth.getState().sessionLost();
      setStatus("signedOut");
      return;
    }
    setStatus("closed");
    // The editor stops saving first, so a late autosave cannot bring the copy back.
    handlers.onClosed(code);
    try {
      if (cloud.role === "owner") await repo.setCloud(treeId, null);
      else await repo.deleteTree(treeId);
    } catch {
      // Storage failed: the next open of the tree meets the same answer and tries again.
    }
  }

  /** Why a socket would not open: offline (retry), or no access any more (stop). */
  async function shouldRetry(): Promise<boolean> {
    try {
      if (cloud.token) {
        await api.resolveLink(cloud.token);
        return true;
      }
      const me = await api.getMe();
      if (!me) {
        auth.getState().sessionLost();
        setStatus("signedOut");
        return false;
      }
      if (!me.trees.some((t) => t.id === treeId)) {
        await closed(4404);
        return false;
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && cloud.token) {
        await closed(4401);
        return false;
      }
      setStatus("offline");
      return true; // the server is out of reach: keep trying
    }
  }

  function open() {
    setStatus("connecting");
    room = connect({
      treeId,
      ...(cloud.token ? { token: cloud.token } : {}),
      handlers: {
        onOpen: () => {
          sync.connected();
          setStatus("live");
        },
        onMessage: (msg) => sync.receive(msg),
        onDown: () => {
          sync.disconnected();
          setStatus("offline");
        },
        onClosed: (code) => void closed(code),
        shouldRetry,
      },
    });
  }

  open();
  return {
    role: cloud.role,
    canEdit,
    get status() {
      return status;
    },
    get pendingCount() {
      return sync.pendingCount;
    },
    get view() {
      return sync.view;
    },
    submit(cmd) {
      const result = sync.submit(cmd);
      handlers.onStatus(status, sync.pendingCount);
      return result;
    },
    submitRevert(entries, direction) {
      const doc = sync.submitRevert(entries, direction);
      handlers.onStatus(status, sync.pendingCount);
      return doc;
    },
    reconnect() {
      room?.stop();
      open();
    },
    stop() {
      room?.stop();
      room = null;
      sync.disconnected();
    },
  };
}
