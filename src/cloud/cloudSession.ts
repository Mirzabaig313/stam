import type { Command, CommandResult } from "@/core/commands/types";
import type { TreeDocument } from "@/core/model/types";
import { type CloudMeta, photoIdsOf, type TreeRepo } from "@/storage/treeRepo";
import type { PresencePerson } from "@/sync/protocol";
import type { EntityChange } from "@/sync/revert";
import { type DroppedEdit, type PendingOp, SyncClient } from "@/sync/syncClient";

import { type Api, ApiError } from "./api";
import type { createAuthStore } from "./auth";
import { type Identity, identity as defaultIdentity } from "./identity";
import { connectRoom, type RoomConnection } from "./transport";

export type CloudStatus = "connecting" | "live" | "offline" | "signedOut" | "closed";

export type CloudSessionHandlers = {
  /** A new tree to show: someone else's edit, or the room confirming ours. */
  onView(doc: TreeDocument, cause: "remote" | "confirm"): void;
  onDropped(dropped: DroppedEdit[]): void;
  onStatus(status: CloudStatus, pendingCount: number): void;
  /** The room ended this tree for this browser: 4401 link off, 4404 deleted. */
  onClosed(code: number): void;
  /** Who else is in the tree (the room leaves this tab out), whenever it changes. */
  onPresence?(people: PresencePerson[]): void;
};

/** Selections go to the room at most this often (spec §5.3: 2 per second). */
export const PRESENCE_EVERY_MS = 500;

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
  /** Tells the others which person this user has selected (throttled). */
  select(personId: string | null): void;
  /** A link user's name: kept on this device and told to the room. */
  setName(name: string): void;
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
  identity?: Identity;
  /** Runs `fn` after `ms` (the presence throttle); tests pass a manual clock. */
  schedule?: (fn: () => void, ms: number) => void;
}): CloudSession {
  const { treeId, cloud, repo, api, auth, handlers } = deps;
  const connect = deps.connect ?? connectRoom;
  const self = deps.identity ?? defaultIdentity;
  const schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  const isLink = cloud.role !== "owner";
  /** The selection to tell the room, and whether a send is already scheduled. */
  let selected: string | null = null;
  let selectionScheduled = false;
  let live = false;
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
            if (blob) await api.uploadPhoto(treeId, photoId, blob, cloud.token);
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
    // Owners are named by their account; a link user says the name they typed, if any.
    identity: () => {
      const name = isLink ? self.name() : "";
      return name ? { name } : {};
    },
  });

  /**
   * Sends the selection, then waits half a second before the next send; changes in that time go
   * out together at its end (and start the next wait), so at most 2 sends a second.
   */
  function flushSelection() {
    sendSelection();
    const sent = selected;
    selectionScheduled = true;
    schedule(() => {
      selectionScheduled = false;
      if (selected !== sent) flushSelection();
    }, PRESENCE_EVERY_MS);
  }

  function sendSelection() {
    if (!live) return;
    room?.send(selected ? { type: "presence", selectedPersonId: selected } : { type: "presence" });
  }
  sync.start(deps.doc, deps.version, cloud.hideLiving ?? false, deps.pending ?? [], deps.epoch);

  /** The room says this browser is done with the tree. */
  async function closed(code: number) {
    room?.stop();
    room = null;
    live = false;
    sync.disconnected();
    // This browser no longer hears who is here: nobody shows as present.
    handlers.onPresence?.([]);
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
          live = true;
          // The room forgot this socket's selection with the old one.
          if (selected) sendSelection();
          setStatus("live");
        },
        onMessage: (msg) => {
          if (msg.type === "presence") {
            handlers.onPresence?.(msg.people);
            return;
          }
          sync.receive(msg);
        },
        onDown: () => {
          sync.disconnected();
          live = false;
          handlers.onPresence?.([]);
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
    select(personId) {
      if (personId === selected) return;
      selected = personId;
      if (!selectionScheduled) flushSelection();
    },
    setName(name) {
      if (!isLink) return;
      self.setName(name);
      if (live) room?.send({ type: "name", name: self.name() });
    },
    stop() {
      room?.stop();
      room = null;
      live = false;
      sync.disconnected();
      handlers.onPresence?.([]);
    },
  };
}
