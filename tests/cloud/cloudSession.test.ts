import { beforeEach, describe, expect, test } from "bun:test";

import { createApi } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createCloudSession } from "@/cloud/cloudSession";
import { createSessionStore } from "@/cloud/session";
import { applyCommand } from "@/core/commands/apply";
import type { TreeDocument } from "@/core/model/types";
import { openStamDb } from "@/storage/db";
import { type CloudMeta, createTreeRepo, type TreeRepo } from "@/storage/treeRepo";
import { diffDocs } from "@/sync/changes";

import { famSimple } from "../fixtures/families";
import { fakeFetch, json } from "./fakeFetch";
import { fakeRoom } from "./roomFake";

let repo: TreeRepo;
beforeEach(async () => {
  repo = createTreeRepo(await openStamDb(`stam-test-${crypto.randomUUID()}`));
});

const NOW = new Date("2026-03-01T00:00:00.000Z");

async function setup(cloud: CloudMeta, routes: Parameters<typeof fakeFetch>[0] = {}) {
  const doc = famSimple();
  await repo.saveTree(doc);
  await repo.setCloud(doc.id, cloud);
  const room = fakeRoom();
  const { fetch, calls } = fakeFetch(routes);
  const api = createApi(fetch);
  const auth = createAuthStore({
    api,
    session: createSessionStore({ getItem: () => "tok", setItem() {}, removeItem() {} }),
  });
  const views: { doc: TreeDocument; cause: string }[] = [];
  const closed: number[] = [];
  const statuses: string[] = [];
  let n = 0;
  const session = createCloudSession({
    treeId: doc.id,
    cloud,
    doc,
    version: cloud.version,
    repo,
    api,
    auth,
    handlers: {
      onView: (d, cause) => views.push({ doc: d, cause }),
      onDropped: () => {},
      onStatus: (s) => statuses.push(s),
      onClosed: (code) => closed.push(code),
    },
    connect: room.connect,
    now: () => NOW,
    newOpId: () => `op${String(n++).padStart(8, "0")}`,
  });
  return { doc, room, session, views, closed, statuses, auth, calls };
}

describe("cloud session", () => {
  test("connects, says hello, and goes live", async () => {
    const { room, session, statuses } = await setup({ role: "owner", version: 4 });
    room.open();
    expect(room.state.sent[0]).toEqual({ type: "hello", lastVersion: 4, pending: [] });
    expect(session.status).toBe("live");
    expect(statuses.at(-1)).toBe("live");
  });

  test("the confirmed version is remembered on the device", async () => {
    const { doc, room } = await setup({ role: "owner", version: 0 });
    room.open();
    room.receive({ type: "welcome", role: "owner", hideLiving: false, version: 0, ops: [] });
    const next = applyCommand(doc, { type: "renameTree", name: "New" }, { now: NOW }).doc;
    room.receive({
      type: "applied",
      version: 1,
      opId: "zzzzzzzzzz",
      author: { kind: "owner", name: "O" },
      changes: diffDocs(doc, next),
    });
    await Bun.sleep(10);
    expect(await repo.getConfirmed(doc.id)).toMatchObject({ version: 1, doc: { name: "New" } });
  });

  test("a photo added after sharing is uploaded once the room confirms it", async () => {
    const { doc, room, session, calls } = await setup(
      { role: "owner", version: 0 },
      // Only the first photo uploads; anything else is refused.
      { [`PUT /api/trees/${famSimple().id}/photos/photo00001`]: () => new Response(null) },
    );
    room.open();
    room.receive({ type: "welcome", role: "owner", hideLiving: false, version: 0, ops: [] });
    const [personId] = Object.keys(doc.persons);
    await repo.putPhoto("photo00001", new Blob(["img"]));
    await repo.putPhoto("photo00002", new Blob(["img"]));
    const cmd = {
      type: "updatePerson",
      personId: personId!,
      patch: { photoId: "photo00001" },
    } as const;
    session.submit(cmd);
    const next = applyCommand(doc, cmd, { now: NOW }).doc;
    room.receive({
      type: "applied",
      version: 1,
      opId: "op00000000",
      author: { kind: "owner", name: "O" },
      changes: diffDocs(doc, next),
    });
    await Bun.sleep(20);
    const puts = calls.filter((c) => c.method === "PUT").map((c) => c.path);
    expect(puts).toEqual([`/api/trees/${doc.id}/photos/photo00001`]);
    // A photo the upload could not send is remembered for a retry.
    const second = { ...cmd, patch: { photoId: "photo00002" } };
    session.submit(second);
    const failing = applyCommand(next, second, { now: NOW }).doc;
    room.receive({
      type: "applied",
      version: 2,
      opId: "op00000001",
      author: { kind: "owner", name: "O" },
      changes: diffDocs(next, failing),
    });
    await Bun.sleep(20);
    expect((await repo.getMeta(doc.id))?.cloud?.failedPhotos).toEqual(["photo00002"]);
  });

  test("4401 deletes the cached link tree", async () => {
    const { doc, room, closed } = await setup({ role: "view", token: "tok", version: 0 });
    room.closed(4401);
    await Bun.sleep(10);
    expect(await repo.getMeta(doc.id)).toBeUndefined();
    expect(closed).toEqual([4401]);
  });

  test("the editor is told before the cached copy is removed (so nothing saves it again)", async () => {
    const order: string[] = [];
    const deleteTree = repo.deleteTree.bind(repo);
    repo.deleteTree = async (id) => {
      order.push("delete");
      await deleteTree(id);
    };
    const { room, closed } = await setup({ role: "view", token: "tok", version: 0 });
    const push = closed.push.bind(closed);
    closed.push = (...codes) => {
      order.push("closed");
      return push(...codes);
    };
    room.closed(4401);
    await Bun.sleep(10);
    expect(order).toEqual(["closed", "delete"]);
  });

  test("a deleted tree (4404) stays on the owner's device as a local tree", async () => {
    const { doc, room } = await setup({ role: "owner", version: 0 });
    room.closed(4404);
    await Bun.sleep(10);
    const meta = await repo.getMeta(doc.id);
    expect(meta?.cloud).toBeUndefined();
    expect(meta?.id).toBe(doc.id);
  });

  test("session loss keeps pending edits; they go out after signing in again", async () => {
    const { room, session, auth } = await setup(
      { role: "owner", version: 0 },
      { "GET /api/me": () => json({ error: "SIGNED_OUT" }, 401) },
    );
    session.submit({ type: "renameTree", name: "Offline edit" });
    expect(session.pendingCount).toBe(1);
    // A 401 at reconnect: the session reports it and stops retrying until sign-in.
    expect(await room.refuse()).toBe(false);
    expect(auth.getState().status).toBe("signedOut");
    expect(session.status).toBe("signedOut");
    expect(session.pendingCount).toBe(1);
    session.reconnect();
    room.open();
    expect(room.state.sent.map((m) => m.type)).toEqual(["hello", "op"]);
  });

  test("a link that was turned off while offline removes the tree when probed", async () => {
    const { doc, room } = await setup(
      { role: "view", token: "tok", version: 0 },
      { "GET /api/s/tok": () => json({ error: "LINK_OFF" }, 404) },
    );
    expect(await room.refuse()).toBe(false);
    await Bun.sleep(10);
    expect(await repo.getMeta(doc.id)).toBeUndefined();
  });

  test("offline (the probe cannot reach the server) keeps retrying", async () => {
    const { room, session } = await setup(
      { role: "owner", version: 0 },
      {
        "GET /api/me": () => {
          throw new TypeError("offline");
        },
      },
    );
    expect(await room.refuse()).toBe(true);
    expect(session.status).toBe("offline");
  });

  test("a view link cannot edit", async () => {
    const { session } = await setup({ role: "view", token: "tok", version: 0 });
    expect(session.canEdit).toBe(false);
  });
});
