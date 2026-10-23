import { beforeEach, describe, expect, test } from "bun:test";

import { type IDBPDatabase, openDB } from "idb";

import { SNAPSHOT_LIMIT } from "@/config";
import { openStamDb } from "@/storage/db";
import { createTreeRepo, StaleWriteError, type TreeRepo } from "@/storage/treeRepo";

import { famHalfSiblings, famSimple } from "../fixtures/families";

let db: IDBPDatabase;
let repo: TreeRepo;

beforeEach(async () => {
  db = await openStamDb(`stam-test-${crypto.randomUUID()}`);
  repo = createTreeRepo(db);
});

const bound = (target: object, prop: string | symbol) => {
  const value = Reflect.get(target, prop);
  return typeof value === "function" ? value.bind(target) : value;
};

const wrapStore = (store: object) =>
  new Proxy(store, {
    get: (target, prop) =>
      prop === "put" ? () => Promise.reject(new Error("meta write failed")) : bound(target, prop),
  });

const wrapTx = (tx: object) =>
  new Proxy(tx, {
    get: (target, prop) =>
      prop === "objectStore"
        ? (name: string) => {
            const store = (target as IDBPTransactionLike).objectStore(name);
            return name === "meta" ? wrapStore(store) : store;
          }
        : bound(target, prop),
  });

/** Wraps a database so that every `put` on the `meta` store rejects. */
function failMetaPuts(real: IDBPDatabase): IDBPDatabase {
  return new Proxy(real, {
    get: (target, prop) =>
      prop === "transaction"
        ? (...args: unknown[]) =>
            wrapTx((target.transaction as (...a: unknown[]) => object)(...args))
        : bound(target, prop),
  });
}

type IDBPTransactionLike = { objectStore(name: string): object };

const at = (doc: ReturnType<typeof famSimple>, id: string, updatedAt: string) => ({
  ...doc,
  id,
  updatedAt,
});

describe("openStamDb", () => {
  test("a newer version opening in another tab closes this connection and says so (M8)", async () => {
    const name = `stam-test-${crypto.randomUUID()}`;
    let blocking = 0;
    const old = await openStamDb(name, { onBlocking: () => blocking++ });
    // Without the close, this upgrade would wait for the old tab forever.
    const newer = await openDB(name, 2);
    expect(blocking).toBe(1);
    expect(newer.version).toBe(2);
    expect(() => old.transaction("trees")).toThrow();
    newer.close();
  });

  test("an update held up by an old tab says so (M8)", async () => {
    const name = `stam-test-${crypto.randomUUID()}`;
    // An old tab that never lets go of version 1.
    const stubborn = await openDB(name, 1, {
      upgrade: (old) => void old.createObjectStore("trees", { keyPath: "id" }),
    });
    let blocked = 0;
    const opening = openStamDb(name, { onBlocked: () => blocked++ }, 2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(blocked).toBe(1);
    stubborn.close();
    const upgraded = await opening;
    expect(upgraded.version).toBe(2);
    upgraded.close();
  });

  test("creates the v1 stores", () => {
    expect([...db.objectStoreNames].toSorted()).toEqual([
      "meta",
      "photos",
      "settings",
      "snapshots",
      "trees",
    ]);
  });
});

describe("treeRepo", () => {
  test("save, list and get round-trip a tree", async () => {
    const doc = famSimple();
    await repo.saveTree(doc);

    expect(await repo.listTrees()).toEqual([
      {
        id: doc.id,
        name: doc.name,
        peopleCount: Object.keys(doc.persons).length,
        updatedAt: doc.updatedAt,
        savedAt: expect.any(Number),
      },
    ]);
    expect(await repo.getTree(doc.id)).toEqual({
      doc,
      recoveredFromSnapshot: false,
      savedAt: expect.any(Number),
    });
  });

  test("saving again replaces the tree and its meta", async () => {
    const doc = famSimple();
    await repo.saveTree(doc);
    await repo.saveTree({ ...doc, name: "Renamed", updatedAt: "2026-02-01T00:00:00.000Z" });
    const list = await repo.listTrees();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("Renamed");
    expect((await repo.getTree(doc.id))!.doc.name).toBe("Renamed");
  });

  test("saveTree stamps the meta row with savedAt, which only ever grows", async () => {
    const doc = famSimple();
    const first = await repo.saveTree(doc);
    const second = await repo.saveTree(doc);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect((await repo.getTree(doc.id))?.savedAt).toBe(second);
    expect((await repo.listTrees())[0]?.savedAt).toBe(second);
  });

  test("savedAt is the caller's capture time, but always above the previous one (N1)", async () => {
    const doc = famSimple();
    expect(await repo.saveTree(doc, { capturedAt: 5000 })).toBe(5000);
    expect((await repo.getTree(doc.id))?.savedAt).toBe(5000);
    // A capture time at or before the stored one (a clock that went back) still moves it up.
    expect(await repo.saveTree(doc, { capturedAt: 4000 })).toBe(5001);
  });

  test("a guarded save goes through when nobody saved since", async () => {
    const doc = famSimple();
    const savedAt = await repo.saveTree(doc);
    const next = await repo.saveTree({ ...doc, name: "Mine" }, { ifSavedAt: savedAt });
    expect(next).toBeGreaterThan(savedAt);
    expect((await repo.getTree(doc.id))?.doc.name).toBe("Mine");
  });

  test("a guarded save is refused when another save came in between", async () => {
    const doc = famSimple();
    const loadedAt = await repo.saveTree(doc);
    await repo.saveTree({ ...doc, name: "Other tab" });
    const stale = repo.saveTree({ ...doc, name: "Stale tab" }, { ifSavedAt: loadedAt });
    await expect(stale).rejects.toBeInstanceOf(StaleWriteError);
    await expect(stale).rejects.toMatchObject({ deleted: false });
    expect((await repo.getTree(doc.id))?.doc.name).toBe("Other tab");
    expect((await repo.listTrees())[0]?.name).toBe("Other tab");
  });

  test("a guarded save never brings a deleted tree back", async () => {
    const doc = famSimple();
    const loadedAt = await repo.saveTree(doc);
    await repo.deleteTree(doc.id);
    const stale = repo.saveTree(doc, { ifSavedAt: loadedAt });
    await expect(stale).rejects.toMatchObject({ name: "StaleWriteError", deleted: true });
    expect(await repo.getTree(doc.id)).toBeNull();
    expect(await repo.listTrees()).toEqual([]);
  });

  test("a tree saved before savedAt existed has none, and a guarded save accepts that", async () => {
    const doc = famSimple();
    await db.put("trees", doc);
    await db.put("meta", { id: doc.id, name: doc.name, peopleCount: 3, updatedAt: doc.updatedAt });
    const found = await repo.getTree(doc.id);
    expect(found?.savedAt).toBeNull();
    const savedAt = await repo.saveTree({ ...doc, name: "Upgraded" }, { ifSavedAt: null });
    expect((await repo.getTree(doc.id))?.savedAt).toBe(savedAt);
  });

  test("getTree returns null for an unknown id", async () => {
    expect(await repo.getTree("nope")).toBeNull();
  });

  test("listTrees is newest first", async () => {
    await repo.saveTree(at(famSimple(), "old", "2026-01-01T00:00:00.000Z"));
    await repo.saveTree(at(famSimple(), "new", "2026-03-01T00:00:00.000Z"));
    await repo.saveTree(at(famSimple(), "mid", "2026-02-01T00:00:00.000Z"));
    expect((await repo.listTrees()).map((t) => t.id)).toEqual(["new", "mid", "old"]);
  });

  test("deleteTree removes meta, tree and its snapshots only", async () => {
    const a = at(famSimple(), "a", "2026-01-01T00:00:00.000Z");
    const b = at(famSimple(), "b", "2026-01-02T00:00:00.000Z");
    await repo.saveTree(a);
    await repo.saveTree(b);
    await repo.takeSnapshot(a);
    await repo.takeSnapshot(b);

    await repo.deleteTree("a");

    expect(await repo.getTree("a")).toBeNull();
    expect((await repo.listTrees()).map((t) => t.id)).toEqual(["b"]);
    expect(await db.getAllFromIndex("snapshots", "treeId", "a")).toEqual([]);
    expect(await db.getAllFromIndex("snapshots", "treeId", "b")).toHaveLength(1);
  });

  test("six takeSnapshot calls keep the newest five", async () => {
    const doc = famSimple();
    for (let i = 0; i < SNAPSHOT_LIMIT + 1; i++) {
      await repo.takeSnapshot({ ...doc, name: `v${i}` });
    }
    const snapshots = await db.getAllFromIndex("snapshots", "treeId", doc.id);
    expect(snapshots).toHaveLength(SNAPSHOT_LIMIT);
    expect(snapshots.map((s) => s.doc.name)).toEqual(["v1", "v2", "v3", "v4", "v5"]);
  });

  test("takeSnapshot with ifChanged skips a document the newest snapshot already holds", async () => {
    const doc = famSimple();
    await repo.takeSnapshot(doc, { ifChanged: true });
    await repo.takeSnapshot(doc, { ifChanged: true });
    expect(await db.getAllFromIndex("snapshots", "treeId", doc.id)).toHaveLength(1);
    await repo.takeSnapshot({ ...doc, updatedAt: "2027-01-01T00:00:00.000Z" }, { ifChanged: true });
    expect(await db.getAllFromIndex("snapshots", "treeId", doc.id)).toHaveLength(2);
    // Without the option every call snapshots, as before.
    await repo.takeSnapshot(doc);
    expect(await db.getAllFromIndex("snapshots", "treeId", doc.id)).toHaveLength(3);
  });

  test("snapshot limits are per tree", async () => {
    const a = at(famSimple(), "a", "2026-01-01T00:00:00.000Z");
    const b = at(famSimple(), "b", "2026-01-01T00:00:00.000Z");
    for (let i = 0; i < 3; i++) await repo.takeSnapshot(a);
    for (let i = 0; i < 7; i++) await repo.takeSnapshot(b);
    expect(await db.getAllFromIndex("snapshots", "treeId", "a")).toHaveLength(3);
    expect(await db.getAllFromIndex("snapshots", "treeId", "b")).toHaveLength(SNAPSHOT_LIMIT);
  });

  test("getTree falls back to newest valid snapshot", async () => {
    const doc = famSimple();
    await repo.saveTree(doc);
    await repo.takeSnapshot({ ...doc, name: "older" });
    await repo.takeSnapshot({ ...doc, name: "newest valid" });

    const [unionId] = Object.keys(doc.unions);
    const u = doc.unions[unionId!]!;
    const broken = {
      ...doc,
      unions: {
        ...doc.unions,
        [unionId!]: {
          ...u,
          children: [...u.children, { personId: "ghost", type: "biological" as const }],
        },
      },
    };
    await repo.takeSnapshot(broken); // newest snapshot is itself invalid
    await db.put("trees", broken);

    const result = await repo.getTree(doc.id);
    expect(result?.recoveredFromSnapshot).toBe(true);
    expect(result?.doc.name).toBe("newest valid");
  });

  test("a failing meta write inside saveTree rolls back the tree write", async () => {
    const doc = famSimple();
    await repo.saveTree(doc);

    const failingRepo = createTreeRepo(failMetaPuts(db));
    const renamed = { ...doc, name: "Should not persist", updatedAt: "2026-06-01T00:00:00.000Z" };
    await expect(failingRepo.saveTree(renamed)).rejects.toThrow("meta write failed");

    expect((await repo.getTree(doc.id))!.doc).toEqual(doc);
    expect((await repo.listTrees())[0]!.name).toBe(doc.name);
  });

  test("getTree treats a tree from a newer schema version as unreadable", async () => {
    const doc = famSimple();
    await db.put("trees", { ...doc, schemaVersion: 2 });
    expect(await repo.getTree(doc.id)).toBeNull();
  });

  test("getTree drops unknown fields from stored trees", async () => {
    const doc = famSimple();
    await db.put("trees", { ...doc, leftover: true });
    expect((await repo.getTree(doc.id))!.doc).toEqual(doc);
  });

  test("getTree skips an unreadable record and returns null with no valid snapshot", async () => {
    await db.put("trees", { id: "junk", persons: 3 });
    expect(await repo.getTree("junk")).toBeNull();
  });

  test("duplicateTree copies under a new id and name", async () => {
    const doc = famHalfSiblings();
    await repo.saveTree(doc);
    const copy = await repo.duplicateTree(doc.id, "Copy of Shah");

    expect(copy.id).not.toBe(doc.id);
    expect(copy.name).toBe("Copy of Shah");
    expect(copy.persons).toEqual(doc.persons);
    expect(copy.unions).toEqual(doc.unions);
    expect((await repo.getTree(copy.id))!.doc).toEqual(copy);
    expect(await repo.listTrees()).toHaveLength(2);
    expect((await repo.getTree(doc.id))!.doc.name).toBe(doc.name);
  });

  test("duplicateTree rejects for an unknown id", async () => {
    await expect(repo.duplicateTree("nope", "x")).rejects.toThrow();
  });

  // Under happy-dom, fake-indexeddb's structured clone keeps only a Blob's `type` (real browsers
  // keep the bytes), so this checks that the photo is stored under its id with its type.
  test("photos are stored and read back by id", async () => {
    await repo.putPhoto("p1", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }));
    expect((await repo.getPhoto("p1"))?.type).toBe("image/png");
    expect(await db.getAllKeys("photos")).toEqual(["p1"]);
    expect(await repo.getPhoto("missing")).toBeUndefined();
  });

  test("settings round-trip", async () => {
    expect(await repo.getSetting("x")).toBeUndefined();
    await repo.setSetting("x", { a: [1, 2] });
    expect(await repo.getSetting<{ a: number[] }>("x")).toEqual({ a: [1, 2] });
  });
});
