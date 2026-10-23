import { describe, expect, test } from "bun:test";

import { CARD_H, CARD_W, GAP, ROW_H } from "@/core/layout/constants";
import { layoutDescendants } from "@/core/layout/descendants";
import type { LayoutResult } from "@/core/layout/types";

import { famAdoption, famCousinMarriage, famRemarriage, famSimple } from "../../fixtures/families";
import { expectNoCrossingChildEdges } from "./checks";

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

describe("layoutDescendants", () => {
  test("famRemarriage: no spouse cards, children of both unions packed under the parent", () => {
    const layout = layoutDescendants(famRemarriage(), { rootId: "ali" });
    expect(layout.nodes.map((n) => [n.nodeId, n.kind, n.generation, n.y])).toEqual([
      ["ali", "blood", 0, 0],
      ["a1", "blood", 1, ROW_H],
      ["a2", "blood", 1, ROW_H],
      ["a3", "blood", 1, ROW_H],
    ]);
    const step = CARD_W + GAP;
    expect(["a1", "a2", "a3"].map((id) => nodeAt(layout, id).x)).toEqual([0, step, 2 * step]);
    expect(nodeAt(layout, "ali").x).toBe(step);

    const from: [number, number] = [step + CARD_W / 2, CARD_H];
    expect(edge(layout, "child:m1:a1").points[0]).toEqual(from);
    expect(edge(layout, "child:m1:a2").points[0]).toEqual(from);
    expect(edge(layout, "child:m2:a3").points[0]).toEqual(from);
    expect(edge(layout, "child:m2:a3").unionId).toBe("m2");
    expect(edge(layout, "child:m1:a1").points.at(-1)).toEqual([CARD_W / 2, ROW_H]);
    expect(layout.edges.every((e) => e.kind === "child")).toBe(true);

    expect(layout.unreachable).toEqual(["wife1", "wife2"]);
    expect(layout.generationCount).toBe(2);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 2 * step + CARD_W, height: ROW_H + CARD_H });
  });

  test("a child of two descendants appears under the second parent as a linked copy", () => {
    const layout = layoutDescendants(famCousinMarriage(), { rootId: "g1" });
    expect(layout.nodes.map((n) => [n.nodeId, n.kind, n.generation])).toEqual([
      ["g1", "blood", 0],
      ["p1", "blood", 1],
      ["cousin1", "blood", 2],
      ["kid", "blood", 3],
      ["p2", "blood", 1],
      ["cousin2", "blood", 2],
      ["kid~1", "linked", 3],
    ]);
    expect(edge(layout, "child:uc:kid~1").points[0]![0]).toBe(
      nodeAt(layout, "cousin2").x + CARD_W / 2,
    );
    expect(layout.unreachable).toEqual(["g2", "s1", "s2"]);
    expectNoCrossingChildEdges(layout, (e) => String(e.points[0]));
  });

  test("adopted children are descendants, drawn with their link type", () => {
    const layout = layoutDescendants(famAdoption(), { rootId: "a" });
    expect(edge(layout, "child:ua:k2").childType).toBe("adopted");
  });

  test("collapsing hides descendants and counts those not shown elsewhere", () => {
    const layout = layoutDescendants(famCousinMarriage(), {
      rootId: "g1",
      collapsed: new Set(["p1"]),
    });
    expect(layout.nodes.map((n) => n.nodeId)).toEqual(["g1", "p1", "p2", "cousin2", "kid"]);
    expect(nodeAt(layout, "p1").hiddenCount).toBe(1);
    expect(layout.unreachable).toEqual(["g2", "s1", "s2"]);
  });

  test("a parent centres over the first and last child", () => {
    const layout = layoutDescendants(famSimple(), { rootId: "dad" });
    const first = nodeAt(layout, "c1").x;
    const last = nodeAt(layout, "c3").x;
    expect(nodeAt(layout, "dad").x).toBe((first + last) / 2);
  });

  test("a root outside the document gives an empty layout", () => {
    expect(layoutDescendants(famSimple(), { rootId: "nobody" }).nodes).toEqual([]);
  });
});
