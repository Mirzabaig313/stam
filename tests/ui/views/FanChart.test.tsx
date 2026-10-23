import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";

import type { FanLayout } from "@/core/views/types";
import { describePerson } from "@/ui/cards/describe";
import { FanChart, type FanChartProps } from "@/ui/views/FanChart";
import type { ViewHandle } from "@/ui/views/useViewCamera";

import { reduceMotion, t, withI18n } from "../i18n";
import { fanFamily, fanLayout } from "./fixtures";

const SCREEN = { width: 800, height: 600 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-view")) return DOMRect.fromRect({ x: 0, y: 0, ...SCREEN });
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

function setup(over: Partial<FanChartProps> = {}) {
  const doc = fanFamily();
  const onSelect = mock((_id: string | null) => {});
  const onFocus = mock((_id: string) => {});
  const ref = createRef<ViewHandle>();
  const props: FanChartProps = {
    doc,
    layout: fanLayout(),
    selectedId: null,
    dir: "ltr",
    onSelect,
    onFocus,
    ...over,
  };
  const view = render(withI18n(<FanChart ref={ref} {...props} />));
  const rerender = (next: Partial<FanChartProps>) =>
    view.rerender(withI18n(<FanChart ref={ref} {...props} {...next} />) as ReactNode);
  return { ...view, doc, onSelect, onFocus, ref, rerender };
}

const button = (doc: ReturnType<typeof fanFamily>, id: string) =>
  screen.getByRole("button", { name: describePerson(doc, id, t) });

/** The first point of a segment's outline. */
function firstPoint(el: Element): [number, number] {
  const d = el.querySelector(".stam-fan__bg")!.getAttribute("d")!;
  const [, x, y] = /^M(-?[\d.]+) (-?[\d.]+)/.exec(d)!;
  return [Number(x), Number(y)];
}

describe("FanChart", () => {
  test("a labelled button for the focus and for every ancestor segment", () => {
    const { doc, container } = setup();
    expect(screen.getByRole("region", { name: /Noor Khan/ })).toBeTruthy();
    for (const id of ["noor", "ali", "hina", "ahmed", "sara", "imran", "unknownMom", "karim"]) {
      expect(button(doc, id).getAttribute("data-person-id")).toBe(id);
    }
    expect(container.querySelectorAll(".stam-fan__seg")).toHaveLength(7);
  });

  test("the focus is a half disc whose flat edge lies on the baseline", () => {
    const { doc } = setup();
    const [x, y] = firstPoint(button(doc, "noor"));
    expect(y).toBe(0);
    expect(x).toBe(-78);
  });

  test("one tab stop: the selected person, else the focus", () => {
    const { doc, rerender } = setup();
    expect(button(doc, "noor").getAttribute("tabindex")).toBe("0");
    expect(button(doc, "ali").getAttribute("tabindex")).toBe("-1");
    rerender({ selectedId: "sara" });
    expect(button(doc, "sara").getAttribute("tabindex")).toBe("0");
    expect(button(doc, "noor").getAttribute("tabindex")).toBe("-1");
  });

  test("the selected person is marked current and drawn with the accent class", () => {
    const { doc } = setup({ selectedId: "imran" });
    const imran = button(doc, "imran");
    expect(imran.getAttribute("aria-current")).toBe("true");
    expect(imran.classList.contains("stam-fan__seg--selected")).toBe(true);
    expect(button(doc, "ali").getAttribute("aria-current")).toBeNull();
  });

  test("click selects; double-click and Enter refocus; Space selects", () => {
    const { doc, onSelect, onFocus } = setup();
    fireEvent.click(button(doc, "ahmed"));
    expect(onSelect).toHaveBeenLastCalledWith("ahmed");
    fireEvent.doubleClick(button(doc, "sara"));
    expect(onFocus).toHaveBeenLastCalledWith("sara");
    fireEvent.keyDown(button(doc, "hina"), { key: "Enter" });
    expect(onFocus).toHaveBeenLastCalledWith("hina");
    expect(onSelect).toHaveBeenLastCalledWith("hina");
    fireEvent.keyDown(button(doc, "karim"), { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith("karim");
  });

  test("a press on the background clears the selection", () => {
    const { container, onSelect } = setup({ selectedId: "ali" });
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerUp(svg, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  test("unknown parents of drawn people are outlined as empty, decorative slots", () => {
    const { container } = setup();
    const slots = container.querySelectorAll(".stam-fan__slot");
    expect(slots).toHaveLength(7);
    expect(slots[0]!.closest("[aria-hidden='true']")).not.toBeNull();
  });

  test("names run along wide arcs and radially in narrow deep ones; slivers get initials", () => {
    const layout = fanLayout();
    const span = Math.PI / 48;
    const deep: FanLayout = {
      ...layout,
      generations: 5,
      segments: [
        ...layout.segments,
        {
          personId: "sara",
          generation: 4,
          index: 0,
          startAngle: Math.PI,
          endAngle: Math.PI + Math.PI / 16,
          innerRadius: 350,
          outerRadius: 440,
        },
        {
          personId: "imran",
          generation: 5,
          index: 0,
          startAngle: Math.PI,
          endAngle: Math.PI + span,
          innerRadius: 440,
          outerRadius: 470,
        },
      ],
    };
    const { container } = setup({ layout: deep });
    const arcNames = [...container.querySelectorAll(".stam-fan__name textPath")].map(
      (n) => n.textContent,
    );
    expect(arcNames).toContain("Ali Khan");
    expect(container.querySelectorAll(".stam-fan__label--radial")).toHaveLength(1);
    const initials = [...container.querySelectorAll(".stam-fan__initials")].map(
      (n) => n.textContent,
    );
    expect(initials).toEqual(["IR"]);
  });

  test("RTL mirrors the fan: the father's side moves to the right", () => {
    const { doc, rerender } = setup();
    expect(firstPoint(button(doc, "ali"))[0]).toBeLessThan(0);
    rerender({ dir: "rtl" });
    const [x] = firstPoint(button(doc, "ali"));
    expect(x).toBeGreaterThan(0);
  });

  test("arrow keys walk the fan: up to a parent, down to the child, sideways in a ring", () => {
    const { doc } = setup();
    const noor = button(doc, "noor");
    act(() => noor.focus());
    fireEvent.keyDown(noor, { key: "ArrowUp" });
    expect(document.activeElement).toBe(button(doc, "ali"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(button(doc, "hina"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(button(doc, "imran"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(button(doc, "sara"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(button(doc, "ali"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(noor);
    expect(document.activeElement!.getAttribute("tabindex")).toBe("0");
  });

  test("in RTL, ArrowLeft moves to the physically left neighbour", () => {
    const { doc } = setup({ dir: "rtl" });
    const ali = button(doc, "ali");
    act(() => ali.focus());
    fireEvent.keyDown(ali, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(button(doc, "hina"));
  });

  test("the handle zooms the drawing", () => {
    const { container, ref } = setup();
    const g = () => container.querySelector("svg > g")!.getAttribute("transform");
    const before = g();
    act(() => ref.current!.zoomIn());
    expect(g()).not.toBe(before);
  });
});
