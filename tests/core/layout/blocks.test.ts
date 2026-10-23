import { describe, expect, test } from "bun:test";

import { applyCommand } from "@/core/commands/apply";
import { buildBlockTree, unreachableFrom } from "@/core/layout/blocks";
import type { Block, BlockMember } from "@/core/layout/types";

import {
  allFamilies,
  docOf,
  famCousinMarriage,
  famRemarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";

const NONE: ReadonlySet<string> = new Set();

function allBlocks(root: Block): Block[] {
  const out: Block[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const block = stack.pop()!;
    out.push(block);
    for (const u of block.unions) stack.push(...u.children);
  }
  return out;
}

function allMembers(root: Block): BlockMember[] {
  return allBlocks(root).flatMap((b) => b.members);
}

function blockOf(root: Block, bloodNodeId: string): Block {
  const block = allBlocks(root).find((b) => b.bloodNodeId === bloodNodeId);
  if (!block) throw new Error(`no block ${bloodNodeId}`);
  return block;
}

const ids = (blocks: Block[]) => blocks.map((b) => b.bloodNodeId);

describe("buildBlockTree", () => {
  test("famSimple: a couple block with three child blocks", () => {
    const { root, primaryNode, unreachable } = buildBlockTree(famSimple(), "dad", NONE);
    expect(root.bloodNodeId).toBe("dad");
    expect(root.depth).toBe(0);
    expect(root.hiddenCount).toBe(0);
    expect(root.members).toEqual([
      { nodeId: "dad", personId: "dad", kind: "blood" },
      { nodeId: "mom", personId: "mom", kind: "spouse" },
    ]);
    expect(root.unions).toHaveLength(1);
    expect(root.unions[0]!.unionId).toBe("u1");
    expect(root.unions[0]!.anchorBetween).toEqual([0, 1]);
    const children = root.unions[0]!.children;
    expect(ids(children)).toEqual(["c1", "c2", "c3"]);
    for (const child of children) {
      expect(child.depth).toBe(1);
      expect(child.members).toHaveLength(1);
      expect(child.members[0]!.kind).toBe("blood");
      expect(child.unions).toEqual([]);
    }
    expect(primaryNode).toEqual({ dad: "dad", mom: "mom", c1: "c1", c2: "c2", c3: "c3" });
    expect(unreachable).toEqual([]);
  });

  test("famRemarriage: [S1, P, S2] with one union entry per marriage", () => {
    const { root } = buildBlockTree(famRemarriage(), "ali", NONE);
    expect(root.members.map((m) => [m.personId, m.kind])).toEqual([
      ["wife1", "spouse"],
      ["ali", "blood"],
      ["wife2", "spouse"],
    ]);
    expect(root.unions.map((u) => [u.unionId, u.anchorBetween, ids(u.children)])).toEqual([
      ["m1", [0, 1], ["a1", "a2"]],
      ["m2", [1, 2], ["a3"]],
    ]);
  });

  test("a third spouse anchors to the gap left of them", () => {
    const doc = docOf(
      [
        person("p", "P", "X", "male"),
        person("s1", "S1", "X", "female"),
        person("s2", "S2", "X", "female"),
        person("s3", "S3", "X", "female"),
      ],
      [union("u1", ["p", "s1"]), union("u2", ["p", "s2"]), union("u3", ["s3", "p"])],
      "p",
    );
    const { root } = buildBlockTree(doc, "p", NONE);
    expect(root.members.map((m) => m.personId)).toEqual(["s1", "p", "s2", "s3"]);
    expect(root.unions.map((u) => u.anchorBetween)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  test("a single-parent union anchors on the parent card", () => {
    const doc = docOf(
      [
        person("p", "P", "X", "male"),
        person("s", "S", "X", "female"),
        person("c1", "C1", "X", "male"),
        person("c2", "C2", "X", "male"),
      ],
      [union("solo", ["p"], ["c1"]), union("u", ["p", "s"], ["c2"])],
      "p",
    );
    const { root } = buildBlockTree(doc, "p", NONE);
    expect(root.members.map((m) => m.personId)).toEqual(["p", "s"]);
    expect(root.unions.map((u) => [u.unionId, u.anchorBetween, ids(u.children)])).toEqual([
      ["solo", [0, 0], ["c1"]],
      ["u", [0, 1], ["c2"]],
    ]);
  });

  test("cousin marriage yields one primary and one linked copy", () => {
    const { root, primaryNode } = buildBlockTree(famCousinMarriage(), "g1", NONE);
    const members = allMembers(root);

    // R15: cousin2 is blood, so she is primary at her blood position under p2 and only a
    // linked copy beside cousin1, who is reached first.
    const cousin2 = members
      .filter((m) => m.personId === "cousin2")
      .toSorted((a, b) => a.nodeId.localeCompare(b.nodeId));
    expect(cousin2.map((m) => [m.nodeId, m.kind])).toEqual([
      ["cousin2", "blood"],
      ["cousin2~1", "linked"],
    ]);
    expect(primaryNode.cousin2).toBe("cousin2");
    expect(blockOf(root, "cousin1").members.map((m) => [m.nodeId, m.kind])).toEqual([
      ["cousin1", "blood"],
      ["cousin2~1", "linked"],
    ]);

    // The union is laid out once, with cousin1, so cousin2's own block holds only her.
    const own = blockOf(root, "cousin2");
    expect(own.members.map((m) => m.nodeId)).toEqual(["cousin2"]);
    expect(own.unions).toEqual([]);
    expect(own.depth).toBe(2);
    expect(ids(blockOf(root, "p2").unions[0]!.children)).toEqual(["cousin2"]);

    // The couple's child appears once, under the couple.
    expect(members.filter((m) => m.personId === "kid")).toHaveLength(1);
    expect(ids(blockOf(root, "cousin1").unions[0]!.children)).toEqual(["kid"]);
  });

  test("R15: blood beats spouse, so a blood relative's other family is still drawn", () => {
    // R -> {A, B}; A -> Y; B -> X; X+Y married; X+Z have K. Y is reached before X.
    const doc = docOf(
      ["r", "rw", "a", "aw", "b", "bw", "y", "x", "z", "k"].map((id) =>
        person(id, id.toUpperCase(), "X", "male"),
      ),
      [
        union("ur", ["r", "rw"], ["a", "b"]),
        union("ua", ["a", "aw"], ["y"]),
        union("ub", ["b", "bw"], ["x"]),
        union("uxy", ["y", "x"]),
        union("uxz", ["x", "z"], ["k"]),
      ],
      "r",
    );
    const { root, unreachable, primaryNode } = buildBlockTree(doc, "r", NONE);
    expect(unreachable).toEqual([]);
    expect(blockOf(root, "y").members.map((m) => [m.nodeId, m.kind])).toEqual([
      ["y", "blood"],
      ["x~1", "linked"],
    ]);
    // uxy was laid out with Y, so X's block only carries uxz.
    const x = blockOf(root, "x");
    expect(x.members.map((m) => [m.nodeId, m.kind])).toEqual([
      ["x", "blood"],
      ["z", "spouse"],
    ]);
    expect(x.unions.map((u) => [u.unionId, u.anchorBetween, ids(u.children)])).toEqual([
      ["uxz", [0, 1], ["k"]],
    ]);
    expect(primaryNode.x).toBe("x");
  });

  test("a spouse's other family is not drawn", () => {
    // mom had c0 with an earlier partner; from dad's view they stay unreachable.
    const base = famSimple();
    const doc = docOf(
      [
        ...Object.values(base.persons),
        person("ex", "Ex", "Y", "male"),
        person("c0", "C0", "Y", "male"),
      ],
      [...Object.values(base.unions), union("u0", ["ex", "mom"], ["c0"])],
      "dad",
    );
    const { root, unreachable } = buildBlockTree(doc, "dad", NONE);
    expect(root.members.map((m) => m.personId)).toEqual(["dad", "mom"]);
    expect(unreachable).toEqual(["ex", "c0"]);
  });

  test("a partner already placed elsewhere becomes a linked member", () => {
    // `s` married `a` first, then `a`'s brother `b`.
    const doc = docOf(
      [
        person("r", "R", "X", "male"),
        person("rw", "RW", "X", "female"),
        person("a", "A", "X", "male"),
        person("b", "B", "X", "male"),
        person("s", "S", "Y", "female"),
      ],
      [union("ur", ["r", "rw"], ["a", "b"]), union("ua", ["a", "s"]), union("ub", ["b", "s"])],
      "r",
    );
    const { root, primaryNode } = buildBlockTree(doc, "r", NONE);
    expect(blockOf(root, "a").members.map((m) => [m.nodeId, m.kind])).toEqual([
      ["a", "blood"],
      ["s", "spouse"],
    ]);
    expect(blockOf(root, "b").members.map((m) => [m.nodeId, m.kind])).toEqual([
      ["b", "blood"],
      ["s~1", "linked"],
    ]);
    expect(primaryNode.s).toBe("s");
  });

  test("collapsed root has no child blocks and counts its descendants", () => {
    const { root, primaryNode } = buildBlockTree(famSimple(), "dad", new Set(["dad"]));
    expect(root.members.map((m) => m.personId)).toEqual(["dad", "mom"]);
    expect(root.unions).toHaveLength(1);
    expect(root.unions[0]!.children).toEqual([]);
    expect(root.hiddenCount).toBe(3);
    expect(Object.keys(primaryNode).toSorted()).toEqual(["dad", "mom"]);

    const deep = buildBlockTree(famCousinMarriage(), "g1", new Set(["g1"]));
    expect(deep.root.hiddenCount).toBe(5);
  });

  test("hiddenCount leaves out descendants placed through another branch", () => {
    // p1 is collapsed, but cousin1 and kid are still reached through p2's daughter.
    const { root, primaryNode } = buildBlockTree(famCousinMarriage(), "g1", new Set(["p1"]));
    expect(blockOf(root, "p1").hiddenCount).toBe(0);
    expect(blockOf(root, "p1").unions[0]!.children).toEqual([]);
    // cousin1 is hidden as blood, so he is placed as cousin2's spouse.
    expect(blockOf(root, "cousin2").members.map((m) => [m.nodeId, m.kind])).toEqual([
      ["cousin2", "blood"],
      ["cousin1", "spouse"],
    ]);
    expect(primaryNode.kid).toBe("kid");
  });

  test("a collapsed person keeps a count of the descendants that stay hidden", () => {
    const { root } = buildBlockTree(famCousinMarriage(), "g1", new Set(["p2"]));
    // cousin2 is placed as cousin1's spouse; nothing below p2 stays hidden.
    expect(blockOf(root, "p2").hiddenCount).toBe(0);
    expect(blockOf(root, "cousin1").members.map((m) => [m.nodeId, m.kind])).toEqual([
      ["cousin1", "blood"],
      ["cousin2", "spouse"],
    ]);
    const { root: root2 } = buildBlockTree(famCousinMarriage(), "g1", new Set(["cousin1"]));
    expect(blockOf(root2, "cousin1").hiddenCount).toBe(1);
    expect(blockOf(root2, "cousin1").members.map((m) => m.nodeId)).toEqual([
      "cousin1",
      "cousin2~1",
    ]);
  });

  test("people hidden only by a collapse are not 'not connected' (I1)", () => {
    // c1 has a wife and a son: collapsing dad hides all of them, but they are still connected.
    const base = famSimple();
    const doc = docOf(
      [
        ...Object.values(base.persons),
        person("w1", "Wife", "Y", "female"),
        person("g1", "Grandson", "Khan", "male"),
        person("ex", "Ex", "Y", "male"),
        person("c0", "C0", "Y", "male"),
      ],
      [
        ...Object.values(base.unions),
        union("uc1", ["c1", "w1"], ["g1"]),
        union("u0", ["ex", "mom"], ["c0"]),
      ],
      "dad",
    );
    for (const collapsed of [new Set(["dad"]), new Set(["mom"]), new Set(["c1"]), NONE]) {
      // mom's earlier family is the only part that is really not connected.
      expect(buildBlockTree(doc, "dad", collapsed).unreachable).toEqual(["ex", "c0"]);
    }
  });

  test("collapsing either partner hides the couple's children", () => {
    const { root, unreachable } = buildBlockTree(famSimple(), "dad", new Set(["mom"]));
    expect(root.unions[0]!.children).toEqual([]);
    expect(root.hiddenCount).toBe(3);
    // Hidden by the collapse, but still connected (I1).
    expect(unreachable).toEqual([]);
  });

  test("a person added with addPerson and no links is unreachable", () => {
    const { doc, createdIds } = applyCommand(famSimple(), {
      type: "addPerson",
      person: { gender: "female", firstName: "Loner" },
    });
    const { unreachable, primaryNode } = buildBlockTree(doc, "dad", NONE);
    expect(unreachable).toEqual([createdIds[0]!]);
    expect(primaryNode[createdIds[0]!]).toBeUndefined();
  });

  test("the root's own parents are not drawn and are unreachable", () => {
    const { root, unreachable } = buildBlockTree(famSimple(), "c2", NONE);
    expect(root.members.map((m) => m.personId)).toEqual(["c2"]);
    expect(unreachable).toEqual(["dad", "mom", "c1", "c3"]);
  });

  test("throws for a root that is not in the document", () => {
    expect(() => buildBlockTree(famSimple(), "nobody", NONE)).toThrow();
  });
});

describe("unreachableFrom", () => {
  test.each(allFamilies)("is the family view's unreachable list from every root: %s", (_, make) => {
    const doc = make();
    for (const rootId of Object.keys(doc.persons)) {
      expect(unreachableFrom(doc, rootId)).toEqual(buildBlockTree(doc, rootId, NONE).unreachable);
    }
  });
});
