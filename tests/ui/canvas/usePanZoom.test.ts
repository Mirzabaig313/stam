import { describe, expect, test } from "bun:test";

import { pinchViewport, wheelViewport } from "@/ui/canvas/usePanZoom";
import type { Viewport } from "@/ui/canvas/viewport";

const wheel = (over: Partial<Parameters<typeof wheelViewport>[1]>) => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

const worldAt = (v: Viewport, [sx, sy]: [number, number]) => [(sx - v.x) / v.k, (sy - v.y) / v.k];

describe("wheelViewport", () => {
  const v: Viewport = { x: 10, y: 20, k: 1 };

  test("a plain wheel pans", () => {
    expect(wheelViewport(v, wheel({ deltaX: 30, deltaY: 50 }), [0, 0])).toEqual({
      x: -20,
      y: -30,
      k: 1,
    });
  });

  test("line-mode deltas are scaled to pixels", () => {
    expect(wheelViewport(v, wheel({ deltaY: 3, deltaMode: 1 }), [0, 0]).y).toBe(20 - 48);
  });

  test("shift + vertical wheel pans sideways", () => {
    expect(wheelViewport(v, wheel({ deltaY: 40, shiftKey: true }), [0, 0])).toEqual({
      x: -30,
      y: 20,
      k: 1,
    });
  });

  test("Ctrl or Cmd + wheel zooms around the pointer", () => {
    const anchor: [number, number] = [300, 200];
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const zoomedOut = wheelViewport(v, wheel({ deltaY: 100, ...mod }), anchor);
      expect(zoomedOut.k).toBeLessThan(1);
      expect(zoomedOut.k).toBeGreaterThan(0.7);
      expect(worldAt(zoomedOut, anchor)[0]).toBeCloseTo(worldAt(v, anchor)[0]!, 8);
      const zoomedIn = wheelViewport(v, wheel({ deltaY: -100, ...mod }), anchor);
      expect(zoomedIn.k).toBeGreaterThan(1);
    }
  });

  test("zoom stays within 0.1–4", () => {
    let z: Viewport = v;
    for (let i = 0; i < 100; i++)
      z = wheelViewport(z, wheel({ deltaY: -100, ctrlKey: true }), [0, 0]);
    expect(z.k).toBe(4);
    for (let i = 0; i < 100; i++)
      z = wheelViewport(z, wheel({ deltaY: 100, ctrlKey: true }), [0, 0]);
    expect(z.k).toBe(0.1);
  });
});

describe("pinchViewport", () => {
  test("spreading two fingers zooms by the distance ratio around their midpoint", () => {
    const v: Viewport = { x: 0, y: 0, k: 1 };
    const next = pinchViewport(
      v,
      [
        [100, 100],
        [200, 100],
      ],
      [
        [50, 100],
        [250, 100],
      ],
    );
    expect(next.k).toBeCloseTo(2, 10);
    expect(worldAt(next, [150, 100])).toEqual([150, 100]);
  });

  test("moving both fingers together pans", () => {
    const v: Viewport = { x: 0, y: 0, k: 1 };
    const next = pinchViewport(
      v,
      [
        [100, 100],
        [200, 100],
      ],
      [
        [130, 140],
        [230, 140],
      ],
    );
    expect(next).toEqual({ x: 30, y: 40, k: 1 });
  });
});
