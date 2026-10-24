import { beforeEach, describe, expect, test } from "bun:test";

import { createApi } from "@/cloud/api";
import { createAuthStore, HAS_SIGNED_IN } from "@/cloud/auth";
import { createCloudSession } from "@/cloud/cloudSession";
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
    storage: { getItem: () => "1", setItem() {}, removeItem() {} },
  });
  const views: { doc: TreeDocument; cause: string }[] = [];
  const closed: number[] = [];
  const statuses: string[] = [];
  let n = 0;
  const session = createCloudSession({
    treeId: doc.id,
    cloud,
    doc,
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
    expect((await repo.getMeta(doc.id))?.cloud).toEqual({ role: "owner", version: 1 });
  });

  test("4401 deletes the cached link tree", async () => {
    const { doc, room, closed } = await setup({ role: "view", token: "tok", version: 0 });
    room.closed(4401);
    await Bun.sleep(10);
    expect(await repo.getMeta(doc.id)).toBeUndefined();
    expect(closed).toEqual([4401]);
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
    expect(HAS_SIGNED_IN).toBe("stam.hasSignedIn");
  });
});
