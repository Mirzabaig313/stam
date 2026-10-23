import { describe, expect, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import type { LayoutResult } from "@/core/layout/types";
import { nextFocus } from "@/ui/keyboard/navigation";

import { famSimple } from "../../fixtures/families";

function setup() {
  const doc = famSimple();
  const layout = layoutFamily(doc, { rootId: "dad" });
  const node = (personId: string) => layout.primaryNode[personId]!;
  return { doc, layout, node };
}

describe("nextFocus on famSimple", () => {
  test("Up from a child reaches the first parent", () => {
    const { doc, layout, node } = setup();
    expect(nextFocus(layout, doc, node("c2"), "ArrowUp")).toBe(node("dad"));
  });

  test("Up from a root with no parents stays put (null)", () => {
    const { doc, layout, node } = setup();
    expect(nextFocus(layout, doc, node("dad"), "ArrowUp")).toBeNull();
  });

  test("Down from a parent reaches the first child, from either partner", () => {
    const { doc, layout, node } = setup();
    expect(nextFocus(layout, doc, node("dad"), "ArrowDown")).toBe(node("c1"));
    const mom = layout.nodes.find((n) => n.personId === "mom")!;
    expect(nextFocus(layout, doc, mom.nodeId, "ArrowDown")).toBe(node("c1"));
  });

  test("Down from a childless person is null", () => {
    const { doc, layout, node } = setup();
    expect(nextFocus(layout, doc, node("c3"), "ArrowDown")).toBeNull();
  });

  test("Right from the first child reaches the second child; Left goes back", () => {
    const { doc, layout, node } = setup();
    expect(nextFocus(layout, doc, node("c1"), "ArrowRight")).toBe(node("c2"));
    expect(nextFocus(layout, doc, node("c2"), "ArrowLeft")).toBe(node("c1"));
  });

  test("at the end of a row it is null", () => {
    const { doc, layout, node } = setup();
    expect(nextFocus(layout, doc, node("c1"), "ArrowLeft")).toBeNull();
    expect(nextFocus(layout, doc, node("c3"), "ArrowRight")).toBeNull();
  });

  test("Left/Right move between partners of a couple (any node kind)", () => {
    const { doc, layout, node } = setup();
    const mom = layout.nodes.find((n) => n.personId === "mom")!;
    const dad = layout.nodes.find((n) => n.personId === "dad")!;
    const rightOfDad = mom.x > dad.x ? "ArrowRight" : "ArrowLeft";
    expect(nextFocus(layout, doc, node("dad"), rightOfDad)).toBe(mom.nodeId);
  });

  test("in RTL, Left does what Right does in LTR", () => {
    const { doc, layout, node } = setup();
    expect(nextFocus(layout, doc, node("c1"), "ArrowLeft", "rtl")).toBe(node("c2"));
    expect(nextFocus(layout, doc, node("c2"), "ArrowRight", "rtl")).toBe(node("c1"));
    expect(nextFocus(layout, doc, node("c1"), "ArrowRight", "rtl")).toBeNull();
  });

  test("Up/Down are unaffected by direction", () => {
    const { doc, layout, node } = setup();
    expect(nextFocus(layout, doc, node("c2"), "ArrowUp", "rtl")).toBe(node("dad"));
    expect(nextFocus(layout, doc, node("dad"), "ArrowDown", "rtl")).toBe(node("c1"));
  });

  test("an unknown node id gives null", () => {
    const { doc, layout } = setup();
    expect(nextFocus(layout, doc, "nope", "ArrowRight")).toBeNull();
  });

  test("Down is null when children are not in the layout (collapsed)", () => {
    const { doc, layout, node } = setup();
    const collapsed = layoutFamily(doc, { rootId: "dad", collapsed: new Set(["dad"]) });
    expect(collapsed.primaryNode["c1"]).toBeUndefined();
    expect(nextFocus(collapsed, doc, collapsed.primaryNode["dad"]!, "ArrowDown")).toBeNull();
    expect(node("dad")).toBeDefined();
    expect(layout.nodes.length).toBeGreaterThan(collapsed.nodes.length);
  });

  test("Up is null when the parent is not visible (view rooted below)", () => {
    const { doc } = setup();
    const layout: LayoutResult = layoutFamily(doc, { rootId: "c1" });
    expect(nextFocus(layout, doc, layout.primaryNode["c1"]!, "ArrowUp")).toBeNull();
  });
});
