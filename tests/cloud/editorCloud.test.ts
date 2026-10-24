import { describe, expect, test } from "bun:test";

import { createApi } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createCloudSession } from "@/cloud/cloudSession";
import { applyCommand } from "@/core/commands/apply";
import type { TreeDocument } from "@/core/model/types";
import type { CloudMeta } from "@/storage/treeRepo";
import { diffDocs } from "@/sync/changes";
import { createEditorStore, type OpenCloud } from "@/ui/store/editorStore";

import { makeEditorEnv } from "../fixtures/editorEnv";
import { famSimple } from "../fixtures/families";
import { fakeFetch } from "./fakeFetch";
import { fakeRoom } from "./roomFake";

const NOW = new Date("2026-03-01T00:00:00.000Z");

async function setup(cloud: CloudMeta | null) {
  const env = await makeEditorEnv();
  const doc = famSimple();
  await env.repo.saveTree(doc);
  if (cloud) await env.repo.setCloud(doc.id, cloud);
  const room = fakeRoom();
  const api = createApi(fakeFetch().fetch);
  const auth = createAuthStore({
    api,
    storage: { getItem: () => "1", setItem() {}, removeItem() {} },
  });
  let n = 0;
  const openCloud: OpenCloud = (args) =>
    createCloudSession({
      ...args,
      repo: env.repo,
      api,
      auth,
      connect: room.connect,
      now: () => NOW,
      newOpId: () => `op${String(n++).padStart(8, "0")}`,
    });
  const store = createEditorStore({
    repo: env.repo,
    autosaver: env.autosaver,
    now: env.now,
    openCloud,
  });
  await store.getState().load(doc.id);
  return { env, doc, room, store };
}

/** What the room broadcasts for someone else's command. */
function remote(before: TreeDocument, version: number, cmd: Parameters<typeof applyCommand>[1]) {
  const after = applyCommand(before, cmd, { now: NOW }).doc;
  return {
    msg: {
      type: "applied" as const,
      version,
      opId: `zz${String(version).padStart(8, "0")}`,
      author: { kind: "link" as const, name: "Other" },
      changes: diffDocs(before, after),
    },
    after,
  };
}

const welcome = {
  type: "welcome" as const,
  role: "owner" as const,
  hideLiving: false,
  version: 0,
  ops: [],
};

describe("the editor on a cloud tree", () => {
  test("a local tree opens without a cloud session", async () => {
    const { store, room } = await setup(null);
    expect(store.getState().cloud).toBeNull();
    expect(room.state.connects).toBe(0);
  });

  test("edits go to the room; remote edits re-lay out without adding undo steps", async () => {
    const { store, room, doc } = await setup({ role: "owner", version: 0 });
    room.open();
    room.receive(welcome);
    expect(store.getState().cloud).toMatchObject({ role: "owner", status: "live" });
    store.getState().dispatch({ type: "renameTree", name: "Mine" }, "rename");
    expect(room.state.sent.at(-1)).toMatchObject({ type: "op", cmd: { type: "renameTree" } });
    const id = Object.keys(doc.persons)[0]!;
    const { msg } = remote(doc, 1, {
      type: "updatePerson",
      personId: id,
      patch: { notes: "theirs" },
    });
    room.receive(msg);
    const s = store.getState();
    expect(s.doc!.persons[id]!.notes).toBe("theirs");
    expect(s.doc!.name).toBe("Mine");
    expect(s.canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().canUndo).toBe(false); // only my rename was undoable
  });

  test("undo of an own edit sends a revert; a conflict shows CONFLICT and keeps the stack", async () => {
    const { store, room } = await setup({ role: "owner", version: 0 });
    room.open();
    room.receive(welcome);
    store.getState().dispatch({ type: "renameTree", name: "Mine" }, "rename");
    store.getState().undo();
    expect(room.state.sent.at(-1)).toMatchObject({ type: "revert", direction: "undo" });
    expect(store.getState().doc!.name).toBe(famSimple().name);
    store.getState().redo();
    expect(store.getState().doc!.name).toBe("Mine");
    // Someone renames it again: my undo no longer fits.
    const confirmedMine = applyCommand(
      famSimple(),
      { type: "renameTree", name: "Mine" },
      { now: NOW },
    ).doc;
    room.receive({
      type: "applied",
      version: 1,
      opId: "op00000000",
      author: { kind: "owner", name: "Me" },
      changes: diffDocs(famSimple(), confirmedMine),
    });
    const theirs = remote(confirmedMine, 2, { type: "renameTree", name: "Theirs" });
    room.receive(theirs.msg);
    store.getState().undo();
    expect(store.getState().error).toBe("CONFLICT");
    expect(store.getState().canUndo).toBe(true);
  });

  test("a view link ignores dispatch, undo and redo", async () => {
    const { store, room } = await setup({ role: "view", token: "tok", version: 0 });
    room.open();
    expect(store.getState().dispatch({ type: "renameTree", name: "X" }, "rename")).toBeNull();
    store.getState().undo();
    store.getState().redo();
    expect(room.state.sent.filter((m) => m.type !== "hello")).toEqual([]);
    expect(store.getState().doc!.name).toBe(famSimple().name);
  });

  test("cloud trees never lock on a second tab's cache write", async () => {
    const { store } = await setup({ role: "owner", version: 0 });
    store.getState().lock("changed");
    expect(store.getState().locked).toBeNull();
  });

  test("autosave keeps the device copy of a cloud tree", async () => {
    const { store, room, env, doc } = await setup({ role: "owner", version: 0 });
    room.open();
    room.receive(welcome);
    store.getState().dispatch({ type: "renameTree", name: "Saved" }, "rename");
    await env.autosaver.flush();
    expect((await env.repo.getTree(doc.id))?.doc.name).toBe("Saved");
    expect((await env.repo.getMeta(doc.id))?.cloud?.role).toBe("owner");
  });
});

describe("cloud trees across a reload", () => {
  test("unconfirmed edits survive a reload (e.g. the redirect to sign in again) and are sent", async () => {
    const first = await setup({ role: "owner", version: 0 });
    // Offline: the edits stay pending.
    first.store.getState().dispatch({ type: "renameTree", name: "Offline 1" }, "rename");
    first.store.getState().dispatch({ type: "renameTree", name: "Offline 2" }, "rename");
    await Bun.sleep(20);
    first.store.getState().dispose();

    const room = fakeRoom();
    const api = createApi(fakeFetch().fetch);
    const auth = createAuthStore({
      api,
      storage: { getItem: () => "1", setItem() {}, removeItem() {} },
    });
    const store = createEditorStore({
      repo: first.env.repo,
      autosaver: first.env.autosaver,
      now: first.env.now,
      openCloud: (args) =>
        createCloudSession({ ...args, repo: first.env.repo, api, auth, connect: room.connect }),
    });
    await store.getState().load(first.doc.id);
    expect(store.getState().doc!.name).toBe("Offline 2");
    room.open();
    expect(room.state.sent.map((m) => m.type)).toEqual(["hello", "op", "op"]);
    expect(room.state.sent[0]).toMatchObject({ lastVersion: 0 });
  });

  test("a remote edit confirmed just before a reload is not lost", async () => {
    const first = await setup({ role: "owner", version: 0 });
    first.room.open();
    first.room.receive(welcome);
    const { msg } = remote(first.doc, 1, { type: "renameTree", name: "Remote" });
    first.room.receive(msg);
    await Bun.sleep(20); // the autosaver has not run; the confirmed record has
    first.store.getState().dispose();
    const confirmed = await first.env.repo.getConfirmed(first.doc.id);
    expect(confirmed).toMatchObject({ version: 1, doc: { name: "Remote" } });
  });

  test("a revoked link tree is never saved again by a late autosave", async () => {
    const { store, room, env, doc } = await setup({ role: "view", token: "tok", version: 0 });
    room.open();
    room.closed(4401);
    await Bun.sleep(20);
    await env.autosaver.flush();
    expect(await env.repo.getMeta(doc.id)).toBeUndefined();
    expect(store.getState().cloud?.closed).toBe(4401);
  });
});
