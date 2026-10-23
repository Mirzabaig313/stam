import { describe, expect, test } from "bun:test";

import { validDropActions } from "@/core/commands/validActions";
import { CARD_H, CARD_W, GAP } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import type { LayoutNode } from "@/core/layout/types";
import { resolveDrop } from "@/ui/dnd/resolveDrop";

import { docOf, famCousinMarriage, famSimple, person, union } from "../../fixtures/families";

function famSimpleLayout() {
  const doc = famSimple();
  const layout = layoutFamily(doc, { rootId: "dad" });
  const node = (personId: string): LayoutNode =>
    layout.nodes.find((n) => n.personId === personId && n.nodeId === layout.primaryNode[personId])!;
  const centre = (personId: string): [number, number] => {
    const n = node(personId);
    return [n.x + CARD_W / 2, n.y + CARD_H / 2];
  };
  /** Midpoint of the gap between two cards on the same row. */
  const gapBetween = (left: string, right: string): [number, number] => {
    const l = node(left);
    const r = node(right);
    return [(l.x + CARD_W + r.x) / 2, l.y + CARD_H / 2];
  };
  return { doc, layout, node, centre, gapBetween };
}

describe("resolveDrop: person targets", () => {
  test("pointer on a grandchild while dragging the grandparent: person without 'child'", () => {
    const doc = docOf(
      [
        person("gp", "Gul", "Khan", "male"),
        person("p", "Pervez", "Khan", "male"),
        person("gc", "Gohar", "Khan", "male"),
      ],
      [union("u1", ["gp"], ["p"]), union("u2", ["p"], ["gc"])],
      "gp",
    );
    const layout = layoutFamily(doc, { rootId: "gp" });
    const gc = layout.nodes.find((n) => n.personId === "gc")!;
    const target = resolveDrop(layout, doc, "gp", [gc.x + 10, gc.y + 10]);
    expect(target.kind).toBe("person");
    if (target.kind !== "person") return;
    expect(target.personId).toBe("gc");
    expect(target.actions).not.toContain("child");
    expect(target.actions).toEqual(validDropActions(doc, "gp", "gc"));
  });

  test("a not-allowed target still resolves to person with an empty action list", () => {
    const { doc, layout, centre } = famSimpleLayout();
    // c1 dropped on dad: already his child, and dad is an ancestor, so nothing is allowed.
    const target = resolveDrop(layout, doc, "c1", centre("dad"));
    expect(target).toEqual({ kind: "person", personId: "dad", actions: [] });
  });

  test("pointer on the dragged person's own card is never a person target", () => {
    const { doc, layout, centre } = famSimpleLayout();
    expect(resolveDrop(layout, doc, "c1", centre("c1")).kind).not.toBe("person");
  });

  test("the dragged person's linked copy is not a person target either", () => {
    const doc = famCousinMarriage();
    const layout = layoutFamily(doc, { rootId: "g1" });
    const linked = layout.nodes.find((n) => n.kind === "linked");
    if (!linked) throw new Error("fixture should contain a linked node");
    const target = resolveDrop(layout, doc, linked.personId, [linked.x + 5, linked.y + 5]);
    expect(target.kind).not.toBe("person");
  });

  test("card edges are inclusive of the top-left and exclusive of the bottom-right", () => {
    const { doc, layout, node } = famSimpleLayout();
    const dad = node("dad");
    expect(resolveDrop(layout, doc, "c1", [dad.x, dad.y]).kind).toBe("person");
    expect(resolveDrop(layout, doc, "c1", [dad.x + CARD_W, dad.y + CARD_H]).kind).toBe("none");
  });
});

describe("resolveDrop: reorder", () => {
  test("pointer between two siblings gives the insertion index among the others", () => {
    const { doc, layout, gapBetween, node } = famSimpleLayout();
    // Dragging c1: the others are [c2, c3]. The gap c2|c3 is index 1.
    const target = resolveDrop(layout, doc, "c1", gapBetween("c2", "c3"));
    expect(target.kind).toBe("reorder");
    if (target.kind !== "reorder") return;
    expect(target.unionId).toBe("u1");
    expect(target.toIndex).toBe(1);
    expect(target.rowY).toBe(node("c1").y);
    const c2 = node("c2");
    const c3 = node("c3");
    expect(target.indicatorX).toBeCloseTo((c2.x + CARD_W + c3.x) / 2, 6);
  });

  test("dragging the last child into the first gap gives index 1", () => {
    const { doc, layout, gapBetween } = famSimpleLayout();
    const target = resolveDrop(layout, doc, "c3", gapBetween("c1", "c2"));
    expect(target).toMatchObject({ kind: "reorder", unionId: "u1", toIndex: 1 });
  });

  test("dropping back into the original slot gives that slot's index", () => {
    const { doc, layout, gapBetween } = famSimpleLayout();
    // Dragging c2: the others are [c1, c3]; the gap c1|c2 has one centre (c1) on its left.
    expect(resolveDrop(layout, doc, "c2", gapBetween("c1", "c2"))).toMatchObject({
      kind: "reorder",
      toIndex: 1,
    });
  });

  test("pointer over the dragged card itself reorders to its current slot", () => {
    const { doc, layout, centre } = famSimpleLayout();
    // c2's own centre is right of c1's centre and left of c3's: index 1, its current slot.
    expect(resolveDrop(layout, doc, "c2", centre("c2"))).toMatchObject({
      kind: "reorder",
      toIndex: 1,
    });
  });

  test("the gap before the first sibling reorders to the front", () => {
    const { doc, layout, node } = famSimpleLayout();
    const c1 = node("c1");
    const target = resolveDrop(layout, doc, "c3", [c1.x - GAP / 2, c1.y + CARD_H / 2]);
    expect(target).toMatchObject({ kind: "reorder", unionId: "u1", toIndex: 0 });
    if (target.kind !== "reorder") return;
    expect(target.indicatorX).toBeCloseTo(c1.x - GAP / 2, 6);
  });

  test("the gap after the last sibling reorders to the end", () => {
    const { doc, layout, node } = famSimpleLayout();
    const c3 = node("c3");
    const target = resolveDrop(layout, doc, "c1", [c3.x + CARD_W + GAP / 2, c3.y + CARD_H / 2]);
    expect(target).toMatchObject({ kind: "reorder", unionId: "u1", toIndex: 2 });
  });

  test("the pointer must lie within one GAP of the outermost sibling cards", () => {
    const { doc, layout, node } = famSimpleLayout();
    const c1 = node("c1");
    const c3 = node("c3");
    const y = c3.y + CARD_H / 2;
    expect(resolveDrop(layout, doc, "c2", [c3.x + CARD_W + GAP + 1, y]).kind).toBe("none");
    expect(resolveDrop(layout, doc, "c2", [c1.x - GAP - 1, y]).kind).toBe("none");
  });

  test("outside the row band it is none", () => {
    const { doc, layout, gapBetween, node } = famSimpleLayout();
    const [x] = gapBetween("c2", "c3");
    const y = node("c2").y;
    expect(resolveDrop(layout, doc, "c1", [x, y - 1]).kind).toBe("none");
    expect(resolveDrop(layout, doc, "c1", [x, y + CARD_H + 1]).kind).toBe("none");
  });

  test("a person with no biological parent union cannot reorder", () => {
    const { doc, layout, node } = famSimpleLayout();
    const dad = node("dad");
    const mom = node("mom");
    const gap: [number, number] = [(dad.x + CARD_W + mom.x) / 2, dad.y + CARD_H / 2];
    expect(resolveDrop(layout, doc, "dad", gap).kind).toBe("none");
  });
});

describe("resolveDrop: empty space", () => {
  test("pointer on empty canvas is none", () => {
    const { doc, layout } = famSimpleLayout();
    expect(resolveDrop(layout, doc, "c1", [-5000, -5000])).toEqual({ kind: "none" });
    expect(resolveDrop(layout, doc, "c1", [5000, 5000])).toEqual({ kind: "none" });
  });

  test("a dragged person that is not in the layout gives none", () => {
    const { doc, layout } = famSimpleLayout();
    expect(resolveDrop(layout, doc, "ghost", [0, 0]).kind).toBe("none");
  });
});
