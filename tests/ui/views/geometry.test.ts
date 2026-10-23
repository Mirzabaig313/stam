import { describe, expect, test } from "bun:test";

import {
  BAR_H,
  centreRadius,
  emptySlots,
  fanBounds,
  insetSector,
  mirrorAngles,
  planLabel,
  polar,
  radialRotation,
  sectorPath,
  timelineFit,
  timelineGeometry,
  visibleBarRange,
  yearTicks,
} from "@/ui/views/geometry";

import { fanLayout, longTimelineLayout, timelineLayout } from "./fixtures";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("fan geometry", () => {
  test("polar: 0 points right, angles grow clockwise (y down), 1.5π points up", () => {
    const [x0, y0] = polar(10, 0);
    close(x0, 10);
    close(y0, 0);
    const [xu, yu] = polar(10, 1.5 * Math.PI);
    close(xu, 0);
    close(yu, -10);
    const [xl, yl] = polar(10, Math.PI);
    close(xl, -10);
    close(yl, 0);
  });

  test("sectorPath: outer arc clockwise, inner arc back, closed", () => {
    const d = sectorPath(10, 20, Math.PI, 1.5 * Math.PI);
    expect(d.startsWith("M-20 0")).toBe(true);
    expect(d).toContain("A20 20 0 0 1 0 -20");
    expect(d).toContain("L0 -10");
    expect(d).toContain("A10 10 0 0 0 -10 0");
    expect(d.endsWith("Z")).toBe(true);
  });

  test("sectorPath: a span over π sets the large-arc flag; inner radius 0 is a wedge", () => {
    expect(sectorPath(10, 20, 0, 1.5 * Math.PI)).toContain("A20 20 0 1 1");
    const wedge = sectorPath(0, 20, Math.PI, 2 * Math.PI);
    expect(wedge).toContain("L0 0");
    expect(wedge).not.toContain("A0 0");
  });

  test("mirrorAngles reflects across the vertical axis and stays in the upper half", () => {
    const m = mirrorAngles({ startAngle: Math.PI, endAngle: 1.25 * Math.PI });
    close(m.startAngle, 1.75 * Math.PI);
    close(m.endAngle, 2 * Math.PI);
    const [x] = polar(1, (m.startAngle + m.endAngle) / 2);
    const [xo] = polar(1, 1.125 * Math.PI);
    close(x, -xo);
  });

  test("insetSector pulls every edge in by half the gap, never inverting", () => {
    const s = insetSector(
      { startAngle: Math.PI, endAngle: 1.5 * Math.PI, innerRadius: 80, outerRadius: 170 },
      4,
    );
    close(s.innerRadius, 82);
    close(s.outerRadius, 168);
    const mid = 125;
    close(s.startAngle, Math.PI + 2 / mid);
    close(s.endAngle, 1.5 * Math.PI - 2 / mid);
    const thin = insetSector(
      { startAngle: 1, endAngle: 1.001, innerRadius: 80, outerRadius: 81 },
      4,
    );
    expect(thin.endAngle).toBeGreaterThanOrEqual(thin.startAngle);
    expect(thin.outerRadius).toBeGreaterThanOrEqual(thin.innerRadius);
  });

  test("centreRadius is the parents' inner radius, else an even share of the radius", () => {
    expect(centreRadius(fanLayout())).toBe(80);
    expect(centreRadius({ focusId: "x", segments: [], radius: 400, generations: 4 })).toBe(80);
  });

  test("emptySlots marks the unknown parents of known people only", () => {
    const slots = emptySlots(fanLayout());
    // Karim's wife (gen 3, second half of Ahmed's arc); Sara's, Imran's and the unknown mother's
    // parents (gen 3). Karim's parents are beyond the drawn generations.
    expect(slots).toHaveLength(7);
    for (const s of slots) {
      expect(s.generation).toBe(3);
      expect(s.innerRadius).toBe(260);
      expect(s.outerRadius).toBe(350);
    }
    const starts = slots.map((s) => s.startAngle / Math.PI).toSorted((a, b) => a - b);
    expect(starts[0]).toBeCloseTo(1.125, 6);
  });

  test("emptySlots: a focus without parents gets two empty slots in generation 1", () => {
    const slots = emptySlots({ focusId: "x", segments: [], radius: 350, generations: 3 });
    expect(slots).toHaveLength(2);
    expect(slots[0]!.innerRadius).toBeCloseTo(350 / 4, 6);
    close(slots[0]!.startAngle, Math.PI);
    close(slots[1]!.endAngle, 2 * Math.PI);
  });

  test("fanBounds covers the upper half disc", () => {
    const b = fanBounds(fanLayout());
    expect(b.x).toBe(-350);
    expect(b.width).toBe(700);
    expect(b.y).toBe(-350);
    expect(b.height).toBeGreaterThanOrEqual(350);
  });

  test("fanBounds fits the generations that exist, not the ones asked for", () => {
    const sparse = { ...fanLayout(), generations: 7, radius: 80 + 7 * 90 };
    // Karim (generation 3) is the deepest; one ring of empty arcs for his parents, no more.
    expect(fanBounds(sparse).width).toBe(2 * (80 + 4 * 90));
    const parentsOnly = { ...sparse, segments: sparse.segments.filter((s) => s.generation === 1) };
    // The parents' ring, and one ring of empty arcs for their unknown parents.
    expect(fanBounds(parentsOnly).width).toBe(2 * (80 + 2 * 90));
  });

  test("planLabel: wide inner rings run along the arc, narrow outer ones run radially", () => {
    const [ali, , ahmed, , , , karim] = fanLayout().segments;
    expect(planLabel(ali!)).toMatchObject({ mode: "arc", lines: 2 });
    expect(planLabel(ahmed!).mode).toBe("arc");
    expect(planLabel(karim!).mode).toBe("arc");
    const span = Math.PI / 16;
    const gen4 = { ...karim!, endAngle: Math.PI + span, innerRadius: 350, outerRadius: 440 };
    expect(planLabel(gen4)).toMatchObject({ mode: "radial", lines: 2 });
    const tiny = { ...karim!, endAngle: Math.PI + 0.04, innerRadius: 600, outerRadius: 630 };
    expect(planLabel(tiny).mode).toBe("initials");
    expect(planLabel({ ...tiny, endAngle: Math.PI + 0.01 }).mode).toBe("none");
  });

  test("radialRotation keeps text upright on both sides", () => {
    close(radialRotation(Math.PI), 0);
    close(radialRotation(2 * Math.PI), 360);
    close(radialRotation(1.25 * Math.PI), 45);
    close(radialRotation(1.75 * Math.PI), 315);
  });
});

describe("timeline geometry", () => {
  test("bars sit on rows, generations separated by a gap, x from the year", () => {
    const g = timelineGeometry(timelineLayout(), "ltr");
    const [karim, ahmed, sara] = g.boxes;
    expect(karim!.x).toBe(0);
    expect(ahmed!.x).toBe((1920 - 1890) * g.pxPerYear);
    expect(ahmed!.width).toBe(70 * g.pxPerYear);
    expect(sara!.y - ahmed!.y).toBe(g.rowPitch);
    expect(ahmed!.y - karim!.y).toBe(g.rowPitch + g.groupGap);
    expect(g.groups).toHaveLength(3);
    expect(g.groups[1]!.generation).toBe(1);
    expect(g.groups[1]!.y).toBe(ahmed!.y);
  });

  test("RTL mirrors the year axis", () => {
    const ltr = timelineGeometry(timelineLayout(), "ltr");
    const rtl = timelineGeometry(timelineLayout(), "rtl");
    expect(rtl.yearX(1890)).toBe(ltr.chartWidth);
    expect(rtl.yearX(2026)).toBe(0);
    const ahmed = rtl.boxes[1]!;
    expect(ahmed.x).toBe(rtl.yearX(1990));
    expect(ahmed.width).toBe(70 * rtl.pxPerYear);
  });

  test("a zero-length bar keeps a visible width", () => {
    const layout = timelineLayout();
    layout.bars[0] = { ...layout.bars[0]!, end: layout.bars[0]!.start };
    expect(timelineGeometry(layout, "ltr").boxes[0]!.width).toBeGreaterThan(0);
  });

  test("yearTicks picks a round step that leaves room between labels", () => {
    expect(yearTicks(1890, 2026, 8)).toEqual({
      step: 10,
      ticks: [1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020],
    });
    expect(yearTicks(1890, 2026, 1).step).toBe(100);
    expect(yearTicks(1890, 2026, 40).step).toBe(2);
    expect(yearTicks(1903, 1911, 8).ticks).toEqual([1910]);
  });
});

describe("timelineFit", () => {
  const long = { x: 0, y: 0, width: 3000, height: 400 };

  test("on a phone the bars stay at least 10 px tall; the rest is reached by panning", () => {
    const v = timelineFit(long, { width: 390, height: 700 }, false);
    expect(BAR_H * v.k).toBeGreaterThanOrEqual(10);
  });

  test("on a wide screen it fits the width, never past 1:1, and starts at the top", () => {
    const v = timelineFit(
      { x: 0, y: 0, width: 1000, height: 400 },
      { width: 2000, height: 900 },
      false,
    );
    expect(v.k).toBe(1);
    const narrow = timelineFit(long, { width: 1600, height: 900 }, false);
    expect(narrow.k).toBeCloseTo((1600 - 56 - 16) / 3000, 6);
  });

  test("RTL keeps the start of time at the right edge", () => {
    const v = timelineFit(long, { width: 390, height: 700 }, true);
    expect(v.x + (long.x + long.width) * v.k).toBeCloseTo(390 - 56, 6);
  });
});

describe("visibleBarRange", () => {
  const boxes = timelineGeometry(longTimelineLayout(1000), "ltr").boxes;
  const screen = 600;

  test("at the top only the first screens of bars are drawn, in whole chunks", () => {
    const [start, end] = visibleBarRange(boxes, { x: 0, y: 0, k: 1 }, screen, 50);
    expect(start).toBe(0);
    expect(end % 50).toBe(0);
    // 600 px of 32 px rows is under 20 rows; with the overscan still well under 100.
    expect(end).toBeGreaterThanOrEqual(20);
    expect(end).toBeLessThanOrEqual(100);
  });

  test("scrolled down, the bars on screen are in range and the far ones are not", () => {
    const v = { x: 0, y: -20_000, k: 1 };
    const [start, end] = visibleBarRange(boxes, v, screen, 50);
    const onScreen = boxes
      .map((b, i) => ({ i, top: b.y * v.k + v.y }))
      .filter(({ top }) => top + BAR_H >= 0 && top <= screen)
      .map(({ i }) => i);
    expect(onScreen.length).toBeGreaterThan(10);
    for (const i of onScreen) {
      expect(i).toBeGreaterThanOrEqual(start);
      expect(i).toBeLessThan(end);
    }
    expect(start).toBeGreaterThan(0);
    expect(end).toBeLessThan(boxes.length);
    expect(start % 50).toBe(0);
  });

  test("zoomed out far enough, everything is drawn", () => {
    expect(visibleBarRange(boxes, { x: 0, y: 0, k: 0.01 }, screen, 50)).toEqual([0, 1000]);
  });

  test("small pans inside a chunk give the same range, so the bars are not rebuilt", () => {
    const a = visibleBarRange(boxes, { x: 0, y: -20_000, k: 1 }, screen, 50);
    const b = visibleBarRange(boxes, { x: 0, y: -20_010, k: 1 }, screen, 50);
    expect(b).toEqual(a);
  });

  test("before the view has a size, only the first chunk is drawn", () => {
    expect(visibleBarRange(boxes, { x: 0, y: 0, k: 1 }, 0, 50)).toEqual([0, 50]);
    expect(visibleBarRange([], { x: 0, y: 0, k: 1 }, 600, 50)).toEqual([0, 0]);
  });
});
