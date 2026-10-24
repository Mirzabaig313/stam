import { describe, expect, test } from "bun:test";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import type { Command } from "@/core/commands/types";
import type { TreeDocument } from "@/core/model/types";
import { diffDocs } from "@/sync/changes";
import type { ClientMessage, ServerMessage } from "@/sync/protocol";
import { type DroppedEdit, SyncClient } from "@/sync/syncClient";

import { famSimple } from "../fixtures/families";

const NOW = new Date("2026-03-01T00:00:00.000Z");
const owner = { kind: "owner" as const, name: "Owner" };

function setup(doc: TreeDocument = famSimple()) {
  const sent: ClientMessage[] = [];
  const views: { doc: TreeDocument; cause: string }[] = [];
  const dropped: DroppedEdit[][] = [];
  let n = 0;
  const client = new SyncClient({
    send: (m) => sent.push(m),
    onView: (d, cause) => views.push({ doc: d, cause }),
    onDropped: (d) => dropped.push(d),
    now: () => NOW,
    newOpId: () => `op${String(n++).padStart(8, "0")}`,
  });
  client.start(doc, 0);
  return { client, sent, views, dropped, doc };
}

/** What the room would broadcast for `cmd` applied to `doc` as op `opId`. */
function appliedFor(doc: TreeDocument, cmd: Command, opId: string, version: number): ServerMessage {
  const next = applyCommand(doc, cmd, { now: NOW, opId }).doc;
  return { type: "applied", version, opId, author: owner, changes: diffDocs(doc, next) };
}

const rename = (name: string): Command => ({ type: "renameTree", name });

describe("SyncClient", () => {
  test("local submit shows at once and stays pending until applied", () => {
    const { client, sent, doc } = setup();
    client.connected();
    sent.length = 0;
    const result = client.submit(rename("Mine"));
    expect(result.doc.name).toBe("Mine");
    expect(client.view.name).toBe("Mine");
    expect(client.pendingCount).toBe(1);
    expect(sent).toEqual([
      { type: "op", opId: "op00000000", cmd: { type: "renameTree", name: "Mine" } },
    ]);
    client.receive(appliedFor(doc, rename("Mine"), "op00000000", 1));
    expect(client.pendingCount).toBe(0);
    expect(client.version).toBe(1);
    expect(client.view.name).toBe("Mine");
  });

  test("remote applied rebases pending on top", () => {
    const { client, doc, views } = setup();
    const id = Object.keys(doc.persons)[0]!;
    client.submit(rename("Mine"));
    const theirs: Command = { type: "updatePerson", personId: id, patch: { notes: "theirs" } };
    client.receive(appliedFor(doc, theirs, "zzzzzzzzzz", 1));
    expect(client.view.name).toBe("Mine");
    expect(client.view.persons[id]!.notes).toBe("theirs");
    expect(client.pendingCount).toBe(1);
    expect(views.at(-1)!.cause).toBe("remote");
  });

  test("a pending op that no longer applies is dropped and reported", () => {
    const { client, doc, dropped } = setup();
    const id = Object.keys(doc.persons).at(-1)!;
    client.submit({ type: "updatePerson", personId: id, patch: { notes: "mine" } });
    client.receive(
      appliedFor(doc, { type: "deletePerson", personId: id, mode: "person" }, "zzzzzzzzzz", 1),
    );
    expect(client.pendingCount).toBe(0);
    expect(dropped).toEqual([
      [
        {
          cmd: { type: "updatePerson", personId: id, patch: { notes: "mine" } },
          code: "NOT_FOUND",
        },
      ],
    ]);
  });

  test("rejected drops the op and reports it", () => {
    const { client, dropped } = setup();
    client.submit(rename("Mine"));
    client.receive({ type: "rejected", opId: "op00000000", code: "FORBIDDEN" });
    expect(client.pendingCount).toBe(0);
    expect(client.view.name).toBe(famSimple().name);
    expect(dropped[0]![0]!.code).toBe("FORBIDDEN");
  });

  test("reconnect resends pending after hello", () => {
    const { client, sent } = setup();
    client.submit(rename("A"));
    client.submit(rename("B"));
    expect(sent).toEqual([]); // not connected yet
    client.connected();
    expect(sent.map((m) => m.type)).toEqual(["hello", "op", "op"]);
    expect(sent[0]).toEqual({ type: "hello", lastVersion: 0 });
    client.disconnected();
    sent.length = 0;
    client.connected();
    expect(sent.map((m) => m.type)).toEqual(["hello", "op", "op"]);
  });

  test("welcome with ops catches up and confirms pending ops it contains", () => {
    const { client, doc } = setup();
    client.submit(rename("Mine"));
    const op = appliedFor(doc, rename("Mine"), "op00000000", 1);
    if (op.type !== "applied") throw new Error("unreachable");
    client.receive({ type: "welcome", role: "owner", hideLiving: false, version: 1, ops: [op] });
    expect(client.pendingCount).toBe(0);
    expect(client.version).toBe(1);
  });

  test("welcome with a doc replaces the confirmed tree", () => {
    const { client } = setup();
    const other = { ...famSimple(), name: "Server" };
    client.receive({ type: "welcome", role: "view", hideLiving: true, version: 9, doc: other });
    expect(client.view.name).toBe("Server");
    expect(client.version).toBe(9);
  });

  test("an applied the client already has is ignored", () => {
    const { client, doc } = setup();
    client.receive(appliedFor(doc, rename("One"), "zzzzzzzzzz", 1));
    client.receive(appliedFor(doc, rename("Again"), "yyyyyyyyyy", 1));
    expect(client.view.name).toBe("One");
  });

  test("revert conflict is raised locally before sending", () => {
    const { client, sent, doc } = setup();
    client.connected();
    const id = Object.keys(doc.persons)[0]!;
    const mine = client.submit({
      type: "updatePerson",
      personId: id,
      patch: { firstName: "Mine" },
    });
    client.receive(
      appliedFor(
        mine.doc,
        { type: "updatePerson", personId: id, patch: { notes: "x" } },
        "zzzzzzzzzz",
        1,
      ),
    );
    sent.length = 0;
    expect(() => client.submitRevert(mine.entities, "undo")).toThrow(CommandError);
    expect(sent).toEqual([]);
  });

  test("submitRevert applies locally and sends a revert", () => {
    const { client, sent } = setup();
    client.connected();
    const mine = client.submit(rename("Mine"));
    sent.length = 0;
    client.submitRevert(mine.entities, "undo");
    expect(client.view.name).toBe(famSimple().name);
    expect(sent[0]).toMatchObject({ type: "revert", direction: "undo", entries: mine.entities });
  });
});
