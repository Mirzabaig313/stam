import { describe, expect, test } from "bun:test";

import { UNDO_LIMIT } from "@/config";
import { applyCommand } from "@/core/commands/apply";
import { History, type HistoryEntry } from "@/core/commands/history";
import type { Command } from "@/core/commands/types";
import { createTree } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import { NOW } from "../../fixtures/commandHelpers";
import { famSimple } from "../../fixtures/families";

/** Applies a command and records it, the way the editor store does. */
function run(history: History, doc: TreeDocument, cmd: Command, label: string = cmd.type) {
  const result = applyCommand(doc, cmd, NOW);
  history.push({ label, patches: result.patches, inversePatches: result.inversePatches });
  return result;
}

const rename = (name: string): Command => ({ type: "renameTree", name });

describe("History", () => {
  test("starts empty", () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo(famSimple())).toBeNull();
    expect(h.redo(famSimple())).toBeNull();
  });

  test("push, undo, redo round-trip to equal documents", () => {
    const h = new History();
    const d0 = famSimple();
    const d1 = run(h, d0, rename("One")).doc;
    const d2 = run(h, d1, { type: "setRoot", personId: "c2" }).doc;
    expect(h.canUndo).toBe(true);

    const back1 = h.undo(d2)!;
    expect(back1).toEqual(d1);
    const back0 = h.undo(back1)!;
    expect(back0).toEqual(d0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    const fwd1 = h.redo(back0)!;
    expect(fwd1).toEqual(d1);
    const fwd2 = h.redo(fwd1)!;
    expect(fwd2).toEqual(d2);
    expect(h.canRedo).toBe(false);
    expect(h.redo(fwd2)).toBeNull();
  });

  test("undo and redo return frozen documents and do not touch the input", () => {
    const h = new History();
    const d1 = run(h, famSimple(), rename("One")).doc;
    const snapshot = structuredClone(d1);
    const d0 = h.undo(d1)!;
    expect(d1).toEqual(snapshot);
    expect(Object.isFrozen(d0)).toBe(true);
  });

  test("keeps at most 200 undo entries by default", () => {
    expect(UNDO_LIMIT).toBe(200);
    const h = new History();
    let doc = famSimple();
    const first = doc;
    for (let i = 0; i < 201; i++) doc = run(h, doc, rename(`Name ${i}`)).doc;

    let undone = 0;
    let current: TreeDocument | null = doc;
    while (h.canUndo) {
      current = h.undo(current!);
      undone++;
    }
    expect(undone).toBe(200);
    // the oldest entry (the first rename) was discarded, so we stop one step short of the start
    expect(current).not.toEqual(first);
    expect(current!.name).toBe("Name 0");
  });

  test("honours a custom limit", () => {
    const h = new History(3);
    let doc = famSimple();
    for (let i = 0; i < 5; i++) doc = run(h, doc, rename(`N${i}`)).doc;
    let undone = 0;
    let current: TreeDocument | null = doc;
    while (h.canUndo) {
      current = h.undo(current!);
      undone++;
    }
    expect(undone).toBe(3);
    expect(current!.name).toBe("N1");
  });

  test("push after undo clears the redo stack", () => {
    const h = new History();
    const d1 = run(h, famSimple(), rename("One")).doc;
    const d0 = h.undo(d1)!;
    expect(h.canRedo).toBe(true);
    run(h, d0, rename("Other"));
    expect(h.canRedo).toBe(false);
    expect(h.redo(d0)).toBeNull();
  });

  test("amend makes one undo revert both the original command and the amendment", () => {
    const h = new History();
    const d0 = createTree("T", NOW);
    const added = run(h, d0, { type: "addPerson", person: { gender: "male" } }, "Add person");
    const personId = added.createdIds[0]!;
    const named = applyCommand(
      added.doc,
      { type: "updatePerson", personId, patch: { firstName: "Ali", lastName: "Khan" } },
      NOW,
    );
    h.amend({
      label: "Rename",
      patches: named.patches,
      inversePatches: named.inversePatches,
    });

    expect(h.undo(named.doc)).toEqual(d0);
    expect(h.canUndo).toBe(false);
    // and a single redo reapplies both
    expect(h.redo(d0)).toEqual(named.doc);
  });

  test("amend does not add an undo step", () => {
    const h = new History();
    const d1 = run(h, famSimple(), rename("One"), "Original");
    const d2 = applyCommand(d1.doc, rename("Two"), NOW);
    h.amend({ label: "Amended", patches: d2.patches, inversePatches: d2.inversePatches });
    expect(h.undo(d2.doc)!.name).toBe("Fixture");
    expect(h.canUndo).toBe(false);
  });

  test("amend on an empty history records the entry as a new one", () => {
    const h = new History();
    const d1 = applyCommand(famSimple(), rename("One"), NOW);
    h.amend({ label: "Solo", patches: d1.patches, inversePatches: d1.inversePatches });
    expect(h.canUndo).toBe(true);
    expect(h.undo(d1.doc)).toEqual(famSimple());
  });

  test("dropRedo after undo makes canRedo false", () => {
    const h = new History();
    const d1 = run(h, famSimple(), rename("One")).doc;
    h.undo(d1);
    expect(h.canRedo).toBe(true);
    h.dropRedo();
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  test("clear empties both stacks", () => {
    const h = new History();
    const d1 = run(h, famSimple(), rename("One")).doc;
    const d2 = run(h, d1, rename("Two")).doc;
    h.undo(d2);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  test("entries pushed by hand work the same as command results", () => {
    const h = new History();
    const d1 = applyCommand(famSimple(), rename("One"), NOW);
    const entry: HistoryEntry = {
      label: "Manual",
      patches: d1.patches,
      inversePatches: d1.inversePatches,
    };
    h.push(entry);
    expect(h.undo(d1.doc)).toEqual(famSimple());
  });

  test("amend clears the redo stack, like push", () => {
    const h = new History();
    const d1 = run(h, famSimple(), rename("One"));
    const d2 = run(h, d1.doc, rename("Two"));
    h.undo(d2.doc);
    expect(h.canRedo).toBe(true);
    const d3 = applyCommand(d1.doc, rename("Three"), NOW);
    h.amend({ label: "Three", patches: d3.patches, inversePatches: d3.inversePatches });
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(true);
  });

  describe("when applying patches throws", () => {
    // replaces a field of a person who does not exist, which immer rejects
    const broken: HistoryEntry = {
      label: "Broken",
      patches: [{ op: "replace", path: ["persons", "ghost", "firstName"], value: "X" }],
      inversePatches: [{ op: "replace", path: ["persons", "ghost", "firstName"], value: "Y" }],
    };

    test("undo leaves both stacks unchanged", () => {
      const h = new History();
      h.push(broken);
      expect(() => h.undo(famSimple())).toThrow();
      expect(h.canUndo).toBe(true);
      expect(h.canRedo).toBe(false);
    });

    test("redo leaves both stacks unchanged", () => {
      const h = new History();
      const entryDoc = applyCommand(famSimple(), { type: "setRoot", personId: "c2" }, NOW);
      h.push({ label: "x", patches: broken.patches, inversePatches: entryDoc.inversePatches });
      h.undo(entryDoc.doc);
      expect(h.canRedo).toBe(true);
      expect(() => h.redo(entryDoc.doc)).toThrow();
      expect(h.canRedo).toBe(true);
      expect(h.canUndo).toBe(false);
    });
  });
});

describe("History for cloud trees", () => {
  test("peek shows the entry without moving it; shift moves it", () => {
    const h = new History();
    h.push({ label: "a", patches: [], inversePatches: [] });
    expect(h.peek("undo")?.label).toBe("a");
    expect(h.peek("redo")).toBeNull();
    expect(h.canUndo).toBe(true);
    expect(h.shift("undo")?.label).toBe("a");
    expect(h.canUndo).toBe(false);
    expect(h.peek("redo")?.label).toBe("a");
    h.shift("redo");
    expect(h.canUndo).toBe(true);
  });

  test("amend joins entity changes: first before, last after", () => {
    const h = new History();
    const key = "persons/p1" as const;
    h.push({
      label: "add",
      patches: [],
      inversePatches: [],
      entities: [{ key, before: null, after: { v: 1 } }],
    });
    h.amend({
      label: "name",
      patches: [],
      inversePatches: [],
      entities: [
        { key, before: { v: 1 }, after: { v: 2 } },
        { key: "tree/name", before: "A", after: "B" },
      ],
    });
    expect(h.peek("undo")?.entities).toEqual([
      { key, before: null, after: { v: 2 } },
      { key: "tree/name", before: "A", after: "B" },
    ]);
  });
});
