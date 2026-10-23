import { describe, expect, test } from "bun:test";

import {
  centerOn,
  fitBounds,
  intersects,
  lod,
  type Viewport,
  visibleRect,
  zoomAt,
} from "@/ui/canvas/viewport";

const screenOf = (v: Viewport, [wx, wy]: [number, number]): [number, number] => [
  wx * v.k + v.x,
  wy * v.k + v.y,
];
const worldOf = (v: Viewport, [sx, sy]: [number, number]): [number, number] => [
  (sx - v.x) / v.k,
  (sy - v.y) / v.k,
];

describe("zoomAt", () => {
  test("keeps the world point under the anchor fixed", () => {
    const v: Viewport = { x: 30, y: -20, k: 0.8 };
    const anchor: [number, number] = [400, 250];
    const before = worldOf(v, anchor);
    const zoomed = zoomAt(v, anchor, 1.5);
    expect(zoomed.k).toBeCloseTo(1.2, 10);
    const after = worldOf(zoomed, anchor);
    expect(after[0]).toBeCloseTo(before[0], 8);
    expect(after[1]).toBeCloseTo(before[1], 8);
  });

  test("clamps k to 0.1 and 4 and still keeps the anchor fixed", () => {
    const v: Viewport = { x: 10, y: 10, k: 1 };
    const anchor: [number, number] = [100, 100];
    const max = zoomAt(v, anchor, 100);
    expect(max.k).toBe(4);
    expect(worldOf(max, anchor)[0]).toBeCloseTo(worldOf(v, anchor)[0], 8);
    const min = zoomAt(v, anchor, 0.0001);
    expect(min.k).toBe(0.1);
    expect(worldOf(min, anchor)[1]).toBeCloseTo(worldOf(v, anchor)[1], 8);
  });

  test("a clamped no-op returns an equal viewport", () => {
    const v: Viewport = { x: 5, y: 6, k: 4 };
    expect(zoomAt(v, [50, 50], 2)).toEqual(v);
  });
});

describe("fitBounds", () => {
  test("2000x1000 into 1000x800 gives k = 0.452 and centres the box", () => {
    const bounds = { x: 0, y: 0, width: 2000, height: 1000 };
    const screen = { width: 1000, height: 800 };
    const v = fitBounds(bounds, screen);
    expect(Math.abs(v.k - 0.452)).toBeLessThan(0.001);
    const centre = screenOf(v, [1000, 500]);
    expect(centre[0]).toBeCloseTo(500, 6);
    expect(centre[1]).toBeCloseTo(400, 6);
  });

  test("centres bounds that do not start at the origin", () => {
    const v = fitBounds({ x: -300, y: 40, width: 200, height: 100 }, { width: 800, height: 600 });
    const centre = screenOf(v, [-200, 90]);
    expect(centre[0]).toBeCloseTo(400, 6);
    expect(centre[1]).toBeCloseTo(300, 6);
  });

  test("never zooms in past 1", () => {
    expect(fitBounds({ x: 0, y: 0, width: 100, height: 50 }, { width: 1000, height: 800 }).k).toBe(
      1,
    );
  });

  test("never zooms out past the 0.1 floor, and survives empty bounds", () => {
    const tiny = fitBounds({ x: 0, y: 0, width: 1e6, height: 1e6 }, { width: 800, height: 600 });
    expect(tiny.k).toBe(0.1);
    const empty = fitBounds({ x: 10, y: 10, width: 0, height: 0 }, { width: 800, height: 600 });
    expect(empty.k).toBe(1);
    expect(Number.isFinite(empty.x)).toBe(true);
  });
});

describe("centerOn", () => {
  test("puts the world point at the screen centre and keeps k", () => {
    const v = centerOn({ x: 0, y: 0, k: 0.5 }, [400, 200], { width: 1000, height: 600 });
    expect(v.k).toBe(0.5);
    expect(screenOf(v, [400, 200])).toEqual([500, 300]);
  });
});

describe("visibleRect / intersects", () => {
  test("visibleRect is the world rect of the screen grown by a screen-pixel margin", () => {
    const rect = visibleRect({ x: 100, y: 50, k: 2 }, { width: 800, height: 600 }, 0);
    expect(rect).toEqual({ x: -50, y: -25, width: 400, height: 300 });
    const margin = visibleRect({ x: 100, y: 50, k: 2 }, { width: 800, height: 600 }, 200);
    expect(margin).toEqual({ x: -150, y: -125, width: 600, height: 500 });
  });

  test("margin defaults to 200", () => {
    const v: Viewport = { x: 0, y: 0, k: 1 };
    const screen = { width: 100, height: 100 };
    expect(visibleRect(v, screen)).toEqual(visibleRect(v, screen, 200));
  });

  test("intersects: overlap, touching edge, disjoint", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
    expect(intersects(a, { x: 20, y: 20, width: 5, height: 5 })).toBe(false);
    expect(intersects(a, { x: 2, y: 2, width: 1, height: 1 })).toBe(true);
  });
});

describe("lod", () => {
  test("thresholds", () => {
    expect(lod(0.1)).toBe("dot");
    expect(lod(0.19)).toBe("dot");
    expect(lod(0.2)).toBe("name");
    expect(lod(0.3)).toBe("name");
    expect(lod(0.44)).toBe("name");
    expect(lod(0.45)).toBe("full");
    expect(lod(1)).toBe("full");
  });
});
