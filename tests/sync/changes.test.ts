import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { applyCommand } from "@/core/commands/apply";
import { applyChanges, diffDocs } from "@/sync/changes";

import { ALL_KINDS, arbOp, buildFamily, resolveOp, runs, tryApply } from "../fixtures/arbitraries";
import { canonicalDoc } from "../fixtures/canonical";
import { NOW } from "../fixtures/commandHelpers";
import { docOf, person, union } from "../fixtures/families";

describe("diffDocs and applyChanges", () => {
  test("applyChanges(before, diffDocs(before, after)) equals after, map order included", () => {
    fc.assert(
      fc.property(fc.array(arbOp(ALL_KINDS), { maxLength: 40 }), arbOp(ALL_KINDS), (ops, last) => {
        const before = buildFamily(ops);
        const cmd = resolveOp(before, last);
        const result = cmd && tryApply(before, cmd);
        if (!result) return;
        const rebuilt = applyChanges(before, diffDocs(before, result.doc));
        expect(canonicalDoc(rebuilt)).toBe(canonicalDoc(result.doc));
      }),
      { numRuns: runs() },
    );
  });

  test("lists only what changed, with removals as null and updatedAt always", () => {
    const before = docOf(
      [person("a", "A", "", "male"), person("b", "B", "", "female")],
      [union("u1", ["a", "b"])],
      "a",
    );
    const after = applyCommand(
      before,
      { type: "deletePerson", personId: "b", mode: "person" },
      NOW,
    ).doc;
    const changes = diffDocs(before, after);
    expect(changes.persons).toEqual({ b: null });
    expect(changes.unions).toEqual({ u1: after.unions["u1"]! });
    expect(changes.unionOrder).toEqual({ b: null });
    expect(changes.tree).toEqual({ updatedAt: NOW.toISOString() });
  });

  test("an array reassigned with equal contents is not a change", () => {
    const before = docOf([person("a", "A", "", "male")], [union("u1", ["a"])], "a");
    const after = {
      ...before,
      unions: { u1: { ...before.unions["u1"]!, partners: ["a"] as [string] } },
    };
    expect(diffDocs(before, after).unions).toEqual({});
  });

  test("tree name and root changes are reported, a removed root as null", () => {
    const before = docOf([person("a", "A", "", "male")], [], "a");
    const after = { ...before, name: "New", rootPersonId: undefined };
    expect(diffDocs(before, after).tree).toEqual({
      name: "New",
      rootPersonId: null,
      updatedAt: before.updatedAt,
    });
  });

  test("new keys are appended in order; existing keys keep their place", () => {
    const doc = docOf([person("a", "A", "", "male"), person("b", "B", "", "male")], [], "a");
    const next = applyChanges(doc, {
      persons: {
        z: person("z", "Z", "", "male"),
        a: person("a", "A2", "", "male"),
        y: person("y", "Y", "", "male"),
      },
      unions: {},
      unionOrder: {},
      tree: { updatedAt: NOW.toISOString() },
    });
    expect(Object.keys(next.persons)).toEqual(["a", "b", "z", "y"]);
    expect(next.persons["a"]!.firstName).toBe("A2");
    expect(next.updatedAt).toBe(NOW.toISOString());
  });
});
