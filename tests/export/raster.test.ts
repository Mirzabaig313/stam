import { describe, expect, test } from "bun:test";

import { maxScale } from "@/export/raster/limits";

const desktop = { ios: false };
const ios = { ios: true };

describe("maxScale", () => {
  test("keeps the requested scale when the image is small", () => {
    expect(maxScale(1000, 800, 2, desktop)).toEqual({ scale: 2 });
  });

  test("reduces the scale at the 16,384 px side limit", () => {
    const r = maxScale(8000, 1000, 4, desktop);
    expect(r.warning).toBe("SIDE_LIMIT");
    expect(r.scale).toBeLessThanOrEqual(16384 / 8000);
    expect(r.scale).toBeGreaterThan(2);
  });

  test("allows exactly the side limit", () => {
    expect(maxScale(4096, 100, 4, desktop)).toEqual({ scale: 4 });
  });

  test("keeps a square drawing inside the desktop area limit", () => {
    const r = maxScale(10000, 10000, 4, desktop);
    expect(r.warning).toBeDefined();
    expect(10000 * r.scale * 10000 * r.scale).toBeLessThanOrEqual(268_435_456);
  });

  test("uses the smaller iOS area limit", () => {
    const r = maxScale(2000, 2000, 4, ios);
    expect(r.warning).toBe("AREA_LIMIT");
    expect(2000 * r.scale * 2000 * r.scale).toBeLessThanOrEqual(16_777_216);
    expect(maxScale(2000, 2000, 4, desktop)).toEqual({ scale: 4 });
  });

  test("reports the tighter of the two limits", () => {
    expect(maxScale(20000, 20000, 1, desktop).warning).toBe("SIDE_LIMIT");
  });

  test("can go below 1 for huge drawings and never reaches zero", () => {
    const r = maxScale(100000, 10, 1, desktop);
    expect(r.scale).toBeLessThan(1);
    expect(r.scale).toBeGreaterThan(0);
  });
});
