import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import { diffDocs } from "@/sync/changes";
import { applyRevert, entityChanges } from "@/sync/revert";

import { ALL_KINDS, arbOp, buildFamily, resolveOp, runs, tryApply } from "../fixtures/arbitraries";
import { canonicalDoc, contentOf } from "../fixtures/canonical";
import { NOW } from "../fixtures/commandHelpers";
import { famSimple } from "../fixtures/families";

const LATER = new Date("2026-06-01T00:00:00.000Z");

describe("revert", () => {
  test("undo restores the content before; redo restores the content after", () => {
    fc.assert(
      fc.property(fc.array(arbOp(ALL_KINDS), { maxLength: 40 }), arbOp(ALL_KINDS), (ops, last) => {
        const before = buildFamily(ops);
        const cmd = resolveOp(before, last);
        const result = cmd && tryApply(before, cmd);
        if (!result) return;
        const entries = entityChanges(diffDocs(before, result.doc), before);
        if (entries.length === 0) return; // nothing but updatedAt changed: nothing to undo
        const undone = applyRevert(result.doc, entries, "undo", LATER);
        expect(contentOf(undone.doc)).toBe(contentOf(before));
        expect(undone.doc.updatedAt).toBe(LATER.toISOString());
        const redone = applyRevert(undone.doc, entries, "redo", LATER);
        expect(contentOf(redone.doc)).toBe(contentOf(result.doc));
      }),
      { numRuns: runs() },
    );
  });

  test("the changes it returns rebuild its document", () => {
    const before = famSimple();
    const after = applyCommand(before, { type: "renameTree", name: "Other" }, NOW).doc;
    const entries = entityChanges(diffDocs(before, after), before);
    expect(entries).toEqual([{ key: "tree/name", before: before.name, after: "Other" }]);
    const undone = applyRevert(after, entries, "undo", LATER);
    expect(undone.changes.tree).toEqual({ name: before.name, updatedAt: LATER.toISOString() });
  });

  test("undo is refused with CONFLICT when someone changed the entity since", () => {
    const before = famSimple();
    const id = Object.keys(before.persons)[0]!;
    const after = applyCommand(
      before,
      { type: "updatePerson", personId: id, patch: { firstName: "Mine" } },
      NOW,
    ).doc;
    const entries = entityChanges(diffDocs(before, after), before);
    const theirs = applyCommand(
      after,
      { type: "updatePerson", personId: id, patch: { notes: "theirs" } },
      NOW,
    ).doc;
    try {
      applyRevert(theirs, entries, "undo", LATER);
      throw new Error("expected a conflict");
    } catch (e) {
      expect(e).toBeInstanceOf(CommandError);
      expect((e as CommandError).code).toBe("CONFLICT");
      expect((e as CommandError).key).toBe(`persons/${id}`);
    }
  });

  test("undo of an add deletes the person; redo appends it again", () => {
    const before = famSimple();
    const result = applyCommand(
      before,
      { type: "addPerson", person: { gender: "male", firstName: "New" } },
      NOW,
    );
    const entries = entityChanges(diffDocs(before, result.doc), before);
    const undone = applyRevert(result.doc, entries, "undo", LATER).doc;
    expect(undone.persons[result.createdIds[0]!]).toBeUndefined();
    const redone = applyRevert(undone, entries, "redo", LATER).doc;
    expect(Object.keys(redone.persons).at(-1)).toBe(result.createdIds[0]!);
    expect(canonicalDoc({ ...redone, updatedAt: NOW.toISOString() })).toBe(
      canonicalDoc(result.doc),
    );
  });

  test("a revert that would leave an invalid tree is refused with INVALID", () => {
    const before = famSimple();
    const [a] = Object.keys(before.persons);
    // Claim that the person was added (absent before): undoing would delete them and leave
    // dangling union references.
    const entries = [{ key: `persons/${a}` as const, before: null, after: before.persons[a!]! }];
    try {
      applyRevert(before, entries, "undo", LATER);
      throw new Error("expected INVALID");
    } catch (e) {
      expect((e as CommandError).code).toBe("INVALID");
    }
  });
});
