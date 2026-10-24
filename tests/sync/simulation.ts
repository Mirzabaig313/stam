import { CommandError } from "@/core/commands/errors";
import type { TreeDocument } from "@/core/model/types";
import { type ClientMessage, parseServerMessage, type Role } from "@/sync/protocol";
import type { EntityChange } from "@/sync/revert";
import { SyncClient } from "@/sync/syncClient";

import { type FamilyOp, resolveOp } from "../fixtures/arbitraries";
import { loadWasm } from "../parity/wasm";

type Harness = {
  connect(attachment: string): string;
  disconnect(socketId: string): void;
  restart(): void;
  set_catch_up_limit(ops: number): void;
  message(socketId: string, text: string, now: string, nowMs: number): string;
  doc_json(): string;
  version(): number;
};

const { RoomHarness } = loadWasm<{ RoomHarness: new (doc: string, now: string) => Harness }>(
  "stam-room",
);

export const NOW = new Date("2026-04-01T00:00:00.000Z");

export type ClientSpec = { role: Role; hideLiving?: boolean };

/** One simulated browser: its SyncClient, socket and queues. */
export class SimClient {
  sync: SyncClient;
  socket: string | null = null;
  /** Messages the client sent that the room has not handled yet. */
  outbox: string[] = [];
  /** Messages the room sent that the client has not received yet. */
  inbox: string[] = [];
  /** Every message text the room sent this client. */
  received: string[] = [];
  history: EntityChange[][] = [];
  #connections = 0;

  constructor(
    readonly name: string,
    readonly spec: ClientSpec,
    start: TreeDocument,
    newOpId: () => string,
    schedule: (fn: () => void, ms: number) => void,
  ) {
    this.sync = new SyncClient({
      send: (m: ClientMessage) => this.outbox.push(JSON.stringify(m)),
      onView: () => {},
      onDropped: () => {},
      now: () => NOW,
      newOpId,
      schedule,
    });
    this.sync.start(start, 0);
  }

  attachment(): string {
    const owner = this.spec.role === "owner";
    return JSON.stringify({
      socketId: `${this.name}-${++this.#connections}`,
      role: this.spec.role,
      linkId: owner ? undefined : "link",
      hideLiving: this.spec.hideLiving ?? false,
      author: { kind: owner ? "owner" : "link", id: this.name, name: this.name },
    });
  }
}

/** The room plus clients, with explicit message delivery so tests choose the interleaving. */
export class Simulation {
  room: Harness;
  clients: SimClient[];
  /** The room's clock, in ms: each served message moves it a little, `tick` a second. */
  #ms = 0;
  #ops = 0;
  #timers: { at: number; fn: () => void }[] = [];
  #catchUp: number;

  /** `catchUp`: how far behind a client may be and still get ops (small values force whole trees). */
  constructor(start: TreeDocument, specs: ClientSpec[], catchUp = 1000) {
    this.room = new RoomHarness(JSON.stringify(start), NOW.toISOString());
    this.#catchUp = catchUp;
    this.room.set_catch_up_limit(catchUp);
    const schedule = (fn: () => void, ms: number) => this.#timers.push({ at: this.#ms + ms, fn });
    this.clients = specs.map(
      (spec, i) =>
        new SimClient(
          `c${i}`,
          spec,
          start,
          () => `op${String(this.#ops++).padStart(8, "0")}`,
          schedule,
        ),
    );
    for (const c of this.clients) this.connect(c);
  }

  /** The Durable Object is evicted and wakes again: memory gone, storage and sockets kept. */
  restart(): void {
    this.room.restart();
    this.room.set_catch_up_limit(this.#catchUp);
  }

  /** Time passes: due retries run. */
  tick(ms = 1000): void {
    this.#ms += ms;
    const due = this.#timers.filter((t) => t.at <= this.#ms);
    this.#timers = this.#timers.filter((t) => t.at > this.#ms);
    for (const t of due) t.fn();
  }

  connect(c: SimClient): void {
    if (c.socket) return;
    c.socket = this.room.connect(c.attachment());
    c.sync.connected();
  }

  /** The connection drops: whatever was in flight either way is lost. */
  disconnect(c: SimClient): void {
    if (!c.socket) return;
    this.room.disconnect(c.socket);
    c.socket = null;
    c.outbox = [];
    c.inbox = [];
    c.sync.disconnected();
  }

  /** The room handles the oldest message from this client. */
  serve(c: SimClient): void {
    const text = c.outbox.shift();
    if (text === undefined || !c.socket) return;
    this.#ms += 5; // a burst of messages can run a socket out of tokens (busy)
    const sends = JSON.parse(this.room.message(c.socket, text, NOW.toISOString(), this.#ms)) as {
      to: string;
      text: string;
    }[];
    for (const s of sends) {
      const to = this.clients.find((x) => x.socket === s.to);
      to?.inbox.push(s.text);
      to?.received.push(s.text);
    }
  }

  /** The client receives the oldest message the room sent it. */
  deliver(c: SimClient): void {
    const text = c.inbox.shift();
    if (text !== undefined) c.sync.receive(parseServerMessage(text));
  }

  /** A random edit by an editing client (refused ones are skipped); kept for undo. */
  edit(c: SimClient, op: FamilyOp): void {
    if (c.spec.role !== "owner" && c.spec.role !== "edit") return;
    const cmd = resolveOp(c.sync.view, op);
    if (!cmd) return;
    try {
      const { entities } = c.sync.submit(cmd);
      if (entities.length > 0) c.history.push(entities);
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
    }
  }

  undo(c: SimClient): void {
    const entries = c.history.pop();
    if (!entries) return;
    try {
      c.sync.submitRevert(entries, "undo");
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
    }
  }

  /** Reconnects everyone and delivers everything until nothing moves. */
  settle(): void {
    for (const c of this.clients) this.connect(c);
    for (let round = 0; round < 1000; round++) {
      const moving = this.clients.some((c) => c.outbox.length > 0 || c.inbox.length > 0);
      if (!moving && this.#timers.length === 0) return;
      for (const c of this.clients) while (c.outbox.length > 0) this.serve(c);
      for (const c of this.clients) while (c.inbox.length > 0) this.deliver(c);
      this.tick();
    }
    throw new Error("the simulation did not settle");
  }

  serverDoc(): TreeDocument {
    return JSON.parse(this.room.doc_json()) as TreeDocument;
  }
}
