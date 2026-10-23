import { beforeEach, describe, expect, test } from "bun:test";

import { applyCommand } from "@/core/commands/apply";
import { History } from "@/core/commands/history";
import type { TreeDocument } from "@/core/model/types";
import { openStamDb } from "@/storage/db";
import {
  createJournal,
  type JournalStorage,
  readPending,
  recoverAllPending,
  recoverPending,
  writePending,
} from "@/storage/journal";
import { createTreeRepo, type TreeRepo } from "@/storage/treeRepo";

import { fakeClock } from "../fixtures/editorEnv";
import { famSimple } from "../fixtures/families";

/** An in-memory `Storage`; `quota` makes every write throw like a full disk. */
function memoryStorage(opts: { quota?: boolean } = {}) {
  const map = new Map<string, string>();
  const storage: JournalStorage & { map: Map<string, string> } = {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      if (opts.quota) throw new DOMException("full", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
  };
  return storage;
}

const at = (doc: TreeDocument, updatedAt: string): TreeDocument => ({ ...doc, updatedAt });
const KEY = "stam:pending:doc";
/** What `getTree` reports for a stored tree saved at `savedAt`. */
const found = (doc: TreeDocument, savedAt: number | null) => ({ doc, savedAt });

let repo: TreeRepo;
beforeEach(async () => {
  repo = createTreeRepo(await openStamDb(`stam-test-${crypto.randomUUID()}`));
});

describe("journal entries", () => {
  test("write then read gives the same document and when it was written", () => {
    const storage = memoryStorage();
    const doc = at(famSimple(), "2026-02-01T00:00:00.000Z");
    writePending(doc, storage, { writtenAt: 1234, tab: "tab-a" });
    expect(JSON.parse(storage.map.get(KEY)!)).toMatchObject({
      v: 1,
      writtenAt: 1234,
      tab: "tab-a",
    });
    expect(readPending("doc", storage)).toEqual({ doc, writtenAt: 1234, tab: "tab-a" });
  });

  test("an entry from before the envelope is still read, without a write time", () => {
    const storage = memoryStorage();
    const doc = at(famSimple(), "2026-02-01T00:00:00.000Z");
    storage.map.set(KEY, JSON.stringify(doc));
    expect(readPending("doc", storage)).toEqual({ doc, writtenAt: null, tab: null });
  });

  test("an unreadable or invalid entry is dropped and ignored", () => {
    const storage = memoryStorage();
    storage.map.set(KEY, "{not json");
    expect(readPending("doc", storage)).toBeNull();
    expect(storage.map.has(KEY)).toBe(false);
    storage.map.set(KEY, JSON.stringify({ schemaVersion: 1, id: "doc" }));
    expect(readPending("doc", storage)).toBeNull();
    expect(storage.map.has(KEY)).toBe(false);
    storage.map.set(KEY, JSON.stringify({ v: 1, writtenAt: "soon", doc: famSimple() }));
    expect(readPending("doc", storage)).toBeNull();
    expect(storage.map.has(KEY)).toBe(false);
  });

  test("a full storage fails silently", () => {
    const storage = memoryStorage({ quota: true });
    expect(() => writePending(famSimple(), storage)).not.toThrow();
    const journal = createJournal({ storage });
    expect(() => journal.touch(famSimple())).not.toThrow();
    expect(() => journal.flush()).not.toThrow();
    expect(readPending("doc", storage)).toBeNull();
  });

  test("no storage at all fails silently", () => {
    const journal = createJournal({ storage: undefined });
    expect(() => {
      journal.touch(famSimple());
      journal.flush();
      journal.saved(famSimple(), 1);
      journal.discard();
    }).not.toThrow();
  });
});

describe("recovery", () => {
  test("an entry written after the last save is saved to the repo, cleared, and returned", async () => {
    const storage = memoryStorage();
    const stored = at(famSimple(), "2026-01-01T00:00:00.000Z");
    const savedAt = await repo.saveTree(stored);
    writePending({ ...stored, name: "Edited" }, storage, { writtenAt: savedAt + 1 });

    const got = await recoverPending(found(stored, savedAt), (doc) => repo.saveTree(doc), storage);
    expect(got?.name).toBe("Edited");
    expect((await repo.getTree("doc"))?.doc.name).toBe("Edited");
    expect(storage.map.has(KEY)).toBe(false);
  });

  test("an entry written before (or as) the last save is ignored and dropped", async () => {
    const storage = memoryStorage();
    const stored = at(famSimple(), "2026-01-01T00:00:00.000Z");
    const savedAt = await repo.saveTree(stored);
    for (const writtenAt of [savedAt - 1, savedAt]) {
      // A newer `updatedAt` does not matter: the write time decides.
      const doc = { ...at(famSimple(), "2099-01-01T00:00:00.000Z"), name: "Stale" };
      writePending(doc, storage, { writtenAt });
      expect(
        await recoverPending(found(stored, savedAt), (d) => repo.saveTree(d), storage),
      ).toBeNull();
      expect(storage.map.has(KEY)).toBe(false);
    }
    expect((await repo.getTree("doc"))?.doc.name).toBe("Fixture");
  });

  test("an entry for a tree saved before savedAt existed is restored", async () => {
    const storage = memoryStorage();
    const stored = at(famSimple(), "2026-03-01T00:00:00.000Z");
    writePending({ ...at(famSimple(), "2026-01-01T00:00:00.000Z"), name: "Undone" }, storage);
    const got = await recoverPending(found(stored, null), async () => {}, storage);
    expect(got?.name).toBe("Undone");
  });

  test("an entry without the envelope falls back to comparing updatedAt", async () => {
    const storage = memoryStorage();
    const stored = at(famSimple(), "2026-03-01T00:00:00.000Z");
    storage.map.set(KEY, JSON.stringify({ ...at(famSimple(), "2026-01-01T00:00:00.000Z") }));
    expect(await recoverPending(found(stored, 5), async () => {}, storage)).toBeNull();
    expect(storage.map.has(KEY)).toBe(false);
    const newer = { ...at(famSimple(), "2026-06-01T00:00:00.000Z"), name: "Newer" };
    storage.map.set(KEY, JSON.stringify(newer));
    expect((await recoverPending(found(stored, 5), async () => {}, storage))?.name).toBe("Newer");
  });

  test("if saving fails the entry stays and is still returned", async () => {
    const storage = memoryStorage();
    const stored = at(famSimple(), "2026-01-01T00:00:00.000Z");
    writePending(at(famSimple(), "2026-03-01T00:00:00.000Z"), storage, { writtenAt: 10 });
    const got = await recoverPending(
      found(stored, 5),
      () => Promise.reject(new Error("disk")),
      storage,
    );
    expect(got).not.toBeNull();
    expect(storage.map.has(KEY)).toBe(true);
  });

  test("recoverAllPending restores every tree with a newer entry and drops orphans", async () => {
    const storage = memoryStorage();
    const savedAt = await repo.saveTree(at(famSimple(), "2026-01-01T00:00:00.000Z"));
    writePending({ ...at(famSimple(), "2026-03-01T00:00:00.000Z"), name: "Edited" }, storage, {
      writtenAt: savedAt + 1,
    });
    writePending({ ...famSimple(), id: "gone" }, storage);

    await recoverAllPending(repo, storage);
    expect((await repo.getTree("doc"))?.doc.name).toBe("Edited");
    expect((await repo.listTrees())[0]?.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(storage.map.size).toBe(0);
  });
});

const v = (n: number) => at(famSimple(), `2026-05-0${n}T00:00:00.000Z`);

function setup(tab = "tab-a") {
  const storage = memoryStorage();
  const clock = fakeClock();
  const journal = createJournal({ storage, timers: clock.timers, tabId: tab });
  return { storage, clock, journal };
}

describe("the editor's journal", () => {
  test("the first change is journaled at once", () => {
    const { storage, journal } = setup();
    journal.touch(v(1));
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(v(1).updatedAt);
    expect(readPending("doc", storage)?.tab).toBe("tab-a");
  });

  test("later changes are written at most every 250 ms, the newest wins", async () => {
    const { storage, clock, journal } = setup();
    journal.touch(v(1));
    journal.touch(v(2));
    journal.touch(v(3));
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(v(1).updatedAt);
    await clock.advance(249);
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(v(1).updatedAt);
    await clock.advance(1);
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(v(3).updatedAt);
    expect(readPending("doc", storage)?.writtenAt).toBe(250);
  });

  test("flush writes the waiting change synchronously (pagehide)", () => {
    const { storage, journal } = setup();
    journal.touch(v(1));
    journal.touch(v(2));
    journal.flush();
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(v(2).updatedAt);
  });

  test("saved clears the entry once the save covers it", async () => {
    const { storage, clock, journal } = setup();
    const doc = v(1);
    journal.touch(doc);
    journal.saved(doc, 1);
    expect(storage.map.has(KEY)).toBe(false);
    await clock.advance(1000); // the cancelled trailing write must not bring it back
    expect(storage.map.has(KEY)).toBe(false);
  });

  test("saved keeps the entry when a newer change is waiting", () => {
    const { storage, journal } = setup();
    const [one, two] = [v(1), v(2)];
    journal.touch(one);
    journal.touch(two);
    journal.flush();
    journal.saved(one, 1); // the save that finished was the older one
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(two.updatedAt);
    journal.saved(two, 2);
    expect(storage.map.has(KEY)).toBe(false);
  });

  test("discard forgets the waiting change but leaves the entry for recovery to judge (N2)", async () => {
    const { storage, clock, journal } = setup("tab-a");
    journal.touch(v(1));
    journal.touch(v(2)); // waits for the throttle
    journal.discard();
    // The entry may hold edits newer than the stored save; recovery keeps it only if it does.
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(v(1).updatedAt);
    await clock.advance(1000);
    journal.flush();
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(v(1).updatedAt);
  });
});

/** famSimple saved once, then one edit, as an undoable history entry. */
function editedOnce() {
  const base = famSimple();
  const edit = applyCommand(base, { type: "renameTree", name: "Edited" }, new Date("2026-09-01"));
  const history = new History();
  history.push({ label: "Rename", patches: edit.patches, inversePatches: edit.inversePatches });
  const undone = history.undo(edit.doc)!;
  return { base, edited: edit.doc, undone };
}

describe("undo survives a reload (C1)", () => {
  test("undo after save, then reload, is recovered", async () => {
    const { edited, undone } = editedOnce();
    // The undo brings back the older updatedAt, so updatedAt cannot tell which is newer.
    expect(undone.updatedAt < edited.updatedAt).toBe(true);
    const storage = memoryStorage();
    // A real clock: the journal stamps its writes with Date.now(), as in the app.
    const journal = createJournal({ storage });
    journal.touch(edited);
    journal.saved(edited, await repo.saveTree(edited));
    await Bun.sleep(2);
    journal.touch(undone);
    journal.flush();

    const stored = (await repo.getTree("doc"))!;
    expect((await recoverPending(stored, (doc) => repo.saveTree(doc), storage))?.name).toBe(
      "Fixture",
    );
  });

  test("undo while a save is in flight keeps the entry", () => {
    const { edited, undone } = editedOnce();
    const { storage, journal } = setup();
    journal.touch(edited); // the autosave of `edited` starts
    journal.touch(undone); // undo, while that save is still running
    journal.saved(edited, 1); // the save of `edited` resolves
    journal.flush(); // pagehide
    expect(readPending("doc", storage)?.doc.name).toBe("Fixture");
  });
});

describe("an edit journaled while a save runs (N1)", () => {
  test("an undo journaled the moment a save starts is recovered after the tab dies", async () => {
    const { base, edited, undone } = editedOnce();
    const loadedAt = await repo.saveTree(base);
    const storage = memoryStorage();
    // A real clock, as in the app; no throttle, so each change is journaled at once.
    const journal = createJournal({ storage, throttleMs: 0 });
    journal.touch(edited);
    const capturedAt = Date.now(); // the autosaver takes `edited`
    const saving = repo.saveTree(edited, { ifSavedAt: loadedAt, capturedAt });
    journal.touch(undone); // Ctrl+Z in the same millisecond, while the save runs
    journal.saved(edited, await saving);
    journal.flush(); // pagehide; the tab dies before the undo's own save

    const stored = (await repo.getTree("doc"))!;
    expect(stored.doc.name).toBe("Edited");
    expect((await recoverPending(stored, (doc) => repo.saveTree(doc), storage))?.name).toBe(
      "Fixture",
    );
    expect((await repo.getTree("doc"))?.doc.name).toBe("Fixture");
  });

  test("a change journaled after the capture beats the save even if the tab dies first", async () => {
    const { edited, undone } = editedOnce();
    const storage = memoryStorage();
    const capturedAt = Date.now() - 1000;
    writePending(undone, storage, { writtenAt: capturedAt + 1 }); // after the capture
    await repo.saveTree(edited, { capturedAt }); // commits later; saved() never runs
    const stored = (await repo.getTree("doc"))!;
    expect((await recoverPending(stored, (doc) => repo.saveTree(doc), storage))?.name).toBe(
      "Fixture",
    );
  });

  test("a change kept past a save is re-stamped after that save", () => {
    const { storage, journal } = setup();
    const [one, two] = [v(1), v(2)];
    journal.touch(one);
    journal.touch(two);
    journal.flush(); // both at clock 0
    journal.saved(one, 7000); // the save's savedAt is ahead of this clock
    expect(readPending("doc", storage)).toMatchObject({ writtenAt: 7001 });
    expect(readPending("doc", storage)?.doc.updatedAt).toBe(two.updatedAt);
  });

  test("writes after a save are never stamped at or before it (a clock that went back)", async () => {
    const { storage, clock, journal } = setup();
    journal.touch(v(1));
    journal.saved(v(1), 9000);
    await clock.advance(500);
    journal.touch(v(2));
    expect(readPending("doc", storage)?.writtenAt).toBe(9001);
  });
});
