import { describe, expect, test } from "bun:test";

import { parseServerMessage } from "@/sync/protocol";
import { encodeCommand } from "@/sync/wire";

import { famSimple } from "../fixtures/families";
import { Simulation } from "./simulation";

/** Sends `text` as client `i` and returns the types of what that client gets back. */
function exchange(sim: Simulation, i: number, msg: unknown): { type: string; code?: string }[] {
  const c = sim.clients[i]!;
  c.inbox = [];
  c.outbox = [JSON.stringify(msg)];
  sim.serve(c);
  return c.inbox.map((t) => parseServerMessage(t) as { type: string; code?: string });
}

const rename = (opId: string) => ({
  type: "op",
  opId,
  cmd: encodeCommand({ type: "renameTree", name: "X" }),
});

describe("the TS protocol against the Rust room", () => {
  test("hello gets welcome, op gets applied, a bad op gets rejected with its code", () => {
    const sim = new Simulation(famSimple(), [{ role: "owner" }]);
    expect(exchange(sim, 0, { type: "hello", lastVersion: 0 }).map((m) => m.type)).toEqual([
      "welcome",
    ]);
    expect(exchange(sim, 0, rename("aaaaaaaaaa")).map((m) => m.type)).toEqual(["applied"]);
    const bad = exchange(sim, 0, {
      type: "op",
      opId: "bbbbbbbbbb",
      cmd: { type: "setRoot", personId: "ghost" },
    });
    expect(bad).toEqual([expect.objectContaining({ type: "rejected", code: "NOT_FOUND" })]);
  });

  test("a revert gets applied, and refused ones say why", () => {
    const sim = new Simulation(famSimple(), [{ role: "owner" }]);
    const name = famSimple().name;
    exchange(sim, 0, rename("aaaaaaaaaa"));
    const entries = [{ key: "tree/name", before: name, after: "X" }];
    const undo = { type: "revert", opId: "bbbbbbbbbb", entries, direction: "undo" };
    expect(exchange(sim, 0, undo).map((m) => m.type)).toEqual(["applied"]);
    const again = exchange(sim, 0, { ...undo, opId: "cccccccccc" });
    expect(again).toEqual([expect.objectContaining({ type: "rejected", code: "CONFLICT" })]);
  });

  test("a viewer's op is FORBIDDEN and a malformed message is BAD_MESSAGE", () => {
    const sim = new Simulation(famSimple(), [{ role: "owner" }, { role: "view" }]);
    expect(exchange(sim, 1, rename("aaaaaaaaaa"))).toEqual([
      expect.objectContaining({ type: "rejected", code: "FORBIDDEN" }),
    ]);
    expect(exchange(sim, 0, { type: "explode" })).toEqual([
      expect.objectContaining({ type: "rejected", code: "BAD_MESSAGE" }),
    ]);
  });

  test("parseServerMessage refuses what is not a room message", () => {
    expect(() => parseServerMessage('{"type":"nope"}')).toThrow();
    expect(() => parseServerMessage("[]")).toThrow();
  });
});
