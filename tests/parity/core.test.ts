import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import type { TreeDocument } from "@/core/model/types";
import { validate } from "@/core/model/validate";
import { type Changes, diffDocs } from "@/sync/changes";
import { applyRevert, entityChanges } from "@/sync/revert";
import { decodeCommand, encodeCommand } from "@/sync/wire";

import {
  ALL_KINDS,
  arbOp,
  buildFamily,
  type FamilyOp,
  resolveOp,
  runs,
  tryApply,
} from "../fixtures/arbitraries";
import { canonicalDoc, sorted } from "../fixtures/canonical";
import { allFamilies } from "../fixtures/families";
import { loadCore } from "./wasm";

const core = loadCore();
const STAMP = new Date("2026-01-01T00:00:00.000Z");
const LATER = new Date("2026-02-01T00:00:00.000Z");
/** Few distinct years, so equal dates (ties in sibling and union order) are common. */
const TIES = { min: 1990, max: 1992 };
const opId = (i: number) => `op${String(i).padStart(8, "0")}`;

type Outcome =
  | { ok: { doc: TreeDocument; changes: Changes; createdIds: string[] } }
  | { err: { code: string; key?: string } };

const entries = (m: Record<string, unknown>) => Object.keys(m).map((k) => [k, sorted(m[k])]);

/** Changes as text: map order kept (new keys append), values compared by content. */
function changesText(c: Changes): string {
  return JSON.stringify({
    persons: entries(c.persons),
    unions: entries(c.unions),
    unionOrder: entries(c.unionOrder),
    tree: sorted(c.tree),
  });
}

function expectSame(
  rust: Outcome,
  ts: () => { doc: TreeDocument; changes: Changes; createdIds?: string[] },
) {
  let result;
  try {
    result = ts();
  } catch (e) {
    if (!(e instanceof CommandError)) throw e;
    expect("err" in rust ? rust.err.code : "applied").toBe(e.code);
    if (e.code === "CONFLICT" && "err" in rust) expect(rust.err.key).toBe(e.key);
    return null;
  }
  if ("err" in rust) throw new Error(`Rust refused with ${rust.err.code}; TS applied it`);
  expect(canonicalDoc(rust.ok.doc)).toBe(canonicalDoc(result.doc));
  expect(changesText(rust.ok.changes)).toBe(changesText(result.changes));
  if (result.createdIds) expect(rust.ok.createdIds).toEqual(result.createdIds);
  return result.doc;
}

/** Replays ops from `start` through both cores, step by step, keeping them in lockstep. */
function replay(start: TreeDocument, ops: readonly FamilyOp[]): void {
  let doc = start;
  for (const [i, op] of ops.entries()) {
    const cmd = resolveOp(doc, op);
    if (!cmd) continue;
    const wire = JSON.stringify(encodeCommand(cmd));
    const rust = JSON.parse(
      core.apply_command_json(JSON.stringify(doc), wire, STAMP.toISOString(), opId(i)),
    );
    const next = expectSame(rust, () => {
      const r = applyCommand(doc, decodeCommand(JSON.parse(wire)), { now: STAMP, opId: opId(i) });
      return { doc: r.doc, changes: diffDocs(doc, r.doc), createdIds: r.createdIds };
    });
    if (next) doc = next;
  }
}

describe("TS and Rust cores agree", () => {
  test("on every command, from a one-person tree", () => {
    fc.assert(
      fc.property(fc.array(arbOp(ALL_KINDS, TIES), { maxLength: 60 }), (ops) =>
        replay(buildFamily([]), ops),
      ),
      { numRuns: runs() },
    );
  });

  test.each(allFamilies)("on every command, from the %s fixture", (_name, family) => {
    fc.assert(
      fc.property(fc.array(arbOp(ALL_KINDS, TIES), { maxLength: 30 }), (ops) =>
        replay(family(), ops),
      ),
      { numRuns: Math.max(50, runs() / 20) },
    );
  });

  test("on union order when start dates tie", () => {
    const pick = fc.record({
      union: fc.nat(10),
      year: fc.option(fc.integer({ min: 1990, max: 1991 })),
      month: fc.option(fc.integer({ min: 1, max: 2 })),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        fc.array(pick, { minLength: 1, maxLength: 12 }),
        (spouses, edits) => {
          let doc = buildFamily([]);
          const root = doc.rootPersonId!;
          for (let i = 0; i < spouses; i++) {
            doc = applyCommand(
              doc,
              { type: "addSpouse", personId: root, spouse: { gender: "female" } },
              { now: STAMP, opId: opId(900 + i) },
            ).doc;
          }
          for (const [i, edit] of edits.entries()) {
            const unions = doc.unionOrder[root]!;
            const start =
              edit.year === null
                ? undefined
                : edit.month === null
                  ? { year: edit.year }
                  : { year: edit.year, month: edit.month };
            const cmd = {
              type: "updateUnion" as const,
              unionId: unions[edit.union % unions.length]!,
              patch: { start },
            };
            const wire = JSON.stringify(encodeCommand(cmd));
            const rust = JSON.parse(
              core.apply_command_json(JSON.stringify(doc), wire, STAMP.toISOString(), opId(i)),
            );
            doc = expectSame(rust, () => {
              const r = applyCommand(doc, decodeCommand(JSON.parse(wire)), {
                now: STAMP,
                opId: opId(i),
              });
              return { doc: r.doc, changes: diffDocs(doc, r.doc) };
            })!;
          }
        },
      ),
      { numRuns: runs() },
    );
  });

  test("on reverts, including conflicts", () => {
    fc.assert(
      fc.property(
        fc.array(arbOp(ALL_KINDS, TIES), { maxLength: 40 }),
        arbOp(ALL_KINDS, TIES),
        fc.option(arbOp(ALL_KINDS, TIES), { nil: undefined }),
        fc.boolean(),
        (ops, mine, theirs, redoFirst) => {
          const before = buildFamily(ops);
          const cmd = resolveOp(before, mine);
          const applied = cmd && tryApply(before, cmd);
          if (!applied) return;
          const entries = entityChanges(diffDocs(before, applied.doc), before);
          // Someone else's edit in between, sometimes; redo is tried on the unreverted document.
          let doc = applied.doc;
          const other = theirs && resolveOp(doc, theirs);
          const otherApplied = other && tryApply(doc, other);
          if (otherApplied) doc = otherApplied.doc;
          const direction = redoFirst ? "redo" : "undo";
          const rust = JSON.parse(
            core.apply_revert_json(
              JSON.stringify(doc),
              JSON.stringify(entries),
              direction,
              LATER.toISOString(),
            ),
          );
          expectSame(rust, () => applyRevert(doc, entries, direction, LATER));
        },
      ),
      { numRuns: runs() },
    );
  });

  test("on validate, for broken documents", () => {
    fc.assert(
      fc.property(
        fc.array(arbOp(ALL_KINDS, TIES), { maxLength: 30 }),
        fc.nat(1000),
        fc.nat(1000),
        fc.integer({ min: 0, max: 6 }),
        (ops, a, b, kind) => {
          const doc = structuredClone(buildFamily(ops)) as TreeDocument;
          const people = Object.keys(doc.persons);
          const unions = Object.values(doc.unions);
          const p = people[a % people.length]!;
          const u = unions.length > 0 ? unions[b % unions.length]! : undefined;
          if (kind === 0) doc.rootPersonId = "ghost";
          if (kind === 1 && u) u.children.push({ personId: "ghost", type: "biological" });
          if (kind === 2 && u && u.children[0]) u.children.push(u.children[0]);
          if (kind === 3) doc.unionOrder[p] = ["ghost", ...(doc.unionOrder[p] ?? [])];
          if (kind === 4 && u) (u as { partners: string[] }).partners = [];
          if (kind === 5 && u) u.children.push({ personId: u.partners[0]!, type: "adopted" });
          if (kind === 6) doc.unionOrder["ghost"] = [];
          const rust = JSON.parse(core.validate_json(JSON.stringify(doc)));
          expect(rust).toEqual(validate(doc).map(({ code, ids }) => ({ code, ids })));
        },
      ),
      { numRuns: runs() },
    );
  });
});
