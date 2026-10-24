import { describe, expect, test } from "bun:test";

import { connectRoom, type SocketLike } from "@/cloud/transport";

/** A socket the test drives by hand. */
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  #listeners: Record<string, ((e: never) => void)[]> = {};
  closedByClient = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, listener: (e: never) => void) {
    (this.#listeners[type] ??= []).push(listener);
  }
  #emit(type: string, e: unknown) {
    for (const l of this.#listeners[type] ?? []) l(e as never);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closedByClient = true;
  }
  open() {
    this.#emit("open", {});
  }
  receive(msg: unknown) {
    this.#emit("message", { data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.#emit("close", { code });
  }
}

function setup(opts: { shouldRetry?: () => Promise<boolean> } = {}) {
  FakeSocket.all = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const events: string[] = [];
  const room = connectRoom({
    treeId: "t1",
    token: "tok",
    handlers: {
      onOpen: () => events.push("open"),
      onMessage: (m) => events.push(`msg:${m.type}`),
      onDown: () => events.push("down"),
      onClosed: (code) => events.push(`closed:${code}`),
      shouldRetry: opts.shouldRetry ?? (async () => true),
    },
    createSocket: (url) => new FakeSocket(url),
    schedule: (fn, ms) => timers.push({ fn, ms }),
    random: () => 0.5,
  });
  return { room, timers, events, socket: () => FakeSocket.all.at(-1)! };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("room transport", () => {
  test("connects to the tree's socket with the link token", () => {
    const { socket } = setup();
    expect(socket().url).toEndWith("/api/trees/t1/ws?t=tok");
  });

  test("passes room messages on and sends while open", () => {
    const { room, socket, events } = setup();
    socket().open();
    socket().receive({ type: "welcome", version: 0 });
    room.send({ type: "hello" });
    expect(events).toEqual(["open", "msg:welcome"]);
    expect(socket().sent).toEqual(['{"type":"hello"}']);
  });

  test("reconnect backoff grows and stays between 1 and 30 seconds", async () => {
    const { timers, socket } = setup();
    socket().open();
    for (let i = 0; i < 8; i++) {
      socket().drop();
      await flush();
      timers.at(-1)!.fn();
    }
    const delays = timers.map((t) => t.ms);
    expect(delays.every((ms) => ms >= 1000 && ms <= 30_000)).toBe(true);
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
    expect(delays.at(-1)).toBe(30_000 * 0.75);
  });

  test("a closed notice ends the connection for good (4404)", async () => {
    const { timers, socket, events } = setup();
    socket().open();
    socket().receive({ type: "closed", code: 4404, reason: "tree deleted" });
    socket().drop(4404);
    await flush();
    expect(events).toContain("closed:4404");
    expect(timers).toEqual([]);
  });

  test("a socket refused before opening asks whether to retry, and stops when told no", async () => {
    let asked = 0;
    const { timers, socket, events } = setup({ shouldRetry: async () => (asked++, false) });
    socket().drop(1006);
    await flush();
    expect(asked).toBe(1);
    expect(timers).toEqual([]);
    expect(events).toEqual(["down"]);
  });

  test("stop closes the socket and never reconnects", async () => {
    const { room, timers, socket } = setup();
    socket().open();
    room.stop();
    expect(socket().closedByClient).toBe(true);
    socket().drop();
    await flush();
    expect(timers).toEqual([]);
  });
});
