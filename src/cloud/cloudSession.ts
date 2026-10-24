import type { Command, CommandResult } from "@/core/commands/types";
import type { TreeDocument } from "@/core/model/types";
import type { CloudMeta, TreeRepo } from "@/storage/treeRepo";
import type { EntityChange } from "@/sync/revert";
import { type DroppedEdit, SyncClient } from "@/sync/syncClient";

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
  doc: TreeDocument;
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

  const sync = new SyncClient({
    send: (msg) => room?.send(msg),
    onView: (doc, cause) => {
      void repo.setCloud(treeId, { ...cloud, version: sync.version }).catch(() => {}); // the next confirmed edit records it again
      handlers.onView(doc, cause);
      handlers.onStatus(status, sync.pendingCount);
    },
    onDropped: handlers.onDropped,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.newOpId ? { newOpId: deps.newOpId } : {}),
  });
  sync.start(deps.doc, cloud.version, cloud.hideLiving ?? false);

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
    try {
      if (cloud.role === "owner") await repo.setCloud(treeId, null);
      else await repo.deleteTree(treeId);
    } finally {
      handlers.onClosed(code);
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
  const canEdit = cloud.role === "owner" || cloud.role === "edit";
  return {
    role: cloud.role,
    canEdit,
    get status() {
      return status;
    },
    get pendingCount() {
      return sync.pendingCount;
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
