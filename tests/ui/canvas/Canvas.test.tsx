import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";

import { CARD_H, CARD_W } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import type { LayoutNode, LayoutResult } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";
import { bigFamily } from "@/dev/bigFamily";
import { cropLayout } from "@/export/render/scope";
import { Canvas, type CanvasHandle, type CanvasProps } from "@/ui/canvas/Canvas";
import { fitBounds, intersects, type Rect, type Viewport, visibleRect } from "@/ui/canvas/viewport";
import { visibleWorldRect } from "@/ui/export/gatherInput";

import { cardFamily } from "../cards/fixtures";
import { reduceMotion, withI18n } from "../i18n";

const SCREEN = { width: 800, height: 600 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  // happy-dom has no layout: give the canvas container a fixed size.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-canvas")) {
      return DOMRect.fromRect({ x: 0, y: 0, ...SCREEN });
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

type Setup = Partial<CanvasProps> & { doc?: TreeDocument; layout?: LayoutResult };

function setup(over: Setup = {}) {
  const doc = over.doc ?? cardFamily();
  const layout = over.layout ?? layoutFamily(doc, { rootId: doc.rootPersonId! });
  const ref = createRef<CanvasHandle>();
  const onSelect = mock((_id: string | null) => {});
  const props: CanvasProps = {
    doc,
    layout,
    selectedId: null,
    focusMode: false,
    dir: "ltr",
    onSelect,
    onToggleCollapse: () => {},
    onViewFamily: () => {},
    photoUrl: () => undefined,
    ...over,
  };
  const view = render(withI18n(<Canvas ref={ref} {...props} />));
  const rerender = (next: Partial<CanvasProps>) =>
    view.rerender(withI18n(<Canvas ref={ref} {...props} {...next} />) as ReactNode);
  return { ...view, ref, doc, layout, onSelect, rerender };
}

/** A touch pointer event init. */
const touch = (id: number, x: number, y: number) => ({
  pointerId: id,
  pointerType: "touch",
  button: 0,
  clientX: x,
  clientY: y,
});

function viewportOf(handle: CanvasHandle): Viewport {
  const [x, y] = handle.worldToScreen([0, 0]);
  // Measured along y: x is mirrored in RTL.
  const k = handle.worldToScreen([0, 1])[1] - y;
  return { x, y, k };
}

/** happy-dom's WheelEvent ignores the mouse-event fields, so set them by hand. */
function wheel(
  target: Element,
  init: { deltaY: number; ctrlKey?: boolean; clientX?: number; clientY?: number },
) {
  const event = new WheelEvent("wheel", { deltaY: init.deltaY, bubbles: true, cancelable: true });
  for (const key of ["ctrlKey", "clientX", "clientY"] as const) {
    Object.defineProperty(event, key, { value: init[key] ?? (key === "ctrlKey" ? false : 0) });
  }
  act(() => {
    target.dispatchEvent(event);
  });
}

const cardRect = (n: LayoutNode): Rect => ({ x: n.x, y: n.y, width: CARD_W, height: CARD_H });

const renderedIds = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-node-id]")].map((el) => el.getAttribute("data-node-id")!);

describe("Canvas", () => {
  test("is a labelled region that fits the tree on first render", () => {
    const { ref, layout } = setup();
    expect(screen.getByRole("region", { name: "Family tree" })).toBeDefined();
    const v = viewportOf(ref.current!);
    const fit = fitBounds(layout.bounds, SCREEN);
    expect(v.k).toBeCloseTo(fit.k, 8);
    expect(v.x).toBeCloseTo(fit.x, 6);
    expect(v.y).toBeCloseTo(fit.y, 6);
  });

  test("renders only the nodes and edges that intersect the visible rect", () => {
    const doc = bigFamily(200);
    const { container, ref, layout } = setup({ doc });
    const v = viewportOf(ref.current!);
    const visible = visibleRect(v, SCREEN);
    const ids = renderedIds(container);
    const expected = layout.nodes.filter((n) => intersects(cardRect(n), visible));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(layout.nodes.length);
    // The roving tab stop always renders, even when it is off screen.
    const tabStop = layout.nodes[0]!.nodeId;
    expect(new Set(ids)).toEqual(new Set([...expected.map((n) => n.nodeId), tabStop]));
    const edges = container.querySelectorAll("[data-edge-id]").length;
    expect(edges).toBeGreaterThan(0);
    expect(edges).toBeLessThan(layout.edges.length);
  });

  test("zoomIn and zoomOut scale by 1.2 around the screen centre; fit restores", () => {
    const { ref, layout } = setup();
    const handle = ref.current!;
    const before = viewportOf(handle);
    const centreWorld = handle.screenToWorld([400, 300]);
    act(() => handle.zoomIn());
    const zoomed = viewportOf(handle);
    expect(zoomed.k).toBeCloseTo(Math.min(4, before.k * 1.2), 8);
    expect(handle.screenToWorld([400, 300])[0]).toBeCloseTo(centreWorld[0], 6);
    act(() => handle.zoomOut());
    expect(viewportOf(handle).k).toBeCloseTo(before.k, 8);
    act(() => handle.zoomIn());
    act(() => handle.fit());
    expect(viewportOf(handle).k).toBeCloseTo(fitBounds(layout.bounds, SCREEN).k, 8);
  });

  test("worldToScreen and screenToWorld are inverses, in LTR and RTL", () => {
    for (const dir of ["ltr", "rtl"] as const) {
      const { ref } = setup({ dir });
      const handle = ref.current!;
      const p = handle.worldToScreen([123, 456]);
      const back = handle.screenToWorld(p);
      expect(back[0]).toBeCloseTo(123, 8);
      expect(back[1]).toBeCloseTo(456, 8);
      cleanup();
    }
  });

  test("the export's visible rect is in unmirrored layout coordinates, with no culling margin", () => {
    for (const dir of ["ltr", "rtl"] as const) {
      const { ref, layout } = setup({ dir });
      const handle = ref.current!;
      const rect = visibleWorldRect(handle, SCREEN)!;
      const { k } = viewportOf(handle);
      expect(rect.width).toBeCloseTo(SCREEN.width / k, 6);
      expect(rect.height).toBeCloseTo(SCREEN.height / k, 6);
      // Fitted: every card, read in layout coordinates, is inside the rect.
      for (const n of layout.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(rect.x - 1e-6);
        expect(n.x + CARD_W).toBeLessThanOrEqual(rect.x + rect.width + 1e-6);
      }
      const scoped = cropLayout(layout, rect);
      expect(scoped.nodes).toHaveLength(layout.nodes.length);
      cleanup();
    }
  });

  test("RTL mirrors the tree: a node further right in the layout sits further left on screen", () => {
    const { ref, layout } = setup({ dir: "rtl" });
    const left = layout.nodes.reduce((a, b) => (a.x < b.x ? a : b));
    const right = layout.nodes.reduce((a, b) => (a.x > b.x ? a : b));
    const handle = ref.current!;
    expect(handle.worldToScreen([right.x, 0])[0]).toBeLessThan(
      handle.worldToScreen([left.x, 0])[0],
    );
  });

  test("centerOnPerson puts the person's card centre in the middle of the screen", () => {
    const { ref, layout } = setup({ doc: bigFamily(200) });
    const handle = ref.current!;
    const target = layout.nodes[layout.nodes.length - 1]!;
    act(() => handle.centerOnPerson(target.personId));
    const [sx, sy] = handle.worldToScreen([target.x + CARD_W / 2, target.y + CARD_H / 2]);
    expect(sx).toBeCloseTo(400, 6);
    expect(sy).toBeCloseTo(300, 6);
  });

  test("centerOnPerson with a bottom inset centres the card in the area above it", () => {
    const { ref, layout } = setup({ doc: bigFamily(200) });
    const handle = ref.current!;
    const target = layout.nodes[layout.nodes.length - 1]!;
    act(() => handle.centerOnPerson(target.personId, { bottomInset: 200 }));
    const [sx, sy] = handle.worldToScreen([target.x + CARD_W / 2, target.y + CARD_H / 2]);
    expect(sx).toBeCloseTo(400, 6);
    expect(sy).toBeCloseTo(200, 6);
  });

  test("clicking a card selects the person; a background click clears the selection", () => {
    const { onSelect, container } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Ali Khan/ }));
    const svg = container.querySelector("svg.stam-canvas__svg")!;
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(svg, { pointerId: 1, button: 0, clientX: 12, clientY: 11 });
    expect(onSelect.mock.calls).toEqual([["ali"], [null]]);
  });

  test("dragging the background pans and does not clear the selection", () => {
    const { onSelect, container, ref } = setup();
    const svg = container.querySelector("svg.stam-canvas__svg")!;
    const before = viewportOf(ref.current!);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 160, clientY: 130 });
    fireEvent.pointerUp(svg, { pointerId: 1, button: 0, clientX: 160, clientY: 130 });
    const after = viewportOf(ref.current!);
    expect(after.x - before.x).toBeCloseTo(60, 6);
    expect(after.y - before.y).toBeCloseTo(30, 6);
    expect(onSelect).not.toHaveBeenCalled();
  });

  describe("touch (I3)", () => {
    test("a one-finger drag that starts on a card pans the canvas", () => {
      const { onSelect, ref } = setup();
      const card = screen.getByRole("button", { name: /^Ali Khan/ });
      const before = viewportOf(ref.current!);
      fireEvent.pointerDown(card, touch(1, 100, 100));
      fireEvent.pointerMove(card, touch(1, 103, 101)); // within the drag threshold: no pan yet
      expect(viewportOf(ref.current!)).toEqual(before);
      fireEvent.pointerMove(card, touch(1, 160, 130));
      fireEvent.pointerUp(card, touch(1, 160, 130));
      const after = viewportOf(ref.current!);
      expect(after.x - before.x).toBeCloseTo(60, 6);
      expect(after.y - before.y).toBeCloseTo(30, 6);
      expect(onSelect).not.toHaveBeenCalledWith(null);
    });

    test("a tap on a card is not a background click", () => {
      const { onSelect } = setup();
      const card = screen.getByRole("button", { name: /^Ali Khan/ });
      fireEvent.pointerDown(card, touch(1, 100, 100));
      fireEvent.pointerUp(card, touch(1, 100, 100));
      expect(onSelect).not.toHaveBeenCalledWith(null);
    });

    test("once the long-press picked the card up, the finger moves the card, not the canvas", () => {
      const { ref } = setup({ isCardHeld: () => true });
      const card = screen.getByRole("button", { name: /^Ali Khan/ });
      const before = viewportOf(ref.current!);
      fireEvent.pointerDown(card, touch(1, 100, 100));
      fireEvent.pointerMove(card, touch(1, 160, 130));
      expect(viewportOf(ref.current!)).toEqual(before);
    });

    test("a second finger, also on a card, pinches and stops the card's press", () => {
      const down = mock((_n: LayoutNode, _e: unknown) => {});
      const takeover = mock(() => {});
      const { ref } = setup({ onNodePointerDown: down, onTouchTakeover: takeover });
      const card = screen.getByRole("button", { name: /^Ali Khan/ });
      const before = viewportOf(ref.current!);
      fireEvent.pointerDown(card, touch(1, 100, 100));
      fireEvent.pointerDown(card, touch(2, 110, 100));
      expect(down).toHaveBeenCalledTimes(1); // the second finger never starts a press
      expect(takeover).toHaveBeenCalledTimes(1);
      fireEvent.pointerMove(card, touch(1, 80, 100));
      fireEvent.pointerMove(card, touch(2, 130, 100));
      expect(viewportOf(ref.current!).k).toBeGreaterThan(before.k * 2);
    });
  });

  test("Ctrl + wheel zooms and a plain wheel pans", () => {
    const { container, ref } = setup();
    const root = container.querySelector(".stam-canvas")!;
    const before = viewportOf(ref.current!);
    wheel(root, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 300 });
    expect(viewportOf(ref.current!).k).toBeGreaterThan(before.k);
    const zoomed = viewportOf(ref.current!);
    wheel(root, { deltaY: 40 });
    expect(viewportOf(ref.current!).y).toBeCloseTo(zoomed.y - 40, 6);
  });

  test("the selected card is the tab stop and carries the selection outline", () => {
    const { container } = setup({ selectedId: "zainab" });
    const card = screen.getByRole("button", { name: /^Zainab Khan/ });
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.classList).toContain("stam-card--selected");
    const tabStops = container.querySelectorAll(".stam-card[tabindex='0']");
    expect(tabStops).toHaveLength(1);
  });

  test("focus mode dims everyone who is not the selected person or a direct relative", () => {
    const { container } = setup({ selectedId: "ali", focusMode: true });
    const dimmed = [...container.querySelectorAll(".stam-node--dimmed")].map((el) =>
      el.getAttribute("data-node-id"),
    );
    expect(dimmed.toSorted()).toEqual(["hina", "omar", "zainab"]);
  });

  test("renderNodeExtras renders in the HTML overlay with the node's screen rect", () => {
    const calls: [string, Rect][] = [];
    const { container, ref, layout } = setup({
      renderNodeExtras: (node, rect) => {
        calls.push([node.nodeId, rect]);
        return node.personId === "ali" ? <span data-testid="extra">+</span> : null;
      },
    });
    const overlay = container.querySelector(".stam-canvas__overlay")!;
    expect(overlay.querySelector("[data-testid='extra']")).not.toBeNull();
    const ali = layout.nodes.find((n) => n.nodeId === "ali")!;
    const rect = calls.findLast(([id]) => id === "ali")![1];
    const [sx, sy] = ref.current!.worldToScreen([ali.x, ali.y]);
    const k = viewportOf(ref.current!).k;
    expect(rect.x).toBeCloseTo(sx, 6);
    expect(rect.y).toBeCloseTo(sy, 6);
    expect(rect.width).toBeCloseTo(CARD_W * k, 6);
    expect(rect.height).toBeCloseTo(CARD_H * k, 6);
  });

  test("passes the layout node to onNodePointerDown and onNodeContextMenu", () => {
    const down = mock((_n: LayoutNode, _e: unknown) => {});
    const menu = mock((_n: LayoutNode, _e: unknown) => {});
    const { layout } = setup({ onNodePointerDown: down, onNodeContextMenu: menu });
    const card = screen.getByRole("button", { name: /^Ali Khan/ });
    fireEvent.pointerDown(card, { pointerId: 1, button: 0 });
    fireEvent.contextMenu(card);
    const ali = layout.nodes.find((n) => n.nodeId === "ali");
    expect(down.mock.calls[0]![0]).toBe(ali!);
    expect(menu.mock.calls[0]![0]).toBe(ali!);
  });

  test("a card's collapse chevron and 'View family' call back with person ids", () => {
    const onToggleCollapse = mock((_id: string) => {});
    const onViewFamily = mock((_id: string) => {});
    setup({ onToggleCollapse, onViewFamily });
    fireEvent.click(screen.getByRole("button", { name: "Collapse the branch of Ali Khan" }));
    fireEvent.click(screen.getByRole("button", { name: "View the family of Hina Raza" }));
    expect(onToggleCollapse.mock.calls).toEqual([["ali"]]);
    expect(onViewFamily.mock.calls).toEqual([["imran"]]);
  });

  test("a re-layout keeps the selected person's card where it was on screen", () => {
    const doc = bigFamily(60);
    const rootId = doc.rootPersonId!;
    const layout = layoutFamily(doc, { rootId });
    const target = layout.nodes.find((n) => n.generation === 1 && n.kind === "blood")!;
    const { ref, rerender } = setup({ doc, layout, selectedId: target.personId });
    const handle = ref.current!;
    const before = handle.worldToScreen([target.x, target.y]);
    const collapsed = layoutFamily(doc, { rootId, collapsed: new Set([target.personId]) });
    const moved = collapsed.nodes.find((n) => n.nodeId === target.nodeId)!;
    expect(moved.x).not.toBe(target.x); // The fixture really moves the card.
    rerender({ layout: collapsed });
    const after = handle.worldToScreen([moved.x, moved.y]);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  test("toggling collapse keeps the toggled card in place, also in RTL", () => {
    for (const dir of ["ltr", "rtl"] as const) {
      const doc = bigFamily(60);
      const rootId = doc.rootPersonId!;
      const layout = layoutFamily(doc, { rootId });
      const target = layout.nodes.find((n) => n.generation === 1 && n.kind === "blood")!;
      const collapsedLayout = layoutFamily(doc, { rootId, collapsed: new Set([target.personId]) });
      const moved = collapsedLayout.nodes.find((n) => n.nodeId === target.nodeId)!;
      expect(moved.x).not.toBe(target.x); // The fixture really moves the card.

      // The parent re-lays out when the chevron asks it to.
      const parent: { rerender?: (next: Partial<CanvasProps>) => void } = {};
      const view = setup({
        doc,
        layout,
        dir,
        onToggleCollapse: () => parent.rerender?.({ layout: collapsedLayout }),
      });
      parent.rerender = view.rerender;
      const handle = view.ref.current!;
      // Bring the card to the middle at full detail, so its chevron renders.
      act(() => handle.centerOnPerson(target.personId));
      while (viewportOf(handle).k < 0.45) act(() => handle.zoomIn());
      const before = handle.worldToScreen([target.x, target.y]);
      const name = `${doc.persons[target.personId]!.firstName} ${doc.persons[target.personId]!.lastName}`;
      // A direct query: getByRole over hundreds of SVG buttons is very slow in happy-dom.
      const chevron = view.container.querySelector(
        `[role='button'][aria-label='Collapse the branch of ${name}']`,
      );
      fireEvent.click(chevron!);
      const after = handle.worldToScreen([moved.x, moved.y]);
      expect(after[0]).toBeCloseTo(before[0], 6);
      expect(after[1]).toBeCloseTo(before[1], 6);
      cleanup();
    }
  });

  test("draws the generation ruler and the minimap", () => {
    const { container } = setup();
    const labels = [...container.querySelectorAll(".stam-ruler__label")].map((l) => l.textContent);
    expect(labels).toEqual(["I", "II", "III"]);
    expect(container.querySelector(".stam-minimap")).not.toBeNull();
  });
});
