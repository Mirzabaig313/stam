import { describe, expect, test } from "bun:test";

import { CARD_H, CARD_W, COUPLE_GAP, ROW_H } from "@/core/layout/constants";
import { layoutPedigree } from "@/core/layout/pedigree";
import type { LayoutResult } from "@/core/layout/types";

import {
  docOf,
  famAdoptedOnly,
  famAdoption,
  famCousinMarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";
import { expectNoCrossingChildEdges } from "./checks";

const STEP = CARD_W + COUPLE_GAP;

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

const centre = (layout: LayoutResult, nodeId: string) => nodeAt(layout, nodeId).x + CARD_W / 2;
const coupleCentre = (layout: LayoutResult, a: string, b: string) =>
  (nodeAt(layout, a).x + nodeAt(layout, b).x + CARD_W) / 2;

describe("layoutPedigree", () => {
  test("famSimple: the focus at the bottom, both parents as a couple above", () => {
    const layout = layoutPedigree(famSimple(), { focusId: "c1" });
    expect(layout.nodes.map((n) => [n.nodeId, n.kind, n.generation])).toEqual([
      ["c1", "blood", 0],
      ["dad", "blood", -1],
      ["mom", "blood", -1],
    ]);
    const dad = nodeAt(layout, "dad");
    const mom = nodeAt(layout, "mom");
    const c1 = nodeAt(layout, "c1");
    expect([dad.y, mom.y, c1.y]).toEqual([0, 0, ROW_H]);
    expect(mom.x - dad.x).toBe(STEP);
    expect(dad.x).toBe(0);
    expect(coupleCentre(layout, "dad", "mom")).toBe(centre(layout, "c1"));

    expect(edge(layout, "union:u1").points).toEqual([
      [CARD_W, CARD_H / 2],
      [STEP, CARD_H / 2],
    ]);
    const anchor = coupleCentre(layout, "dad", "mom");
    const child = edge(layout, "child:u1:c1");
    expect(child.kind).toBe("child");
    expect(child.unionId).toBe("u1");
    expect(child.childType).toBe("biological");
    expect(child.points[0]).toEqual([anchor, CARD_H / 2]);
    expect(child.points.at(-1)).toEqual([centre(layout, "c1"), ROW_H]);

    expect(layout.generationCount).toBe(2);
    expect(layout.primaryNode).toEqual({ c1: "c1", dad: "dad", mom: "mom" });
    expect(layout.unreachable).toEqual(["c2", "c3"]);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: STEP + CARD_W, height: ROW_H + CARD_H });
  });

  test("the father sits left even when the union lists the mother first", () => {
    const doc = docOf(
      [
        person("m", "Sara", "", "female"),
        person("f", "Ali", "", "male"),
        person("k", "K", "", "male"),
      ],
      [union("u", ["m", "f"], ["k"])],
      "m",
    );
    const layout = layoutPedigree(doc, { focusId: "k" });
    expect(nodeAt(layout, "f").x).toBeLessThan(nodeAt(layout, "m").x);
  });

  test("a single parent sits alone, straight above the child, with the line from the bottom", () => {
    const doc = docOf(
      [person("m", "Sara", "", "female"), person("k", "K", "", "male")],
      [union("u", ["m"], ["k"])],
      "m",
    );
    const layout = layoutPedigree(doc, { focusId: "k" });
    expect(nodeAt(layout, "m").x).toBe(nodeAt(layout, "k").x);
    expect(layout.edges.filter((e) => e.kind === "union")).toEqual([]);
    expect(edge(layout, "child:u:k").points[0]).toEqual([CARD_W / 2, CARD_H]);
  });

  test("prefers biological parents when there are both", () => {
    const layout = layoutPedigree(famAdoption(), { focusId: "k2" });
    expect(layout.nodes.map((n) => n.personId).toSorted()).toEqual(["k2", "n1", "n2"]);
    expect(edge(layout, "child:un:k2").childType).toBe("biological");
  });

  test("someone with only adoptive parents shows them, on a dotted adopted line", () => {
    const layout = layoutPedigree(famAdoptedOnly(), { focusId: "k2" });
    expect(layout.nodes.map((n) => [n.personId, n.generation])).toEqual([
      ["k2", 0],
      ["a", -1],
      ["b", -1],
      ["ga", -2],
      ["gb", -2],
    ]);
    expect(edge(layout, "child:ua:k2").childType).toBe("adopted");
    expect(edge(layout, "child:ug:a").childType).toBe("biological");
    expect(layout.unreachable.toSorted()).toEqual(["k1"]);
  });

  test("pedigree collapse: the second appearance of an ancestor is a linked leaf", () => {
    const layout = layoutPedigree(famCousinMarriage(), { focusId: "kid" });
    expect(layout.nodes.map((n) => [n.nodeId, n.kind, n.generation])).toEqual([
      ["kid", "blood", 0],
      ["cousin1", "blood", -1],
      ["cousin2", "blood", -1],
      ["p1", "blood", -2],
      ["s1", "blood", -2],
      ["g1", "blood", -3],
      ["g2", "blood", -3],
      ["s2", "blood", -2],
      ["p2", "blood", -2],
      ["g1~1", "linked", -3],
      ["g2~1", "linked", -3],
    ]);
    for (const n of layout.nodes) expect(n.y).toBe((n.generation + 3) * ROW_H);
    expect(Math.min(...layout.nodes.map((n) => n.x))).toBe(0);

    // Each grandparent couple centres over the one parent they belong to.
    expect(coupleCentre(layout, "g1", "g2")).toBe(centre(layout, "p1"));
    expect(coupleCentre(layout, "g1~1", "g2~1")).toBe(centre(layout, "p2"));
    // A couple with ancestors on both sides centres between the two couples above.
    expect(coupleCentre(layout, "cousin1", "cousin2")).toBe(
      (coupleCentre(layout, "p1", "s1") + coupleCentre(layout, "s2", "p2")) / 2,
    );

    // The repeated union gets its own edge id; both children hang from their own copy.
    expect(edge(layout, "union:ug").points[0]![0]).toBe(nodeAt(layout, "g1").x + CARD_W);
    expect(edge(layout, "union:ug~2").points[0]![0]).toBe(nodeAt(layout, "g1~1").x + CARD_W);
    expect(edge(layout, "child:ug:p1").points[0]![0]).toBe(centre(layout, "p1"));
    expect(edge(layout, "child:ug:p2").points[0]![0]).toBe(centre(layout, "p2"));
    expect(new Set(layout.edges.map((e) => e.id)).size).toBe(layout.edges.length);
    expectNoCrossingChildEdges(layout, (e) => String(e.points[0]));

    expect(Object.keys(layout.primaryNode).toSorted()).toEqual(
      ["cousin1", "cousin2", "g1", "g2", "kid", "p1", "p2", "s1", "s2"].toSorted(),
    );
    expect(layout.unreachable).toEqual([]);
    expect(layout.generationCount).toBe(4);
  });

  test("collapsing hides a person's ancestors and counts those not shown elsewhere", () => {
    const layout = layoutPedigree(famCousinMarriage(), {
      focusId: "kid",
      collapsed: new Set(["cousin1"]),
    });
    expect(layout.nodes.map((n) => n.nodeId)).toEqual([
      "kid",
      "cousin1",
      "cousin2",
      "s2",
      "p2",
      "g1",
      "g2",
    ]);
    // p1 and s1 are hidden; g1 and g2 are still shown above p2.
    expect(nodeAt(layout, "cousin1").hiddenCount).toBe(2);
    expect(nodeAt(layout, "cousin2").hiddenCount).toBe(0);
    expect(layout.unreachable).toEqual([]);
  });

  test("a focus outside the document gives an empty layout", () => {
    const doc = famSimple();
    const layout = layoutPedigree(doc, { focusId: "nobody" });
    expect(layout.nodes).toEqual([]);
    expect(layout.unreachable).toEqual(Object.keys(doc.persons));
  });
});
