import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";
import { applyPatches } from "immer";

import { History } from "@/core/commands/history";
import { isAncestor, topmostAncestor } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import { validate } from "@/core/model/validate";

import {
  ALL_KINDS,
  type AppliedCounts,
  arbFamily,
  arbFamilyOps,
  arbOp,
  buildFamily,
  resolveOp,
  runs,
  tryApply,
} from "../../fixtures/arbitraries";

// Each run builds a family from up to 60 commands, so give the 10,000-run `verify` room.
const TIMEOUT_MS = 10 * 60 * 1000;
const numRuns = runs();
const MIN_RUNS_FOR_COVERAGE = 500;
const COMMAND_TYPES = [...ALL_KINDS];

function expectNoDuplicatePartners(doc: TreeDocument) {
  for (const union of Object.values(doc.unions)) {
    expect(new Set(union.partners).size).toBe(union.partners.length);
  }
}

describe("properties over random families", () => {
  test(
    "every generated family is valid",
    () => {
      fc.assert(
        fc.property(arbFamily(), (doc) => {
          expect(validate(doc)).toEqual([]);
          expectNoDuplicatePartners(doc);
        }),
        { numRuns },
      );
    },
    TIMEOUT_MS,
  );

  test(
    "one more random command, then its inverse patches, restores the document",
    () => {
      // Rejected commands return early, so count what was really applied: a property that
      // silently rejects everything of one kind would prove nothing about it.
      const applied: AppliedCounts = {};
      fc.assert(
        fc.property(arbFamilyOps(), arbOp(ALL_KINDS), (ops, op) => {
          const doc = buildFamily(ops, applied);
          const cmd = resolveOp(doc, op);
          if (!cmd) return;
          const result = tryApply(doc, cmd);
          if (!result) return;
          applied[cmd.type] = (applied[cmd.type] ?? 0) + 1;
          expect(validate(result.doc)).toEqual([]);
          expect(applyPatches(result.doc, result.inversePatches)).toEqual(doc);
          expect(applyPatches(doc, result.patches)).toEqual(result.doc);
        }),
        { numRuns },
      );
      if (numRuns >= MIN_RUNS_FOR_COVERAGE) {
        const never = COMMAND_TYPES.filter((type) => !applied[type]);
        expect(never).toEqual([]);
      }
    },
    TIMEOUT_MS,
  );

  test(
    "no person is their own ancestor",
    () => {
      fc.assert(
        fc.property(arbFamily(), (doc) => {
          for (const id of Object.keys(doc.persons)) {
            expect(isAncestor(doc, id, id)).toBe(false);
            // walking up always ends at a person without biological parents
            expect(Object.hasOwn(doc.persons, topmostAncestor(doc, id))).toBe(true);
          }
        }),
        { numRuns },
      );
    },
    TIMEOUT_MS,
  );

  test(
    "undoing a whole editing session returns the empty start, redoing returns the end",
    () => {
      fc.assert(
        fc.property(arbFamilyOps({ maxOps: 25 }), arbFamilyOps({ maxOps: 25 }), (first, second) => {
          const start = buildFamily(first);
          const history = new History();
          let doc = start;
          for (const op of second) {
            const cmd = resolveOp(doc, op);
            const result = cmd && tryApply(doc, cmd);
            if (!result) continue;
            history.push({
              label: result.patches.length.toString(),
              patches: result.patches,
              inversePatches: result.inversePatches,
            });
            doc = result.doc;
          }
          const end = doc;
          for (let d = history.undo(doc); d; d = history.undo(d)) doc = d;
          expect(doc).toEqual(start);
          for (let d = history.redo(doc); d; d = history.redo(d)) doc = d;
          expect(doc).toEqual(end);
        }),
        { numRuns: Math.max(1, Math.floor(numRuns / 4)) },
      );
    },
    TIMEOUT_MS,
  );
});
