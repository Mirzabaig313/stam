import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CARD_H } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import type { LayoutNode } from "@/core/layout/types";
import { Canvas, type CanvasProps } from "@/ui/canvas/Canvas";
import type { DropTarget } from "@/ui/dnd/resolveDrop";

import { cardFamily } from "../cards/fixtures";
import { reduceMotion, withI18n } from "../i18n";

const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-canvas")) {
      return DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 600 });
    }
    return originalRect.call(this);
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});
beforeEach(() => reduceMotion(true));
afterEach(() => {
  cleanup();
  reduceMotion(false);
});

function setup(over: Partial<CanvasProps> = {}) {
  const doc = cardFamily();
  const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
  const props: CanvasProps = {
    doc,
    layout,
    selectedId: null,
    focusMode: false,
    dir: "ltr",
    onSelect: () => {},
    onToggleCollapse: () => {},
    onViewFamily: () => {},
    photoUrl: () => undefined,
    ...over,
  };
  const view = render(withI18n(<Canvas {...props} />));
  const nodeEl = (nodeId: string) =>
    view.container.querySelector(`[data-node-id="${nodeId}"]`) as SVGGElement;
  const section = view.container.querySelector(".stam-canvas") as HTMLElement;
  return { ...view, layout, nodeEl, section };
}

const cardOf = (nodeEl: Element) => nodeEl.querySelector(".stam-card")!;

describe("Canvas drag feedback", () => {
  test("without a drag nothing is marked", () => {
    const { container, section } = setup();
    expect(section.dataset.drag).toBeUndefined();
    expect(container.querySelector(".stam-node--drag-source")).toBeNull();
    expect(container.querySelector(".stam-drop-line")).toBeNull();
  });

  test("the dragged person fades and an allowed target is outlined", () => {
    const target: DropTarget = { kind: "person", personId: "ahmed", actions: ["parent"] };
    const { nodeEl, section } = setup({ dragFeedback: { personId: "bilal", target } });
    expect(nodeEl("bilal").classList.contains("stam-node--drag-source")).toBe(true);
    expect(cardOf(nodeEl("ahmed")).classList.contains("stam-card--drop-target")).toBe(true);
    expect(nodeEl("ahmed").querySelector(".stam-card__strike")).toBeNull();
    expect(section.dataset.drag).toBe("allowed");
  });

  test("a target with no allowed action is struck through and marks the canvas blocked", () => {
    const target: DropTarget = { kind: "person", personId: "ahmed", actions: [] };
    const { nodeEl, section } = setup({ dragFeedback: { personId: "ali", target } });
    const card = cardOf(nodeEl("ahmed"));
    expect(card.classList.contains("stam-card--drop-blocked")).toBe(true);
    expect(card.classList.contains("stam-card--drop-target")).toBe(false);
    expect(nodeEl("ahmed").querySelector(".stam-card__strike")).not.toBeNull();
    expect(section.dataset.drag).toBe("blocked");
  });

  test("a reorder draws the insertion line at the indicator, across the row", () => {
    const target: DropTarget = {
      kind: "reorder",
      unionId: "u1",
      toIndex: 0,
      indicatorX: 123,
      rowY: 400,
    };
    const { container, section } = setup({ dragFeedback: { personId: "zainab", target } });
    const line = container.querySelector(".stam-drop-line")!;
    expect(line).not.toBeNull();
    expect(Number(line.getAttribute("x1"))).toBe(123);
    expect(Number(line.getAttribute("x2"))).toBe(123);
    expect(Number(line.getAttribute("y1"))).toBeLessThanOrEqual(400);
    expect(Number(line.getAttribute("y2"))).toBeGreaterThanOrEqual(400 + CARD_H);
    expect(section.dataset.drag).toBe("reorder");
  });

  test("in RTL the insertion line is mirrored with the drawing", () => {
    const target: DropTarget = {
      kind: "reorder",
      unionId: "u1",
      toIndex: 0,
      indicatorX: 123,
      rowY: 400,
    };
    const { container } = setup({ dir: "rtl", dragFeedback: { personId: "zainab", target } });
    expect(Number(container.querySelector(".stam-drop-line")!.getAttribute("x1"))).toBe(-123);
  });

  test("an empty drop target only fades the source", () => {
    const { nodeEl, section, container } = setup({
      dragFeedback: { personId: "ali", target: { kind: "none" } },
    });
    expect(nodeEl("ali").classList.contains("stam-node--drag-source")).toBe(true);
    expect(container.querySelector(".stam-card--drop-target, .stam-card--drop-blocked")).toBeNull();
    expect(section.dataset.drag).toBe("none");
  });
});

describe("Canvas card context menu from the keyboard", () => {
  test("Shift+F10 and the ContextMenu key on a focused card call onNodeContextMenu", () => {
    const menu = mock((_n: LayoutNode, _e: unknown) => {});
    const { layout } = setup({ onNodeContextMenu: menu });
    const card = screen.getByRole("button", { name: /^Ali Khan/ });
    fireEvent.keyDown(card, { key: "F10", shiftKey: true });
    fireEvent.keyDown(card, { key: "ContextMenu" });
    fireEvent.keyDown(card, { key: "F10" });
    const ali = layout.nodes.find((n) => n.nodeId === "ali");
    expect(menu.mock.calls.length).toBe(2);
    expect(menu.mock.calls[0]![0]).toBe(ali!);
  });
});

describe("drag feedback styles (ruling R36: the accent is for selection and 'you' only)", () => {
  const css = readFileSync("src/ui/canvas/canvas.css", "utf8");
  const ruleFor = (selector: string) => {
    const escaped = selector.replaceAll(".", "\\.");
    return new RegExp(`${escaped}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? "";
  };

  test("an allowed drop target has a 2 px dashed ink outline", () => {
    const rule = ruleFor(".stam-card--drop-target .stam-card__bg");
    expect(rule).toContain("stroke: var(--_ink)");
    expect(rule).toContain("stroke-width: 2");
    expect(rule).toMatch(/stroke-dasharray: \d/);
  });

  test("no drag and drop style uses the accent", () => {
    for (const selector of [
      ".stam-card--drop-target .stam-card__bg",
      ".stam-card--drop-blocked .stam-card__bg",
      ".stam-card__strike",
      ".stam-drop-line",
    ]) {
      const rule = ruleFor(selector);
      expect(rule).not.toBe("");
      expect(rule).not.toContain("--_accent");
    }
  });
});
