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
  #retry: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: SyncClientOptions) {
    this.#opts = { now: () => new Date(), newOpId: () => nanoid(10), ...opts };
  }

  start(confirmed: TreeDocument, version: number): void {
    this.#confirmed = confirmed;
    this.#version = version;
    this.#view = confirmed;
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
    clearTimeout(this.#retry);
  }

  #hello(): void {
    this.#awaitingWelcome = true;
    this.#opts.send({ type: "hello", lastVersion: this.#version });
  }

  #resend(): void {
    for (const op of this.#pending) this.#opts.send(this.#message(op));
  }

  receive(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome": {
        this.#awaitingWelcome = false;
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
        if (this.#awaitingWelcome || msg.version <= this.#version) return;
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
      case "busy": {
        // The room is over a limit for now: everything pending is resent later (resends of edits
        // it already applied are answered, not applied twice).
        clearTimeout(this.#retry);
        this.#retry = setTimeout(() => this.#connected && this.#resend(), msg.retryAfter * 1000);
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
