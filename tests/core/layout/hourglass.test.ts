import { describe, expect, test } from "bun:test";

import { CARD_W, ROW_H } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import { layoutHourglass } from "@/core/layout/hourglass";
import type { LayoutResult } from "@/core/layout/types";

import {
  docOf,
  famAdoptedOnly,
  famCousinMarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";
import { expectNoCrossingChildEdges } from "./checks";

function nodeAt(layout: LayoutResult, nodeId: string) {
  const node = layout.nodes.find((n) => n.nodeId === nodeId);
  if (!node) throw new Error(`no node ${nodeId}`);
  return node;
}

describe("layoutHourglass", () => {
  test("ancestors above the focus, the family view below, joined at generation 0", () => {
    const doc = famCousinMarriage();
    const layout = layoutHourglass(doc, { focusId: "cousin1" });
    const gens = Object.fromEntries(layout.nodes.map((n) => [n.nodeId, n.generation]));
    expect(gens).toEqual({ g1: -2, g2: -2, p1: -1, s1: -1, cousin1: 0, cousin2: 0, kid: 1 });
    for (const n of layout.nodes) expect(n.y).toBe((n.generation + 2) * ROW_H);
    expect(Math.min(...layout.nodes.map((n) => n.x))).toBe(0);
    expect(nodeAt(layout, "cousin1").kind).toBe("blood");
    expect(nodeAt(layout, "cousin2").kind).toBe("spouse");

    // The parents centre over the focus; the family part keeps its own shape.
    const parents = (nodeAt(layout, "p1").x + nodeAt(layout, "s1").x + CARD_W) / 2;
    expect(parents).toBe(nodeAt(layout, "cousin1").x + CARD_W / 2);
    const family = layoutFamily(doc, { rootId: "cousin1" });
    const dx = nodeAt(layout, "cousin1").x - family.nodes.find((n) => n.nodeId === "cousin1")!.x;
    for (const n of family.nodes) {
      expect(nodeAt(layout, n.nodeId).x).toBe(n.x + dx);
    }

    expect(layout.edges.map((e) => e.id).toSorted()).toEqual(
      [
        "union:ug",
        "child:ug:p1",
        "union:up1",
        "child:up1:cousin1",
        "union:uc",
        "child:uc:kid",
      ].toSorted(),
    );
    expectNoCrossingChildEdges(layout, (e) => String(e.points[0]));
    expect(layout.unreachable).toEqual(["p2", "s2"]);
    expect(layout.generationCount).toBe(4);
  });

  test("an ancestor who is also a partner below is primary as the ancestor", () => {
    const doc = docOf(
      [
        person("a", "A", "", "male"),
        person("b", "B", "", "female"),
        person("c", "C", "", "male"),
        person("d", "D", "", "female"),
        person("f", "F", "", "male"),
      ],
      [union("ub", ["c", "d"], ["b"]), union("uf", ["a", "b"], ["f"]), union("ux", ["f", "d"])],
      "c",
    );
    const layout = layoutHourglass(doc, { focusId: "f" });
    const d = layout.nodes.filter((n) => n.personId === "d");
    expect(d.map((n) => [n.nodeId, n.kind, n.generation])).toEqual([
      ["d", "blood", -2],
      ["d~1", "linked", 0],
    ]);
    expect(new Set(layout.nodes.map((n) => n.nodeId)).size).toBe(layout.nodes.length);
    expect(layout.primaryNode.d).toBe("d");
  });

  test("collapsing the focus hides both ancestors and descendants", () => {
    const layout = layoutHourglass(famCousinMarriage(), {
      focusId: "cousin1",
      collapsed: new Set(["cousin1"]),
    });
    expect(layout.nodes.map((n) => n.nodeId).toSorted()).toEqual(["cousin1", "cousin2"]);
    expect(nodeAt(layout, "cousin1").hiddenCount).toBe(5);
  });

  test("a focus with no ancestors is just the family view", () => {
    const doc = famSimple();
    const layout = layoutHourglass(doc, { focusId: "dad" });
    expect(layout).toEqual(layoutFamily(doc, { rootId: "dad" }));
  });

  test("a focus outside the document gives an empty layout", () => {
    expect(layoutHourglass(famSimple(), { focusId: "nobody" }).nodes).toEqual([]);
  });

  test("someone with only adoptive parents has them above, on a dotted adopted line", () => {
    const layout = layoutHourglass(famAdoptedOnly(), { focusId: "k2" });
    const gens = Object.fromEntries(layout.nodes.map((n) => [n.nodeId, n.generation]));
    expect(gens).toEqual({ ga: -2, gb: -2, a: -1, b: -1, k2: 0 });
    expect(layout.edges.find((e) => e.id === "child:ua:k2")?.childType).toBe("adopted");
  });
});
