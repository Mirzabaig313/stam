import { beforeEach, describe, expect, test } from "bun:test";

import { createJournal, readPending, recoverAllPending, writePending } from "@/storage/journal";
import { createSaveGuard } from "@/storage/saveGuard";
import { StaleWriteError } from "@/storage/treeRepo";
import { createEditorStore } from "@/ui/store/editorStore";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;

let env: Env;
let snapshots: string[];

async function openStore(doc = famSimple()) {
  await env.repo.saveTree(doc);
  const repo = {
    ...env.repo,
    takeSnapshot: async (d: typeof doc, opts?: { ifChanged?: boolean }) => {
      snapshots.push(d.updatedAt);
      await env.repo.takeSnapshot(d, opts);
    },
  };
  const store = createEditorStore({ repo, autosaver: env.autosaver, now: env.now });
  await store.getState().load(doc.id);
  return { store, doc };
}

beforeEach(async () => {
  env = await makeEditorEnv();
  snapshots = [];
  // A journal entry a test left behind must not be restored into the next one.
  localStorage.removeItem("stam:pending:doc");
});

describe("load", () => {
  test("opens the stored tree, lays it out from the root and takes a snapshot", async () => {
    const { store, doc } = await openStore();
    const s = store.getState();
    expect(s.status).toBe("ready");
    expect(s.doc).toEqual(doc);
    expect(s.layout?.nodes.map((n) => n.personId)).toContain("c3");
    expect(s.canUndo).toBe(false);
    expect(snapshots).toHaveLength(1);
  });

  test("an unknown tree is reported as failed", async () => {
    const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
    await store.getState().load("nope");
    expect(store.getState().status).toBe("failed");
    expect(store.getState().doc).toBeNull();
  });

  test("a repo that throws is reported as failed", async () => {
    const repo = {
      ...env.repo,
      getTree: () => Promise.reject(new Error("disk")),
    };
    const store = createEditorStore({ repo, autosaver: env.autosaver, now: env.now });
    await store.getState().load("t");
    expect(store.getState().status).toBe("failed");
  });

  test("tells when the tree came from a backup snapshot", async () => {
    const doc = famSimple();
    await env.repo.saveTree(doc);
    await env.repo.takeSnapshot(doc);
    // Damage the stored record so only the snapshot is usable.
    await env.db.put("trees", { ...doc, unions: null });
    const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
    await store.getState().load(doc.id);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().recoveredFromSnapshot).toBe(true);
  });
});

describe("dispatch", () => {
  test("updates the layout and schedules an autosave", async () => {
    const { store, doc } = await openStore();
    const before = store.getState().layout!.nodes.length;
    const ids = store
      .getState()
      .dispatch(
        { type: "addChild", parentId: "dad", unionId: "u1", child: { gender: "male" } },
        "Add child",
      );
    expect(ids).toHaveLength(1);
    const s = store.getState();
    expect(s.layout!.nodes.length).toBe(before + 1);
    expect(s.canUndo).toBe(true);
    // Not saved until the debounce passes.
    expect((await env.repo.getTree(doc.id))!.doc.persons[ids![0]!]).toBeUndefined();
    const saved = new Promise((resolve) =>
      env.autosaver.onStatus((status) => status === "saved" && resolve(status)),
    );
    await env.clock.advance(600);
    await saved;
    expect((await env.repo.getTree(doc.id))!.doc.persons[ids![0]!]).toBeDefined();
  });

  test("a rejected command sets the error code and changes nothing", async () => {
    const { store, doc } = await openStore();
    const result = store
      .getState()
      .dispatch({ type: "updatePerson", personId: "ghost", patch: { firstName: "X" } }, "Edit");
    expect(result).toBeNull();
    expect(store.getState().error).toBe("NOT_FOUND");
    expect(store.getState().doc).toEqual(doc);
    expect(store.getState().canUndo).toBe(false);
    // The next good command clears it.
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    expect(store.getState().error).toBeNull();
  });

  test("deleting the selected person clears the selection", async () => {
    const { store } = await openStore();
    store.getState().select("c2");
    store.getState().dispatch({ type: "deletePerson", personId: "c2", mode: "person" }, "Delete");
    expect(store.getState().selectedId).toBeNull();
    expect(store.getState().doc!.persons.c2).toBeUndefined();
  });

  test("deleting another person keeps the selection", async () => {
    const { store } = await openStore();
    store.getState().select("c1");
    store.getState().dispatch({ type: "deletePerson", personId: "c2", mode: "person" }, "Delete");
    expect(store.getState().selectedId).toBe("c1");
  });

  test("deleting the view root falls back to the tree root", async () => {
    const { store } = await openStore();
    store.getState().setViewRoot("c1");
    store.getState().dispatch({ type: "deletePerson", personId: "c1", mode: "person" }, "Delete");
    expect(store.getState().viewRootId).toBeNull();
    expect(store.getState().layout!.nodes.length).toBeGreaterThan(0);
  });
});

describe("undo and redo", () => {
  test("round-trip the document and the layout", async () => {
    const { store, doc } = await openStore();
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    const [id] = store
      .getState()
      .dispatch(
        { type: "addChild", parentId: "dad", unionId: "u1", child: { gender: "female" } },
        "Add child",
      )!;
    // Confirmed, as the inline editor does: a pending add would be cancelled by undo (I4).
    store
      .getState()
      .amendLast({ type: "updatePerson", personId: id!, patch: { firstName: "Hina" } }, "Name");
    const edited = store.getState().doc;
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);
    store.getState().redo();
    store.getState().redo();
    expect(store.getState().doc).toEqual(edited);
    expect(store.getState().canRedo).toBe(false);
  });

  test("undoing the addition of the selected person clears the selection", async () => {
    const { store } = await openStore();
    const ids = store
      .getState()
      .dispatch(
        { type: "addChild", parentId: "dad", unionId: "u1", child: { gender: "male" } },
        "Add child",
      )!;
    store.getState().select(ids[0]!);
    store.getState().undo();
    expect(store.getState().selectedId).toBeNull();
  });

  test("undo schedules an autosave", async () => {
    const { store, doc } = await openStore();
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    await env.autosaver.flush();
    store.getState().undo();
    await env.autosaver.flush();
    expect((await env.repo.getTree(doc.id))!.doc.name).toBe(doc.name);
  });
});

const addEmpty = (store: Awaited<ReturnType<typeof openStore>>["store"]) =>
  store
    .getState()
    .dispatch(
      { type: "addChild", parentId: "dad", unionId: "u1", child: { gender: "male" } },
      "Add child",
    )!;

describe("inline add", () => {
  test("inline add cancel restores doc and clears redo", async () => {
    const { store, doc } = await openStore();
    addEmpty(store);
    store.getState().cancelLastAdd();
    expect(store.getState().doc).toEqual(doc);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
  });

  test("inline add confirm is one undo step", async () => {
    const { store, doc } = await openStore();
    const [id] = addEmpty(store);
    store
      .getState()
      .amendLast({ type: "updatePerson", personId: id!, patch: { firstName: "Zed" } }, "Name");
    expect(store.getState().doc!.persons[id!]!.firstName).toBe("Zed");
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc);
    expect(store.getState().canUndo).toBe(false);
  });

  test("a rejected amendment sets the error and keeps the add", async () => {
    const { store } = await openStore();
    const [id] = addEmpty(store);
    const result = store
      .getState()
      .amendLast({ type: "updatePerson", personId: "ghost", patch: {} }, "Name");
    expect(result).toBeNull();
    expect(store.getState().error).toBe("NOT_FOUND");
    expect(store.getState().doc!.persons[id!]).toBeDefined();
  });
});

describe("undo and redo while an inline add is pending (I4)", () => {
  for (const move of ["undo", "redo"] as const) {
    test(`${move} cancels just the pending add and closes the editor`, async () => {
      const { store } = await openStore();
      store.getState().dispatch({ type: "renameTree", name: "Kept" }, "Rename");
      const afterRename = store.getState().doc;
      const [id] = addEmpty(store);
      store.getState().startEditing({ personId: id!, role: "child", fromId: "dad" });
      store.getState()[move]();
      const s = store.getState();
      expect(s.doc).toEqual(afterRename!);
      expect(s.editing).toBeNull();
      expect(s.canRedo).toBe(false);
      expect(s.canUndo).toBe(true);
    });
  }
});

describe("amendLast and cancelLastAdd only act on their own add", () => {
  test("a refused add followed by cancelLastAdd leaves the previous edit alone", async () => {
    const { store } = await openStore();
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    const refused = store
      .getState()
      .dispatch({ type: "addChild", parentId: "ghost", child: { gender: "male" } }, "Add child");
    expect(refused).toBeNull();
    store.getState().cancelLastAdd();
    expect(store.getState().doc!.name).toBe("Renamed");
    expect(store.getState().canUndo).toBe(true);
  });

  test("a refused add followed by cancelLastAdd keeps the redo stack", async () => {
    const { store } = await openStore();
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    store.getState().undo();
    store
      .getState()
      .dispatch({ type: "addChild", parentId: "ghost", child: { gender: "male" } }, "Add child");
    store.getState().cancelLastAdd();
    expect(store.getState().canRedo).toBe(true);
    store.getState().redo();
    expect(store.getState().doc!.name).toBe("Renamed");
  });

  test("cancelLastAdd does nothing once another edit followed the add", async () => {
    const { store } = await openStore();
    const [id] = addEmpty(store);
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    store.getState().cancelLastAdd();
    expect(store.getState().doc!.persons[id!]).toBeDefined();
    expect(store.getState().doc!.name).toBe("Renamed");
  });

  test("cancelLastAdd does nothing once undo already cancelled the add", async () => {
    const { store } = await openStore();
    store.getState().dispatch({ type: "renameTree", name: "Kept" }, "Rename");
    addEmpty(store);
    store.getState().undo();
    store.getState().cancelLastAdd();
    expect(store.getState().doc?.name).toBe("Kept");
    expect(store.getState().canUndo).toBe(true);
  });

  test("cancelLastAdd does nothing once the add was confirmed", async () => {
    const { store } = await openStore();
    const [id] = addEmpty(store);
    store
      .getState()
      .amendLast({ type: "updatePerson", personId: id!, patch: { firstName: "Zed" } }, "Name");
    store.getState().cancelLastAdd();
    expect(store.getState().doc!.persons[id!]!.firstName).toBe("Zed");
  });

  test("amendLast without a pending add is an ordinary undo step", async () => {
    const { store, doc } = await openStore();
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    store.getState().amendLast({ type: "renameTree", name: "Again" }, "Rename");
    expect(store.getState().doc!.name).toBe("Again");
    store.getState().undo();
    expect(store.getState().doc!.name).toBe("Renamed");
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc);
  });

  test("amendLast after an unrelated edit does not fold into the earlier add", async () => {
    const { store } = await openStore();
    const [id] = addEmpty(store);
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    store
      .getState()
      .amendLast({ type: "updatePerson", personId: id!, patch: { firstName: "Zed" } }, "Name");
    store.getState().undo(); // only the name
    expect(store.getState().doc!.persons[id!]!.firstName).toBe("");
    expect(store.getState().doc!.name).toBe("Renamed");
  });

  test("a new load forgets a pending add", async () => {
    const { store, doc } = await openStore();
    addEmpty(store);
    await store.getState().load(doc.id);
    store.getState().cancelLastAdd();
    expect(store.getState().doc).toEqual(doc);
  });
});

describe("view root and collapse", () => {
  test("setViewRoot re-lays out from the new root without touching doc.rootPersonId", async () => {
    const { store } = await openStore();
    store.getState().setViewRoot("c1");
    const s = store.getState();
    expect(s.viewRootId).toBe("c1");
    expect(s.doc!.rootPersonId).toBe("dad");
    expect(s.layout!.nodes.map((n) => n.personId)).toEqual(["c1"]);
    expect(s.layout!.unreachable).toContain("dad");
    store.getState().setViewRoot(null);
    expect(store.getState().viewRootId).toBeNull();
    expect(store.getState().layout!.nodes.map((n) => n.personId)).toContain("dad");
  });

  test("revealPerson expands collapsed ancestors and keeps the view root (I2)", async () => {
    const { store } = await openStore();
    store.getState().toggleCollapse("dad");
    store.getState().toggleCollapse("c2"); // not on c3's path: stays collapsed
    expect(store.getState().layout!.primaryNode.c3).toBeUndefined();
    expect(store.getState().revealPerson("c3")).toBe(true);
    const s = store.getState();
    expect(s.viewRootId).toBeNull();
    expect(s.layout!.primaryNode.c3).toBe("c3");
    expect([...s.collapsed]).toEqual(["c2"]);
  });

  test("revealPerson changes the view root only for someone still not placed", async () => {
    const { store } = await openStore();
    store.getState().setViewRoot("c1");
    store.getState().toggleCollapse("c1");
    expect(store.getState().revealPerson("c2")).toBe(true);
    expect(store.getState().viewRootId).toBe("dad");
    expect(store.getState().layout!.primaryNode.c2).toBe("c2");
    // Someone already shown changes nothing.
    store.getState().toggleCollapse("c3");
    const before = store.getState().layout;
    expect(store.getState().revealPerson("c3")).toBe(true);
    expect(store.getState().layout).toBe(before);
    expect(store.getState().revealPerson("nobody")).toBe(false);
  });

  test("toggleCollapse hides and restores descendants", async () => {
    const { store } = await openStore();
    const full = store.getState().layout!.nodes.length;
    store.getState().toggleCollapse("dad");
    expect(store.getState().collapsed.has("dad")).toBe(true);
    expect(store.getState().layout!.nodes.length).toBeLessThan(full);
    store.getState().toggleCollapse("dad");
    expect(store.getState().layout!.nodes.length).toBe(full);
  });

  test("collapse and view root changes do not schedule a save or touch history", async () => {
    const { store } = await openStore();
    const statuses: string[] = [];
    env.autosaver.onStatus((status) => statuses.push(status));
    store.getState().toggleCollapse("dad");
    store.getState().setViewRoot("c1");
    store.getState().select("c2");
    store.getState().setFocusMode(true);
    await env.clock.advance(5000); // far past the debounce and the max wait
    expect(statuses).toEqual([]);
    expect(store.getState().canUndo).toBe(false);
    // The same wait does save after a real edit, so the silence above means something.
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    await env.clock.advance(5000);
    await Promise.resolve();
    expect(statuses).toContain("saving");
  });
});

describe("editing, selection and focus", () => {
  test("startEditing and stopEditing", async () => {
    const { store } = await openStore();
    store.getState().startEditing({ personId: "c1", role: "child", fromId: "dad" });
    expect(store.getState().editing).toEqual({ personId: "c1", role: "child", fromId: "dad" });
    store.getState().stopEditing();
    expect(store.getState().editing).toBeNull();
  });

  test("select and setFocusMode", async () => {
    const { store } = await openStore();
    store.getState().select("c3");
    expect(store.getState().selectedId).toBe("c3");
    store.getState().select(null);
    expect(store.getState().selectedId).toBeNull();
    store.getState().setFocusMode(true);
    expect(store.getState().focusMode).toBe(true);
  });
});

const stored = async () => (await env.db.getAllFromIndex("snapshots", "treeId", "doc")).length;

describe("snapshots", () => {
  test("opening an unchanged tree again does not add a duplicate snapshot", async () => {
    const { doc } = await openStore();
    await openStore(doc);
    await openStore(doc);
    expect(await stored()).toBe(1);
  });

  test("opening after a save takes a snapshot of the new state", async () => {
    const { store, doc } = await openStore();
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    await env.autosaver.flush();
    env.tick(1000);
    await openStore((await env.repo.getTree(doc.id))!.doc);
    expect(await stored()).toBe(2);
  });

  test("another snapshot only after ten minutes of editing", async () => {
    const { store } = await openStore();
    expect(snapshots).toHaveLength(1);
    store.getState().dispatch({ type: "renameTree", name: "A" }, "Rename");
    env.tick(9 * 60_000);
    store.getState().dispatch({ type: "renameTree", name: "B" }, "Rename");
    await Promise.resolve();
    expect(snapshots).toHaveLength(1);
    env.tick(2 * 60_000);
    store.getState().dispatch({ type: "renameTree", name: "C" }, "Rename");
    await Promise.resolve();
    expect(snapshots).toHaveLength(2);
    // The next ten minutes count from that snapshot.
    env.tick(60_000);
    store.getState().dispatch({ type: "renameTree", name: "D" }, "Rename");
    await Promise.resolve();
    expect(snapshots).toHaveLength(2);
  });
});

const journalKey = (id: string) => `stam:pending:${id}`;

describe("write-ahead journal", () => {
  test("every document change is journaled before the debounced save runs", async () => {
    await env.repo.saveTree(famSimple());
    const journal = createJournal({ timers: env.clock.timers });
    const store = createEditorStore({
      repo: env.repo,
      autosaver: env.autosaver,
      journal,
      now: env.now,
    });
    await store.getState().load("doc");
    store.getState().dispatch({ type: "renameTree", name: "Quick" }, "Rename");
    // No timers have run: IndexedDB still has the old name, the journal has the new one.
    expect((await env.repo.getTree("doc"))?.doc.name).toBe("Fixture");
    expect(readPending("doc")?.doc.name).toBe("Quick");
    localStorage.removeItem(journalKey("doc"));
  });

  test("a journal newer than the stored tree is restored on load and saved", async () => {
    const base = famSimple();
    const savedAt = await env.repo.saveTree(base);
    writePending({ ...base, name: "Lost edit" }, undefined, { writtenAt: savedAt + 1 });
    const store = createEditorStore({
      repo: env.repo,
      autosaver: env.autosaver,
      journal: createJournal({ timers: env.clock.timers }),
      now: env.now,
    });
    await store.getState().load("doc");
    expect(store.getState().doc?.name).toBe("Lost edit");
    expect((await env.repo.getTree("doc"))?.doc.name).toBe("Lost edit");
    expect(localStorage.getItem(journalKey("doc"))).toBeNull();
  });

  test("an older journal is ignored", async () => {
    const base = { ...famSimple(), updatedAt: "2026-06-01T00:00:00.000Z" };
    const savedAt = await env.repo.saveTree(base);
    writePending({ ...base, name: "Stale" }, undefined, { writtenAt: savedAt - 1 });
    const store = createEditorStore({
      repo: env.repo,
      autosaver: env.autosaver,
      journal: createJournal({ timers: env.clock.timers }),
      now: env.now,
    });
    await store.getState().load("doc");
    expect(store.getState().doc?.name).toBe("Fixture");
    expect(localStorage.getItem(journalKey("doc"))).toBeNull();
  });
});

async function openGuarded() {
  await env.repo.saveTree(famSimple());
  const guard = createSaveGuard(env.repo);
  const journal = createJournal({ timers: env.clock.timers });
  const store = createEditorStore({
    repo: env.repo,
    autosaver: env.autosaver,
    journal,
    guard,
    now: env.now,
  });
  await store.getState().load("doc");
  return { store, guard };
}

describe("another tab's work is never overwritten (C2)", () => {
  test("the guard saves on top of the version this session loaded, then its own saves", async () => {
    const { guard } = await openGuarded();
    const doc = (await env.repo.getTree("doc"))!.doc;
    await guard.save({ ...doc, name: "One" });
    await guard.save({ ...doc, name: "Two" });
    expect((await env.repo.getTree("doc"))?.doc.name).toBe("Two");
  });

  test("the guard saves with the caller's capture time and returns the new savedAt (N1)", async () => {
    const { guard } = await openGuarded();
    const doc = (await env.repo.getTree("doc"))!.doc;
    const capturedAt = Date.now() + 60_000;
    expect(await guard.save({ ...doc, name: "One" }, { capturedAt })).toBe(capturedAt);
    expect((await env.repo.getTree("doc"))?.savedAt).toBe(capturedAt);
  });

  test("the guard refuses to save over another tab's save", async () => {
    const { guard } = await openGuarded();
    const doc = (await env.repo.getTree("doc"))!.doc;
    await env.repo.saveTree({ ...doc, name: "Other tab" });
    await expect(guard.save({ ...doc, name: "Stale" })).rejects.toBeInstanceOf(StaleWriteError);
    expect((await env.repo.getTree("doc"))?.doc.name).toBe("Other tab");
  });

  test("lock makes the editor read-only: no edits, no undo, no saves", async () => {
    const { store } = await openGuarded();
    store.getState().dispatch({ type: "renameTree", name: "Before" }, "Rename");
    store.getState().startEditing({ personId: "c3", role: "child" });
    store.getState().lock("changed");
    const s = store.getState();
    expect(s.locked).toBe("changed");
    expect(s.editing).toBeNull();
    expect(s.canUndo).toBe(false);
    expect(s.dispatch({ type: "renameTree", name: "After" }, "Rename")).toBeNull();
    s.undo();
    s.redo();
    expect(store.getState().doc?.name).toBe("Before");
    await env.clock.advance(5000);
    // The waiting autosave was dropped with the lock.
    expect((await env.repo.getTree("doc"))?.doc.name).toBe("Fixture");
  });

  test("deleted is final; changed does not replace it", async () => {
    const { store } = await openGuarded();
    store.getState().lock("deleted");
    store.getState().lock("changed");
    expect(store.getState().locked).toBe("deleted");
  });

  test("a lock survives a repeated load (StrictMode runs effects twice)", async () => {
    const { store } = await openGuarded();
    store.getState().lock("changed");
    await store.getState().load("doc");
    expect(store.getState().locked).toBe("changed");
  });
});

const storedMeta = async () => (await env.repo.listTrees())[0];

/** The tree saved once, plus a journal entry by `tab` written after that save. */
async function entryBy(tab: string) {
  const savedAt = await env.repo.saveTree(famSimple());
  writePending({ ...famSimple(), name: `${tab} edit` }, undefined, {
    writtenAt: savedAt + 1,
    tab,
  });
  return savedAt;
}

describe("a tab whose journal another tab restored keeps editing (N2)", () => {
  test("a recovery save records whose entry it restored; a plain save clears it", async () => {
    await entryBy("tab-a");
    await recoverAllPending(env.repo); // the tree list, in another tab
    expect(await storedMeta()).toMatchObject({ name: "tab-a edit", recoveredFrom: "tab-a" });
    await env.repo.saveTree(famSimple());
    expect((await storedMeta())?.recoveredFrom).toBeUndefined();
  });

  test("the editor's load records it too", async () => {
    await entryBy("tab-a");
    const store = createEditorStore({
      repo: env.repo,
      autosaver: env.autosaver,
      journal: createJournal({ timers: env.clock.timers, tabId: "tab-b" }),
      guard: createSaveGuard(env.repo, { tabId: "tab-b" }),
      now: env.now,
    });
    await store.getState().load("doc");
    expect(await storedMeta()).toMatchObject({ name: "tab-a edit", recoveredFrom: "tab-a" });
  });

  test("the tab that wrote the entry takes that save over and keeps saving", async () => {
    const guard = createSaveGuard(env.repo, { tabId: "tab-a" });
    guard.loaded(await entryBy("tab-a"));
    await recoverAllPending(env.repo);
    await guard.save({ ...famSimple(), name: "Later" });
    await guard.save({ ...famSimple(), name: "Later still" });
    expect((await env.repo.getTree("doc"))?.doc.name).toBe("Later still");
  });

  test("a save by any other tab still refuses", async () => {
    const guard = createSaveGuard(env.repo, { tabId: "tab-a" });
    guard.loaded(await entryBy("tab-b"));
    await recoverAllPending(env.repo); // restores tab-b's entry, not ours
    await expect(guard.save({ ...famSimple(), name: "Mine" })).rejects.toBeInstanceOf(
      StaleWriteError,
    );

    const other = createSaveGuard(env.repo, { tabId: "tab-a" });
    other.loaded(await entryBy("tab-a"));
    await recoverAllPending(env.repo);
    await env.repo.saveTree({ ...famSimple(), name: "Another tab" }); // a real edit elsewhere
    await expect(other.save({ ...famSimple(), name: "Mine" })).rejects.toBeInstanceOf(
      StaleWriteError,
    );
    expect((await env.repo.getTree("doc"))?.doc.name).toBe("Another tab");
  });

  test("a lock keeps a journal entry newer than the stored save, and a reload restores it", async () => {
    await env.repo.saveTree(famSimple());
    // A real clock, as in the app, so the entry is stamped after that save.
    const journal = createJournal();
    const store = createEditorStore({
      repo: env.repo,
      autosaver: env.autosaver,
      journal,
      guard: createSaveGuard(env.repo),
      now: env.now,
    });
    await store.getState().load("doc");
    await Bun.sleep(2);
    store.getState().dispatch({ type: "renameTree", name: "Mine" }, "Rename");
    store.getState().lock("changed");
    expect(readPending("doc")?.doc.name).toBe("Mine");

    const reloaded = createEditorStore({
      repo: env.repo,
      autosaver: env.autosaver,
      journal: createJournal(),
      now: env.now,
    });
    await reloaded.getState().load("doc");
    expect(reloaded.getState().doc?.name).toBe("Mine");
  });
});
