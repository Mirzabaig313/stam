import { beforeEach, describe, expect, test } from "bun:test";

import { createApi } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createCloudSession, PRESENCE_EVERY_MS } from "@/cloud/cloudSession";
import { createIdentity, MAX_NAME_CHARS } from "@/cloud/identity";
import { createSessionStore } from "@/cloud/session";
import { openStamDb } from "@/storage/db";
import { type CloudMeta, createTreeRepo, type TreeRepo } from "@/storage/treeRepo";
import type { PresencePerson } from "@/sync/protocol";

import { famSimple } from "../fixtures/families";
import { fakeFetch } from "./fakeFetch";
import { fakeRoom } from "./roomFake";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
    data,
  };
}

let repo: TreeRepo;
beforeEach(async () => {
  repo = createTreeRepo(await openStamDb(`stam-test-${crypto.randomUUID()}`));
});

async function setup(cloud: CloudMeta, stored: Record<string, string> = {}) {
  const doc = famSimple();
  await repo.saveTree(doc);
  await repo.setCloud(doc.id, cloud);
  const room = fakeRoom();
  const api = createApi(fakeFetch().fetch);
  const auth = createAuthStore({
    api,
    session: createSessionStore(memory({ "stam.session": "tok" }), memory()),
  });
  const storage = memory(stored);
  const identity = createIdentity(storage);
  const timers: { fn: () => void; ms: number }[] = [];
  const presence: PresencePerson[][] = [];
  const session = createCloudSession({
    treeId: doc.id,
    cloud,
    doc,
    version: 0,
    repo,
    api,
    auth,
    identity,
    schedule: (fn, ms) => timers.push({ fn, ms }),
    handlers: {
      onView() {},
      onDropped() {},
      onStatus() {},
      onClosed() {},
      onPresence: (people) => presence.push(people),
    },
    connect: room.connect,
  });
  const runTimers = () => {
    for (const t of timers.splice(0)) t.fn();
  };
  return { doc, room, session, identity, storage, timers, runTimers, presence };
}

describe("who this browser is", () => {
  test("names are trimmed and cut to 40; Not now is remembered", () => {
    const storage = memory();
    const a = createIdentity(storage);
    a.setName(`  Ali   ${"x".repeat(60)}  `);
    expect(a.name()).toHaveLength(MAX_NAME_CHARS);
    expect(a.name()).toStartWith("Ali x");
    expect(a.skipped()).toBe(false);
    a.skip();
    expect(createIdentity(storage).skipped()).toBe(true);
  });

  test("a link user's hello says the name, and nothing that could follow the browser", async () => {
    const { room } = await setup(
      { role: "edit", token: "t", version: 0 },
      { "stam.displayName": "Sara" },
    );
    room.open();
    expect(room.state.sent[0]).toMatchObject({ type: "hello", name: "Sara" });
    expect(room.state.sent[0]).not.toHaveProperty("clientId");
  });

  test("an owner's hello never carries a typed name", async () => {
    const { room } = await setup({ role: "owner", version: 0 }, { "stam.displayName": "Typed" });
    room.open();
    expect(room.state.sent[0]).not.toHaveProperty("name");
  });

  test("naming yourself later tells the room; an owner cannot", async () => {
    const link = await setup({ role: "edit", token: "t", version: 0 });
    link.room.open();
    link.session.setName("  Zara ");
    expect(link.room.state.sent.at(-1)).toEqual({ type: "name", name: "Zara" });
    expect(link.identity.name()).toBe("Zara");
    const owner = await setup({ role: "owner", version: 0 });
    owner.room.open();
    owner.session.setName("Nope");
    expect(owner.room.state.sent.some((m) => m.type === "name")).toBe(false);
  });
});

describe("presence", () => {
  const SARA = { id: "s1", name: "Sara", kind: "link" as const, selectedPersonId: "p1" };

  test("the room's list arrives as it is, and clears when the connection drops", async () => {
    const { room, presence } = await setup({ role: "owner", version: 0 });
    room.open();
    room.receive({ type: "presence", people: [SARA] });
    expect(presence.at(-1)).toEqual([SARA]);
    room.drop();
    expect(presence.at(-1)).toEqual([]);
  });

  test("nobody shows as present once the room ends the tree or the editor stops", async () => {
    const closed = await setup({ role: "view", token: "t", version: 0 });
    closed.room.open();
    closed.room.receive({ type: "presence", people: [SARA] });
    closed.room.closed(4401);
    expect(closed.presence.at(-1)).toEqual([]);
    const stopped = await setup({ role: "owner", version: 0 });
    stopped.room.open();
    stopped.room.receive({ type: "presence", people: [SARA] });
    stopped.session.stop();
    expect(stopped.presence.at(-1)).toEqual([]);
  });

  test("selections go out at most twice a second, the latest one last", async () => {
    const { room, session, timers, runTimers } = await setup({ role: "owner", version: 0 });
    room.open();
    const sent = () => room.state.sent.filter((m) => m.type === "presence");
    session.select("a");
    session.select("b");
    session.select("c");
    expect(sent()).toEqual([{ type: "presence", selectedPersonId: "a" }]);
    expect(timers[0]!.ms).toBe(PRESENCE_EVERY_MS);
    runTimers();
    expect(sent().at(-1)).toEqual({ type: "presence", selectedPersonId: "c" });
    // That send starts a new wait: a change right after it waits too.
    session.select("d");
    expect(sent()).toHaveLength(2);
    runTimers();
    expect(sent().at(-1)).toEqual({ type: "presence", selectedPersonId: "d" });
    runTimers();
    session.select(null);
    expect(sent().at(-1)).toEqual({ type: "presence" });
  });

  test("after a reconnect the room hears the selection again", async () => {
    const { room, session } = await setup({ role: "owner", version: 0 });
    room.open();
    session.select("p9");
    room.drop();
    room.state.sent.length = 0;
    room.open();
    expect(room.state.sent).toContainEqual({ type: "presence", selectedPersonId: "p9" });
  });
});
