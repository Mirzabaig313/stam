import { beforeEach, describe, expect, test } from "bun:test";

import { createApi } from "@/cloud/api";
import { openLink, openOwnedTree, retryPhotos, uploadAndShare } from "@/cloud/linkTrees";
import type { RoomConnection, RoomHandlers } from "@/cloud/transport";
import type { TreeDocument } from "@/core/model/types";
import { openStamDb } from "@/storage/db";
import { createTreeRepo, type TreeRepo } from "@/storage/treeRepo";

import { famSimple } from "../fixtures/families";
import { fakeFetch, json } from "./fakeFetch";

let repo: TreeRepo;
beforeEach(async () => {
  repo = createTreeRepo(await openStamDb(`stam-test-${crypto.randomUUID()}`));
});

/** A room that answers hello with a welcome carrying `doc` at `version`. */
function roomWith(doc: TreeDocument, version = 7) {
  const seen: { treeId: string; token?: string }[] = [];
  const connect = (opts: {
    treeId: string;
    token?: string;
    handlers: RoomHandlers;
  }): RoomConnection => {
    seen.push({ treeId: opts.treeId, ...(opts.token ? { token: opts.token } : {}) });
    queueMicrotask(() => opts.handlers.onOpen());
    return {
      send: (msg) => {
        if (msg.type === "hello") {
          opts.handlers.onMessage({
            type: "welcome",
            role: "view",
            hideLiving: true,
            version,
            doc,
          });
        }
      },
      stop: () => {},
    };
  };
  return { connect, seen };
}

describe("opening shared trees", () => {
  test("openLink stores the tree with its link meta", async () => {
    const doc = famSimple();
    const { fetch } = fakeFetch({
      "GET /api/s/tok": () =>
        json({ treeId: doc.id, role: "view", hideLiving: true, name: doc.name }),
    });
    const room = roomWith(doc);
    const { treeId } = await openLink("tok", {
      repo,
      api: createApi(fetch),
      connect: room.connect,
    });
    expect(treeId).toBe(doc.id);
    expect(room.seen).toEqual([{ treeId: doc.id, token: "tok" }]);
    expect((await repo.getTree(doc.id))?.doc.name).toBe(doc.name);
    expect((await repo.getMeta(doc.id))?.cloud).toEqual({
      role: "view",
      token: "tok",
      hideLiving: true,
      version: 7,
    });
  });

  test("the owner opening their own link keeps their tree as it is", async () => {
    const doc = famSimple();
    await repo.saveTree(doc);
    await repo.setCloud(doc.id, { role: "owner", version: 3 });
    const { fetch } = fakeFetch({
      "GET /api/s/tok": () =>
        json({ treeId: doc.id, role: "view", hideLiving: false, name: doc.name }),
    });
    await openLink("tok", { repo, api: createApi(fetch), connect: roomWith(doc).connect });
    expect((await repo.getMeta(doc.id))?.cloud).toEqual({ role: "owner", version: 3 });
  });

  test("openOwnedTree caches an account tree with owner meta", async () => {
    const doc = famSimple();
    const room = roomWith(doc, 12);
    await openOwnedTree(doc.id, { repo, connect: room.connect });
    expect(room.seen).toEqual([{ treeId: doc.id }]);
    expect((await repo.getMeta(doc.id))?.cloud).toEqual({ role: "owner", version: 12 });
  });
});

describe("uploading", () => {
  test("upload marks the tree as the owner's cloud tree and sends its photos", async () => {
    const doc = famSimple();
    const id = Object.keys(doc.persons)[0]!;
    const withPhoto = {
      ...doc,
      persons: { ...doc.persons, [id]: { ...doc.persons[id]!, photoId: "ph1" } },
    };
    await repo.saveTree(withPhoto);
    await repo.putPhoto("ph1", new Blob(["webp"]));
    const { fetch, calls } = fakeFetch({
      "POST /api/trees": () => json({ id: doc.id, version: 0 }, 201),
      [`PUT /api/trees/${doc.id}/photos/ph1`]: () => new Response(null, { status: 204 }),
    });
    const result = await uploadAndShare(withPhoto, { repo, api: createApi(fetch) });
    expect(result).toEqual({ treeId: doc.id, failedPhotos: [] });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/trees",
      `PUT /api/trees/${doc.id}/photos/ph1`,
    ]);
    expect((await repo.getMeta(doc.id))?.cloud).toEqual({ role: "owner", version: 0 });
  });

  test("upload retries under a new id after TREE_ID_TAKEN", async () => {
    const doc = famSimple();
    await repo.saveTree(doc);
    let tries = 0;
    const { fetch, calls } = fakeFetch({
      "POST /api/trees": (body) => {
        tries++;
        const sent = (body as { doc: TreeDocument }).doc;
        return tries === 1
          ? json({ error: "TREE_ID_TAKEN" }, 409)
          : json({ id: sent.id, version: 0 }, 201);
      },
    });
    const { treeId } = await uploadAndShare(doc, { repo, api: createApi(fetch) });
    expect(treeId).not.toBe(doc.id);
    expect((calls[1]!.body as { doc: TreeDocument }).doc.id).toBe(treeId);
    expect(await repo.getMeta(doc.id)).toBeUndefined(); // the old copy is replaced
    expect((await repo.getMeta(treeId))?.cloud?.role).toBe("owner");
  });

  test("photo upload failures are reported and can be retried", async () => {
    const doc = famSimple();
    const id = Object.keys(doc.persons)[0]!;
    const withPhoto = {
      ...doc,
      persons: { ...doc.persons, [id]: { ...doc.persons[id]!, photoId: "ph1" } },
    };
    await repo.saveTree(withPhoto);
    await repo.putPhoto("ph1", new Blob(["webp"]));
    let photoTries = 0;
    const { fetch } = fakeFetch({
      "POST /api/trees": () => json({ id: doc.id, version: 0 }, 201),
      [`PUT /api/trees/${doc.id}/photos/ph1`]: () =>
        new Response(null, { status: photoTries++ === 0 ? 500 : 204 }),
    });
    const api = createApi(fetch);
    const result = await uploadAndShare(withPhoto, { repo, api });
    expect(result.failedPhotos).toEqual(["ph1"]);
    expect(await retryPhotos(doc.id, result.failedPhotos, { repo, api })).toEqual([]);
  });
});

describe("uploading, when things go wrong", () => {
  test("a failed upload after a re-id leaves the local tree as it was", async () => {
    const doc = famSimple();
    await repo.saveTree(doc);
    let tries = 0;
    const { fetch } = fakeFetch({
      "POST /api/trees": () =>
        tries++ === 0 ? json({ error: "TREE_ID_TAKEN" }, 409) : json({ error: "DOWN" }, 503),
    });
    await expect(uploadAndShare(doc, { repo, api: createApi(fetch) })).rejects.toThrow();
    expect((await repo.getMeta(doc.id))?.id).toBe(doc.id);
    expect((await repo.listTrees()).map((t) => t.id)).toEqual([doc.id]);
  });

  test("ALREADY_SHARED takes the room's tree, keeping a different local copy as its own tree", async () => {
    const local = { ...famSimple(), name: "Local edits" };
    await repo.saveTree(local);
    const roomDoc = { ...famSimple(), name: "In the room" };
    const { fetch } = fakeFetch({
      "POST /api/trees": () => json({ error: "ALREADY_SHARED" }, 409),
    });
    const { treeId } = await uploadAndShare(local, {
      repo,
      api: createApi(fetch),
      connect: roomWith(roomDoc, 9).connect,
    });
    expect(treeId).toBe(local.id);
    expect((await repo.getTree(local.id))?.doc.name).toBe("In the room");
    expect(await repo.getConfirmed(local.id)).toMatchObject({ version: 9 });
    const names = (await repo.listTrees()).map((t) => t.name).toSorted();
    expect(names).toEqual(["In the room", "Local edits"]);
  });

  test("failed photos are remembered with the tree, and a retry clears them", async () => {
    const doc = famSimple();
    const id = Object.keys(doc.persons)[0]!;
    const withPhoto = {
      ...doc,
      persons: { ...doc.persons, [id]: { ...doc.persons[id]!, photoId: "ph1" } },
    };
    await repo.saveTree(withPhoto);
    await repo.putPhoto("ph1", new Blob(["webp"]));
    let ok = false;
    const { fetch } = fakeFetch({
      "POST /api/trees": () => json({ id: doc.id, version: 0 }, 201),
      [`PUT /api/trees/${doc.id}/photos/ph1`]: () => new Response(null, { status: ok ? 204 : 500 }),
    });
    const api = createApi(fetch);
    await uploadAndShare(withPhoto, { repo, api });
    expect((await repo.getMeta(doc.id))?.cloud?.failedPhotos).toEqual(["ph1"]);
    ok = true;
    await retryPhotos(doc.id, ["ph1"], { repo, api });
    expect((await repo.getMeta(doc.id))?.cloud?.failedPhotos).toBeUndefined();
  });
});
