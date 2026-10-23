import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";

import { describePerson } from "@/ui/cards/describe";
import { Timeline, type TimelineProps } from "@/ui/views/Timeline";
import type { ViewHandle } from "@/ui/views/useViewCamera";

import { reduceMotion, t, withI18n } from "../i18n";
import { fanFamily, timelineLayout } from "./fixtures";

const SCREEN = { width: 1200, height: 600 };
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

function setup(over: Partial<TimelineProps> = {}) {
  const doc = fanFamily();
  const onSelect = mock((_id: string | null) => {});
  const onFocus = mock((_id: string) => {});
  const ref = createRef<ViewHandle>();
  const props: TimelineProps = {
    doc,
    layout: timelineLayout(),
    selectedId: null,
    dir: "ltr",
    onSelect,
    onFocus,
    ...over,
  };
  const view = render(withI18n(<Timeline ref={ref} {...props} />));
  const rerender = (next: Partial<TimelineProps>) =>
    view.rerender(withI18n(<Timeline ref={ref} {...props} {...next} />) as ReactNode);
  return { ...view, doc, onSelect, onFocus, ref, rerender };
}

const bar = (doc: ReturnType<typeof fanFamily>, id: string) =>
  screen.getByRole("button", { name: describePerson(doc, id, t) });

/** The gradient that fades a bar, through its mask. */
function fadeOf(container: HTMLElement, el: Element) {
  const maskRef = el.querySelector("[mask]")?.getAttribute("mask");
  if (!maskRef) return null;
  const maskId = /url\(#(.+)\)/.exec(maskRef)![1]!;
  const mask = container.querySelector(`mask[id="${maskId}"]`)!;
  const gradId = /url\(#(.+)\)/.exec(mask.querySelector("rect")!.getAttribute("fill")!)![1]!;
  const grad = container.querySelector(`linearGradient[id="${gradId}"]`)!;
  const stops = [...grad.querySelectorAll("stop")].map((s) =>
    Number(s.getAttribute("stop-opacity")),
  );
  return { x1: Number(grad.getAttribute("x1")), x2: Number(grad.getAttribute("x2")), stops };
}

describe("Timeline", () => {
  test("a labelled bar per person, in a labelled region", () => {
    const { doc, container } = setup();
    expect(screen.getByRole("region", { name: "Timeline" })).toBeTruthy();
    for (const id of ["karim", "ahmed", "sara", "ali", "hina"]) {
      expect(bar(doc, id).getAttribute("data-person-id")).toBe(id);
    }
    expect(container.querySelectorAll(".stam-timeline__bar")).toHaveLength(5);
  });

  test("an estimated end fades out towards the end; a known end does not fade", () => {
    const { doc, container } = setup();
    const karim = bar(doc, "karim");
    expect(karim.getAttribute("data-end")).toBe("estimated");
    const fade = fadeOf(container, karim)!;
    expect(fade.x1).toBeLessThan(fade.x2);
    expect(fade.stops[0]).toBe(1);
    expect(fade.stops.at(-1)).toBe(0);
    expect(bar(doc, "ahmed").getAttribute("data-end")).toBe("known");
    expect(fadeOf(container, bar(doc, "ahmed"))).toBeNull();
  });

  test("in RTL the fade runs the other way", () => {
    const { doc, container } = setup({ dir: "rtl" });
    const fade = fadeOf(container, bar(doc, "karim"))!;
    expect(fade.x1).toBeGreaterThan(fade.x2);
  });

  test("in RTL a name starts at the bar's right edge and runs leftwards", () => {
    const { doc, container } = setup({ dir: "rtl" });
    const edge = bar(doc, "ahmed").querySelector(".stam-timeline__edge")!.getAttribute("d")!;
    // The outline's first move is to the bar's left edge plus the corner radius (6).
    const left = Number(/^M(-?[\d.]+)/.exec(edge)![1]) - 6;
    const right = left + 70 * 8;
    const name = [...container.querySelectorAll(".stam-timeline__name")].find((n) =>
      n.textContent?.startsWith("Ahmed Khan"),
    )!;
    expect(name.getAttribute("text-anchor")).toBe("start");
    expect(Number(name.getAttribute("x"))).toBe(right - 10);
  });

  test("a handler that takes only a person id is accepted", () => {
    const strict = mock((_id: string) => {});
    const { doc } = setup({ onSelect: strict });
    fireEvent.click(bar(doc, "ali"));
    expect(strict).toHaveBeenLastCalledWith("ali");
  });

  test("living people get an open end: the outline is not closed", () => {
    const { doc } = setup();
    const ali = bar(doc, "ali");
    expect(ali.getAttribute("data-end")).toBe("open");
    expect(ali.querySelector(".stam-timeline__edge")!.getAttribute("d")).not.toContain("Z");
    expect(bar(doc, "ahmed").querySelector(".stam-timeline__edge")!.getAttribute("d")).toContain(
      "Z",
    );
  });

  test("lane T's living bars (endKnown true, fractional end) stay open and never fade", () => {
    const layout = timelineLayout();
    layout.maxYear = 2026.81;
    layout.bars[3] = { ...layout.bars[3]!, end: 2026.81, endKnown: true };
    const { doc, container } = setup({ layout });
    const ali = bar(doc, "ali");
    expect(ali.getAttribute("data-end")).toBe("open");
    expect(fadeOf(container, ali)).toBeNull();
  });

  test("the year axis labels round years", () => {
    const { container } = setup();
    const ticks = [...container.querySelectorAll(".stam-timeline__tick")].map((n) => n.textContent);
    expect(ticks).toContain("1900");
    expect(ticks).toContain("2000");
    expect(container.querySelector(".stam-timeline__axis")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("a generation ruler labels each generation group", () => {
    const { container } = setup();
    const labels = [...container.querySelectorAll(".stam-ruler__label")].map((n) => n.textContent);
    expect(labels).toEqual(["I", "II", "III"]);
  });

  test("the selected bar is current and drawn with the accent class; it is the tab stop", () => {
    const { doc } = setup({ selectedId: "sara" });
    const sara = bar(doc, "sara");
    expect(sara.getAttribute("aria-current")).toBe("true");
    expect(sara.classList.contains("stam-timeline__bar--selected")).toBe(true);
    expect(sara.getAttribute("tabindex")).toBe("0");
    expect(bar(doc, "karim").getAttribute("tabindex")).toBe("-1");
  });

  test("click selects; double-click and Enter refocus", () => {
    const { doc, onSelect, onFocus } = setup();
    fireEvent.click(bar(doc, "hina"));
    expect(onSelect).toHaveBeenLastCalledWith("hina");
    fireEvent.doubleClick(bar(doc, "ahmed"));
    expect(onFocus).toHaveBeenLastCalledWith("ahmed");
    fireEvent.keyDown(bar(doc, "ali"), { key: "Enter" });
    expect(onFocus).toHaveBeenLastCalledWith("ali");
  });

  test("ArrowUp and ArrowDown move between rows; Home and End jump", () => {
    const { doc } = setup();
    const karim = bar(doc, "karim");
    expect(karim.getAttribute("tabindex")).toBe("0");
    act(() => karim.focus());
    fireEvent.keyDown(karim, { key: "ArrowDown" });
    expect(document.activeElement).toBe(bar(doc, "ahmed"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(bar(doc, "hina"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(bar(doc, "ali"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(karim);
  });

  test("an empty layout says so", () => {
    setup({ layout: { bars: [], minYear: 2026, maxYear: 2026, rows: 0, generationRows: [] } });
    expect(screen.getByText(t("views.timeline.empty"))).toBeTruthy();
  });

  test("the handle zooms the drawing", () => {
    const { container, ref } = setup();
    const g = () => container.querySelector("svg > g")!.getAttribute("transform");
    const before = g();
    act(() => ref.current!.zoomOut());
    expect(g()).not.toBe(before);
  });
});

describe("Timeline rendering cost", () => {
  test("labels come from one parent index, and zooming does not label the bars again", () => {
    const doc = fanFamily();
    let scans = 0;
    doc.unions = new Proxy(doc.unions, {
      ownKeys(target) {
        scans++;
        return Reflect.ownKeys(target);
      },
    });
    const { ref } = setup({ doc });
    const first = scans;
    expect(first).toBeLessThanOrEqual(1);
    act(() => ref.current!.zoomIn());
    act(() => ref.current!.zoomOut());
    expect(scans).toBe(first);
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });
});
