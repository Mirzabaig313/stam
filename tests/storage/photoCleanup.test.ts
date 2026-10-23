import { beforeEach, describe, expect, test } from "bun:test";

import type { IDBPDatabase } from "idb";

import type { TreeDocument } from "@/core/model/types";
import { openStamDb } from "@/storage/db";
import { type JournalStorage, writePending } from "@/storage/journal";
import { cleanUpUnusedPhotos } from "@/storage/photoCleanup";
import { createTreeRepo, type TreeRepo } from "@/storage/treeRepo";

import { famHalfSiblings, famSimple } from "../fixtures/families";

let db: IDBPDatabase;
let repo: TreeRepo;

beforeEach(async () => {
  db = await openStamDb(`stam-test-${crypto.randomUUID()}`);
  repo = createTreeRepo(db);
});

function memoryStorage(): JournalStorage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const photo = () => new Blob(["x"], { type: "image/jpeg" });

/** `doc` with its first person wearing `photoId`. */
function withPhoto(doc: TreeDocument, photoId: string, index = 0): TreeDocument {
  const id = Object.keys(doc.persons)[index]!;
  return { ...doc, persons: { ...doc.persons, [id]: { ...doc.persons[id]!, photoId } } };
}

const storedPhotos = async () => ((await db.getAllKeys("photos")) as string[]).toSorted();

describe("repo.deleteUnusedPhotos", () => {
  test("deletes photos no tree uses and keeps the ones trees use", async () => {
    await repo.saveTree(withPhoto(famSimple(), "used-a"));
    await repo.saveTree(withPhoto({ ...famHalfSiblings(), id: "other" }, "used-b", 1));
    for (const id of ["used-a", "used-b", "orphan-1", "orphan-2"]) await repo.putPhoto(id, photo());

    expect(await repo.deleteUnusedPhotos()).toBe(2);
    expect(await storedPhotos()).toEqual(["used-a", "used-b"]);
  });

  test("keeps a photo only a snapshot still uses, so restoring it keeps its photo", async () => {
    const doc = withPhoto(famSimple(), "old");
    await repo.saveTree(doc);
    await repo.takeSnapshot(doc);
    await repo.saveTree({ ...famSimple(), updatedAt: "2026-10-23T00:00:00.000Z" });
    await repo.putPhoto("old", photo());

    expect(await repo.deleteUnusedPhotos()).toBe(0);
    expect(await storedPhotos()).toEqual(["old"]);
  });

  test("keeps the photos it is told to keep", async () => {
    await repo.putPhoto("pending", photo());
    await repo.putPhoto("orphan", photo());
    expect(await repo.deleteUnusedPhotos(["pending"])).toBe(1);
    expect(await storedPhotos()).toEqual(["pending"]);
  });

  test("keeps the photos of a damaged tree record", async () => {
    await db.put("trees", { id: "broken", persons: { a: { photoId: "kept" } } });
    await repo.putPhoto("kept", photo());
    await repo.putPhoto("orphan", photo());
    expect(await repo.deleteUnusedPhotos()).toBe(1);
    expect(await storedPhotos()).toEqual(["kept"]);
  });

  test("with no photos it does nothing", async () => {
    await repo.saveTree(famSimple());
    expect(await repo.deleteUnusedPhotos()).toBe(0);
  });
});

describe("cleanUpUnusedPhotos", () => {
  test("after a tree is deleted its photos go, other trees' photos stay", async () => {
    const gone = withPhoto(famSimple(), "gone");
    await repo.saveTree(gone);
    await repo.saveTree(withPhoto({ ...famHalfSiblings(), id: "other" }, "stays"));
    await repo.putPhoto("gone", photo());
    await repo.putPhoto("stays", photo());
    await repo.deleteTree(gone.id);

    expect(await cleanUpUnusedPhotos(repo, memoryStorage())).toBe(1);
    expect(await storedPhotos()).toEqual(["stays"]);
  });

  test("keeps a photo an unsaved edit (the journal) already points at", async () => {
    const storage = memoryStorage();
    const doc = famSimple();
    await repo.saveTree(doc);
    await repo.putPhoto("just-added", photo());
    writePending(withPhoto(doc, "just-added"), storage);

    expect(await cleanUpUnusedPhotos(repo, storage)).toBe(0);
    expect(await storedPhotos()).toEqual(["just-added"]);
  });

  test("without a journal storage it still cleans up", async () => {
    await repo.putPhoto("orphan", photo());
    expect(await cleanUpUnusedPhotos(repo, undefined)).toBe(1);
  });
});
