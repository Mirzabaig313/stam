import { nanoid } from "nanoid";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import type { Command, CommandResult } from "@/core/commands/types";
import type { TreeDocument } from "@/core/model/types";

import { applyChanges, diffDocs } from "./changes";
import type { ClientMessage, ServerMessage } from "./protocol";
import { applyRevert, type EntityChange, entityChanges } from "./revert";
import { encodeCommand } from "./wire";

/** An edit the room has not confirmed yet. */
type PendingOp =
  | { kind: "op"; opId: string; cmd: Command }
  | { kind: "revert"; opId: string; entries: EntityChange[]; direction: "undo" | "redo" };

export type DroppedEdit = { cmd?: Command; code: string };

export type SyncClientOptions = {
  send: (msg: ClientMessage) => void;
  /** The tree to show changed: someone else's edit (`remote`), or the room confirmed ours. */
  onView: (doc: TreeDocument, cause: "remote" | "confirm") => void;
  /** Own edits that could not be applied after all, with why. */
  onDropped: (dropped: DroppedEdit[]) => void;
  now?: () => Date;
  newOpId?: () => string;
  /** Runs `fn` after `ms` (busy retries); tests pass a manual clock. */
  schedule?: (fn: () => void, ms: number) => void;
};

/**
 * One client's side of a shared tree (spec §5.4). Edits apply at once and stay pending until the
 * room confirms them; the room's edits are applied to the confirmed tree and the pending edits
 * re-run on top, so ids (derived from op ids) and results match the room's. An edit that no
 * longer applies is dropped and reported.
 */
export class SyncClient {
  #opts: Required<SyncClientOptions>;
  #confirmed!: TreeDocument;
  #version = 0;
  #pending: PendingOp[] = [];
  #view!: TreeDocument;
  #connected = false;
  /**
   * Between `hello` and `welcome`, broadcasts can reach the new socket for versions the client has
   * not caught up to; the welcome (taken after them, in the room's order) carries them instead.
   */
  #awaitingWelcome = false;
  /** Whether the confirmed tree came through a hide-living link (living people's details cut). */
  #hideLiving = false;
  /** Bumped by every connection change and busy, so a stale retry does nothing. */
  #retryGeneration = 0;

  constructor(opts: SyncClientOptions) {
    this.#opts = {
      now: () => new Date(),
      newOpId: () => nanoid(10),
      schedule: (fn, ms) => void setTimeout(fn, ms),
      ...opts,
    };
  }

  /** `hideLiving`: the cached tree was built through a hide-living link. */
  start(confirmed: TreeDocument, version: number, hideLiving = false): void {
    this.#confirmed = confirmed;
    this.#version = version;
    this.#view = confirmed;
    this.#hideLiving = hideLiving;
  }

  get view(): TreeDocument {
    return this.#view;
  }

  get version(): number {
    return this.#version;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  /** Applies a command at once and queues it for the room. Throws CommandError like `applyCommand`. */
  submit(cmd: Command): CommandResult & { entities: EntityChange[] } {
    const opId = this.#opts.newOpId();
    const before = this.#view;
    const result = applyCommand(before, cmd, { now: this.#opts.now(), opId });
    const entities = entityChanges(diffDocs(before, result.doc), before);
    this.#queue({ kind: "op", opId, cmd }, result.doc);
    return { ...result, entities };
  }

  /** Undoes or redoes one's own edit. Throws CommandError CONFLICT locally when it no longer fits. */
  submitRevert(entries: EntityChange[], direction: "undo" | "redo"): TreeDocument {
    const { doc } = applyRevert(this.#view, entries, direction, this.#opts.now());
    this.#queue({ kind: "revert", opId: this.#opts.newOpId(), entries, direction }, doc);
    return doc;
  }

  #queue(op: PendingOp, view: TreeDocument): void {
    this.#pending.push(op);
    this.#view = view;
    if (this.#connected) this.#opts.send(this.#message(op));
  }

  #message(op: PendingOp): ClientMessage {
    return op.kind === "op"
      ? { type: "op", opId: op.opId, cmd: encodeCommand(op.cmd) }
      : { type: "revert", opId: op.opId, entries: op.entries, direction: op.direction };
  }

  connected(): void {
    this.#connected = true;
    this.#hello();
    this.#resend();
  }

  disconnected(): void {
    this.#connected = false;
    this.#retryGeneration++;
  }

  /** `fresh`: ask for the whole tree instead of the ops since this client's version. */
  #hello(fresh = false): void {
    this.#awaitingWelcome = true;
    const pending = this.#pending.map((p) => p.opId);
    this.#opts.send(
      fresh ? { type: "hello", pending } : { type: "hello", lastVersion: this.#version, pending },
    );
  }

  #resend(): void {
    for (const op of this.#pending) this.#opts.send(this.#message(op));
  }

  receive(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome": {
        if (msg.ops && msg.hideLiving !== this.#hideLiving) {
          // Ops on top of a tree cut for a different link would never bring the cut details
          // back (or would keep ones this link must not show): start over from the whole tree.
          this.#hello(true);
          return;
        }
        this.#awaitingWelcome = false;
        this.#hideLiving = msg.hideLiving;
        // Edits the room already applied are confirmed now, never re-run on a tree holding them.
        const known = new Set(msg.known ?? []);
        this.#pending = this.#pending.filter((p) => !known.has(p.opId));
        if (msg.doc) this.#confirmed = msg.doc;
        const confirmedIds = new Set<string>();
        for (const op of msg.ops ?? []) {
          if (op.version <= this.#version && !msg.doc) continue;
          this.#confirmed = applyChanges(this.#confirmed, op.changes);
          confirmedIds.add(op.opId);
        }
        this.#version = msg.version;
        this.#pending = this.#pending.filter((p) => !confirmedIds.has(p.opId));
        this.#rebuild("remote");
        return;
      }
      case "applied": {
        if (this.#awaitingWelcome) return;
        if (msg.version <= this.#version) {
          // A late answer to a resend: the confirmed tree already holds this edit.
          if (this.#pending.some((p) => p.opId === msg.opId)) {
            this.#pending = this.#pending.filter((p) => p.opId !== msg.opId);
            this.#rebuild("confirm");
          }
          return;
        }
        if (msg.version !== this.#version + 1) {
          // A version went missing: ask the room to catch this client up.
          if (this.#connected) this.#hello();
          return;
        }
        this.#confirmed = applyChanges(this.#confirmed, msg.changes);
        this.#version = msg.version;
        const own = this.#pending.some((p) => p.opId === msg.opId);
        this.#pending = this.#pending.filter((p) => p.opId !== msg.opId);
        this.#rebuild(own ? "confirm" : "remote");
        return;
      }
      case "rejected": {
        const op = this.#pending.find((p) => p.opId === msg.opId);
        if (!op) return;
        this.#pending = this.#pending.filter((p) => p !== op);
        this.#opts.onDropped([{ ...(op.kind === "op" ? { cmd: op.cmd } : {}), code: msg.code }]);
        this.#rebuild("remote");
        return;
      }
      case "closed":
        // The transport ends the connection (see src/cloud/transport.ts).
        return;
      case "busy": {
        // The room refuses this socket until retryAfter, so nothing after the refused op was
        // applied: resend everything still pending, in order (ones it did apply are re-acked).
        const generation = ++this.#retryGeneration;
        this.#opts.schedule(() => {
          if (generation === this.#retryGeneration && this.#connected) this.#resend();
        }, msg.retryAfter * 1000);
        return;
      }
    }
  }

  /** The view: the confirmed tree with the pending edits re-run on top. */
  #rebuild(cause: "remote" | "confirm"): void {
    let view = this.#confirmed;
    const kept: PendingOp[] = [];
    const dropped: DroppedEdit[] = [];
    for (const op of this.#pending) {
      try {
        view =
          op.kind === "op"
            ? applyCommand(view, op.cmd, { now: this.#opts.now(), opId: op.opId }).doc
            : applyRevert(view, op.entries, op.direction, this.#opts.now()).doc;
        kept.push(op);
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
        dropped.push({ ...(op.kind === "op" ? { cmd: op.cmd } : {}), code: e.code });
      }
    }
    this.#pending = kept;
    this.#view = view;
    if (dropped.length > 0) this.#opts.onDropped(dropped);
    this.#opts.onView(view, cause);
  }
}
