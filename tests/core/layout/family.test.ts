import { describe, expect, test } from "bun:test";

import { buildBlockTree } from "@/core/layout/blocks";
import { CARD_H, CARD_W, COUPLE_GAP, DEFAULT_METRICS, GAP, ROW_H } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import type { LayoutResult } from "@/core/layout/types";

import {
  allFamilies,
  docOf,
  famCousinMarriage,
  famRemarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";
import {
  expectBarsBetweenRows,
  expectGroupsUnderAnchors,
  expectNoCrossingChildEdges,
  expectNoOverlappingBrackets,
} from "./checks";

function nodeAt(layout: LayoutResult, nodeId: string) {
  const node = layout.nodes.find((n) => n.nodeId === nodeId);
  if (!node) throw new Error(`no node ${nodeId}`);
  return node;
}

function edge(layout: LayoutResult, id: string) {
  const found = layout.edges.find((e) => e.id === id);
  if (!found) throw new Error(`no edge ${id}`);
  return found;
}

describe("layoutFamily", () => {
  test.each(allFamilies)("%s snapshot", (_, make) => {
    const doc = make();
    expect(layoutFamily(doc, { rootId: doc.rootPersonId! })).toMatchSnapshot();
  });

  test("famSimple geometry: children one GAP apart, parents centred above", () => {
    const layout = layoutFamily(famSimple(), { rootId: "dad" });
    const step = CARD_W + GAP;
    expect([0, 1, 2].map((i) => nodeAt(layout, `c${i + 1}`).x)).toEqual([0, step, 2 * step]);
    for (const id of ["c1", "c2", "c3"]) expect(nodeAt(layout, id).y).toBe(ROW_H);

    const span = (CARD_W / 2 + 2 * step + CARD_W / 2) / 2;
    const dad = nodeAt(layout, "dad");
    const mom = nodeAt(layout, "mom");
    expect(dad.y).toBe(0);
    expect(mom.x - dad.x).toBe(CARD_W + COUPLE_GAP);
    expect((dad.x + mom.x + CARD_W) / 2).toBe(span);

    expect(layout.generationCount).toBe(2);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 2 * step + CARD_W, height: ROW_H + CARD_H });
  });

  test("famSimple connectors", () => {
    const layout = layoutFamily(famSimple(), { rootId: "dad" });
    const dad = nodeAt(layout, "dad");
    const mom = nodeAt(layout, "mom");
    const midY = CARD_H / 2;
    const anchorX = (dad.x + CARD_W + mom.x) / 2;

    expect(edge(layout, "union:u1")).toEqual({
      id: "union:u1",
      kind: "union",
      unionId: "u1",
      status: "married",
      points: [
        [dad.x + CARD_W, midY],
        [mom.x, midY],
      ],
    });
    const c2 = nodeAt(layout, "c2");
    const barY = CARD_H + 24;
    expect(edge(layout, "child:u1:c2")).toEqual({
      id: "child:u1:c2",
      kind: "child",
      unionId: "u1",
      childType: "biological",
      points: [
        [anchorX, midY],
        [anchorX, barY],
        [c2.x + CARD_W / 2, barY],
        [c2.x + CARD_W / 2, ROW_H],
      ],
    });
    expect(layout.edges.filter((e) => e.kind === "child")).toHaveLength(3);
  });

  test("every fixture: children under their union's anchor, no crossings", () => {
    for (const [, make] of allFamilies) {
      const doc = make();
      const rootId = doc.rootPersonId!;
      const layout = layoutFamily(doc, { rootId });
      expectGroupsUnderAnchors(buildBlockTree(doc, rootId, new Set()).root, layout);
      expectNoCrossingChildEdges(layout);
      expectBarsBetweenRows(layout);
    }
  });

  test("a single person is one node at (0, 0)", () => {
    const doc = docOf([person("solo", "Solo", "X", "female")], [], "solo");
    const layout = layoutFamily(doc, { rootId: "solo" });
    expect(layout.nodes).toEqual([
      {
        nodeId: "solo",
        personId: "solo",
        kind: "blood",
        x: 0,
        y: 0,
        generation: 0,
        hiddenCount: 0,
      },
    ]);
    expect(layout.edges).toEqual([]);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: CARD_W, height: CARD_H });
    expect(layout.generationCount).toBe(1);
    expect(layout.primaryNode).toEqual({ solo: "solo" });
    expect(layout.unreachable).toEqual([]);
  });

  test("remarriage: each union's children hang from its own anchor and bar", () => {
    const layout = layoutFamily(famRemarriage(), { rootId: "ali" });
    const [wife1, ali, wife2] = ["wife1", "ali", "wife2"].map((id) => nodeAt(layout, id));
    expect(ali!.x - wife1!.x).toBe(CARD_W + COUPLE_GAP);
    expect(wife2!.x - ali!.x).toBe(CARD_W + COUPLE_GAP);

    const first = edge(layout, "child:m1:a1").points;
    const second = edge(layout, "child:m2:a3").points;
    expect(first[0]).toEqual([(wife1!.x + CARD_W + ali!.x) / 2, CARD_H / 2]);
    expect(second[0]).toEqual([(ali!.x + CARD_W + wife2!.x) / 2, CARD_H / 2]);
    // m1 has the wider group, so it is centred under its anchor and its bar is the lowest.
    const a1 = nodeAt(layout, "a1");
    const a2 = nodeAt(layout, "a2");
    expect((a1.x + a2.x + CARD_W) / 2).toBe(first[0]![0]);
    expect(first[1]![1]).toBe(CARD_H + 24 + 8);
    expect(second[1]![1]).toBe(CARD_H + 24);
    expect(edge(layout, "union:m1").status).toBe("divorced");
  });

  test("a third spouse is joined by an over-bracket from the blood person", () => {
    const doc = docOf(
      [
        person("p", "P", "X", "male"),
        person("s1", "S1", "X", "female"),
        person("s2", "S2", "X", "female"),
        person("s3", "S3", "X", "female"),
      ],
      [union("u1", ["p", "s1"]), union("u2", ["p", "s2"]), union("u3", ["p", "s3"], [], "partner")],
      "p",
    );
    const layout = layoutFamily(doc, { rootId: "p" });
    const p = nodeAt(layout, "p");
    const s3 = nodeAt(layout, "s3");
    const pc = p.x + CARD_W / 2;
    const sc = s3.x + CARD_W / 2;
    // It starts just right of P's top centre, clear of the line from P's parents.
    expect(edge(layout, "union:u3").points).toEqual([
      [pc + 8, 0],
      [pc + 8, -12],
      [sc, -12],
      [sc, 0],
    ]);
    expect(edge(layout, "union:u2").points).toEqual([
      [p.x + CARD_W, CARD_H / 2],
      [nodeAt(layout, "s2").x, CARD_H / 2],
    ]);
    expect(layout.bounds.y).toBe(-12);
    expect(layout.bounds.height).toBe(CARD_H + 12);
  });

  test("R12: a big first marriage and a small second one do not cross", () => {
    const kids = ["k1", "k2", "k3", "k4", "k5"];
    const doc = docOf(
      [
        person("p", "P", "X", "male"),
        person("s1", "S1", "X", "female"),
        person("s2", "S2", "X", "female"),
        ...kids.map((id) => person(id, id, "X", "male")),
        person("j", "J", "X", "male"),
      ],
      [union("u1", ["p", "s1"], kids), union("u2", ["p", "s2"], ["j"])],
      "p",
    );
    const layout = layoutFamily(doc, { rootId: "p" });
    expectNoCrossingChildEdges(layout);
    // u1's group is the wider one, so it is centred under u1's anchor. j is pushed right of
    // u1's anchor, and u2's bar runs above u1's, so u2's drop ends before reaching u1's bar.
    const u1 = edge(layout, "child:u1:k1").points;
    const u2 = edge(layout, "child:u2:j").points;
    const k1 = nodeAt(layout, "k1");
    const k5 = nodeAt(layout, "k5");
    expect((k1.x + k5.x + CARD_W) / 2).toBe(u1[0]![0]);
    expect(nodeAt(layout, "j").x + CARD_W / 2).toBeGreaterThan(u1[0]![0]);
    expect(u2[1]![1]).toBeLessThan(u1[1]![1]);
  });

  test("R12: brackets of later spouses nest, and their children drop from the bracket", () => {
    const doc = docOf(
      [
        person("p", "P", "X", "male"),
        ...["s1", "s2", "s3", "s4"].map((id) => person(id, id, "X", "female")),
        ...["c1", "c2", "c3", "c4"].map((id) => person(id, id, "X", "male")),
      ],
      [
        union("u1", ["p", "s1"], ["c1"]),
        union("u2", ["p", "s2"], ["c2"]),
        union("u3", ["p", "s3"], ["c3"]),
        union("u4", ["p", "s4"], ["c4"]),
      ],
      "p",
    );
    const layout = layoutFamily(doc, { rootId: "p" });
    expectNoOverlappingBrackets(layout);
    expectNoCrossingChildEdges(layout);
    const u3 = edge(layout, "union:u3").points;
    const u4 = edge(layout, "union:u4").points;
    expect(u3[1]![1]).toBe(-12);
    expect(u4[1]![1]).toBeLessThan(-12);
    // The outer bracket starts left of the inner one and ends right of it.
    expect(u4[0]![0]).toBeLessThan(u3[0]![0]);
    expect(u4[3]![0]).toBeGreaterThan(u3[3]![0]);

    // u3's child line starts on u3's bracket, above the gap between s2 and s3.
    const s2 = nodeAt(layout, "s2");
    const s3 = nodeAt(layout, "s3");
    expect(edge(layout, "child:u3:c3").points[0]).toEqual([(s2.x + CARD_W + s3.x) / 2, -12]);
    expect(edge(layout, "child:u4:c4").points[0]![1]).toBe(u4[1]![1]);
  });

  test("with many unions every sibling bar stays between the rows", () => {
    const spouses = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const doc = docOf(
      [
        person("p", "P", "X", "male"),
        ...spouses.map((id) => person(id, id, "X", "female")),
        ...spouses.map((id) => person(`c${id}`, id, "X", "male")),
        person("solo1", "C", "X", "male"),
        person("solo2", "C", "X", "male"),
      ],
      [
        ...spouses.map((id) => union(`u${id}`, ["p", id], [`c${id}`])),
        union("o1", ["p"], ["solo1"]),
        union("o2", ["p"], ["solo2"]),
      ],
      "p",
    );
    const layout = layoutFamily(doc, { rootId: "p" });
    expectBarsBetweenRows(layout);
    expectNoCrossingChildEdges(layout);
    expectNoOverlappingBrackets(layout);
    const bars = new Set(
      layout.edges.filter((e) => e.kind === "child").map((e) => e.points[1]![1]),
    );
    expect(bars.size).toBeGreaterThan(1);
  });

  test("a single-parent union drops from the bottom of the parent card", () => {
    const doc = docOf(
      [person("p", "P", "X", "male"), person("c", "C", "X", "male")],
      [union("solo", ["p"], [["c", "adopted"]])],
      "p",
    );
    const layout = layoutFamily(doc, { rootId: "p" });
    expect(layout.edges.map((e) => e.id)).toEqual(["child:solo:c"]);
    const p = nodeAt(layout, "p");
    expect(edge(layout, "child:solo:c").points[0]).toEqual([p.x + CARD_W / 2, CARD_H]);
    expect(edge(layout, "child:solo:c").childType).toBe("adopted");
  });

  test("subtrees nest: a leaf sibling packs against its sibling's row, not its whole subtree", () => {
    // `a` has four children below; its sibling `b` is a leaf.
    const doc = docOf(
      [
        person("r", "R", "X", "male"),
        person("a", "A", "X", "male"),
        person("b", "B", "X", "male"),
        ...["k1", "k2", "k3", "k4"].map((id) => person(id, id, "X", "male")),
      ],
      [union("ur", ["r"], ["a", "b"]), union("ua", ["a"], ["k1", "k2", "k3", "k4"])],
      "r",
    );
    const layout = layoutFamily(doc, { rootId: "r" });
    expect(nodeAt(layout, "b").x - nodeAt(layout, "a").x).toBe(CARD_W + GAP);
    expect(nodeAt(layout, "k4").x).toBeGreaterThan(nodeAt(layout, "b").x);
  });

  test("subtrees with children at the same depth are pushed apart by their contours", () => {
    const doc = docOf(
      [
        person("r", "R", "X", "male"),
        person("a", "A", "X", "male"),
        person("b", "B", "X", "male"),
        ...["k1", "k2", "k3", "k4", "j1"].map((id) => person(id, id, "X", "male")),
      ],
      [
        union("ur", ["r"], ["a", "b"]),
        union("ua", ["a"], ["k1", "k2", "k3", "k4"]),
        union("ub", ["b"], ["j1"]),
      ],
      "r",
    );
    const layout = layoutFamily(doc, { rootId: "r" });
    expect(nodeAt(layout, "j1").x - nodeAt(layout, "k4").x).toBe(CARD_W + GAP);
    expect(nodeAt(layout, "b").x).toBe(nodeAt(layout, "j1").x);
  });

  test("linked copies, collapse badges and unreachable people pass through", () => {
    const linked = layoutFamily(famCousinMarriage(), { rootId: "g1" });
    expect(nodeAt(linked, "cousin2~1").kind).toBe("linked");
    expect(nodeAt(linked, "cousin2~1").generation).toBe(2);
    expect(linked.primaryNode.cousin2).toBe("cousin2");

    const collapsed = layoutFamily(famSimple(), { rootId: "dad", collapsed: new Set(["dad"]) });
    expect(collapsed.nodes.map((n) => [n.nodeId, n.hiddenCount])).toEqual([
      ["dad", 3],
      ["mom", 0],
    ]);
    expect(collapsed.edges.map((e) => e.id)).toEqual(["union:u1"]);

    const fromChild = layoutFamily(famSimple(), { rootId: "c1" });
    expect(fromChild.unreachable).toEqual(["dad", "mom", "c2", "c3"]);
  });

  test("a root that is not in the document gives an empty layout", () => {
    const layout = layoutFamily(famSimple(), { rootId: "nobody" });
    expect(layout).toEqual({
      nodes: [],
      edges: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      generationCount: 0,
      primaryNode: {},
      unreachable: ["dad", "mom", "c1", "c2", "c3"],
      metrics: DEFAULT_METRICS,
    });
  });
});
