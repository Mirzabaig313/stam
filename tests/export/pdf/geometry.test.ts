import { describe, expect, test } from "bun:test";

import {
  cellName,
  PAGE_SIZES_MM,
  posterLayout,
  PX_TO_MM,
  TILE_MARGIN_MM,
  tileLayout,
} from "@/export/pdf/geometry";

describe("PAGE_SIZES_MM", () => {
  test("covers the ISO A series, Letter and Tabloid in portrait millimetres", () => {
    expect(PAGE_SIZES_MM).toEqual({
      A4: { w: 210, h: 297 },
      A3: { w: 297, h: 420 },
      A2: { w: 420, h: 594 },
      A1: { w: 594, h: 841 },
      A0: { w: 841, h: 1189 },
      Letter: { w: 215.9, h: 279.4 },
      Tabloid: { w: 279.4, h: 431.8 },
    });
  });
});

describe("posterLayout", () => {
  test("auto picks landscape for a wide drawing because it prints larger", () => {
    const p = posterLayout(2000, 500, { page: "A4", orientation: "auto", marginMm: 10 });
    expect(p.orientation).toBe("landscape");
    expect(p.pageW).toBe(297);
    expect(p.pageH).toBe(210);
    // Width-bound: 277 mm across.
    expect(p.width).toBeCloseTo(277, 6);
    expect(p.height).toBeCloseTo(277 / 4, 6);
  });

  test("auto picks portrait for a tall drawing", () => {
    const p = posterLayout(500, 2000, { page: "A3", orientation: "auto", marginMm: 15 });
    expect(p.orientation).toBe("portrait");
    expect(p.pageW).toBe(297);
    expect(p.pageH).toBe(420);
  });

  test("fits inside the margins and centres the drawing", () => {
    const p = posterLayout(1000, 1000, { page: "A4", orientation: "portrait", marginMm: 10 });
    expect(p.width).toBeCloseTo(190, 6);
    expect(p.height).toBeCloseTo(190, 6);
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.y).toBeCloseTo((297 - 190) / 2, 6);
    expect(p.scale).toBeCloseTo(190 / (1000 * PX_TO_MM), 6);
  });

  test("a forced orientation is kept even when the other would print larger", () => {
    const p = posterLayout(2000, 500, { page: "A4", orientation: "portrait", marginMm: 10 });
    expect(p.orientation).toBe("portrait");
    expect(p.pageW).toBe(210);
  });

  test("accepts a custom page size and orients it", () => {
    const p = posterLayout(100, 50, {
      page: { w: 300, h: 600 },
      orientation: "landscape",
      marginMm: 0,
    });
    expect(p.pageW).toBe(600);
    expect(p.pageH).toBe(300);
  });

  test("rejects margins that leave no room and empty drawings", () => {
    expect(() =>
      posterLayout(100, 100, { page: "A4", orientation: "auto", marginMm: 105 }),
    ).toThrow(RangeError);
    expect(() => posterLayout(0, 100, { page: "A4", orientation: "auto", marginMm: 10 })).toThrow(
      RangeError,
    );
    expect(() =>
      posterLayout(100, 100, { page: { w: -1, h: 10 }, orientation: "auto", marginMm: 0 }),
    ).toThrow(RangeError);
  });
});

describe("tileLayout", () => {
  test("a drawing that fits one tile gives one tile plus the guide page", () => {
    const l = tileLayout(100, 100, { page: "A4", scale: 1, overlapMm: 10 });
    expect(l.cols).toBe(1);
    expect(l.rows).toBe(1);
    expect(l.pageCount).toBe(2);
    expect(l.tiles).toHaveLength(1);
  });

  test("counts columns and rows from the trim box minus the overlap", () => {
    // Portrait A4 trim box: 190 x 277 mm. Step = trim - overlap = 180 x 267 mm.
    // 1300 px = 343.96 mm wide -> 2 columns; 2000 px = 529.17 mm tall -> 2 rows (landscape: 6).
    const l = tileLayout(1300, 2000, { page: "A4", scale: 1, overlapMm: 10 });
    expect(l.orientation).toBe("portrait");
    expect(l.trimW).toBe(210 - 2 * TILE_MARGIN_MM);
    expect([l.cols, l.rows]).toEqual([2, 2]);
    expect(l.pageCount).toBe(5);
  });

  test("scale multiplies the printed size and the page count grows with it", () => {
    const one = tileLayout(1000, 1000, { page: "Letter", scale: 1, overlapMm: 10 });
    const three = tileLayout(1000, 1000, { page: "Letter", scale: 3, overlapMm: 10 });
    expect(three.contentW).toBeCloseTo(one.contentW * 3, 6);
    expect(three.pageCount).toBeGreaterThan(one.pageCount);
  });

  test("the orientation with fewer pages wins", () => {
    // 4000 x 600 px = 1058 x 159 mm. Portrait: 6 x 1 tiles; landscape: 4 x 1.
    const wide = tileLayout(4000, 600, { page: "A4", scale: 1, overlapMm: 10 });
    expect(wide.orientation).toBe("landscape");
    const tall = tileLayout(600, 4000, { page: "A4", scale: 1, overlapMm: 10 });
    expect(tall.orientation).toBe("portrait");
  });

  test("tiles cover the content edge to edge, each neighbour overlapping by the overlap", () => {
    const l = tileLayout(3000, 2500, { page: "A4", scale: 1.5, overlapMm: 10 });
    expect(l.tiles).toHaveLength(l.cols * l.rows);
    const last = l.tiles.at(-1)!;
    expect(last.sx + l.trimW).toBeGreaterThanOrEqual(l.contentW - 1e-9);
    expect(last.sy + l.trimH).toBeGreaterThanOrEqual(l.contentH - 1e-9);
    const second = l.tiles[1]!;
    expect(second.col).toBe(1);
    expect(second.sx).toBeCloseTo(l.trimW - 10, 6);
    expect(l.tiles[l.cols]!.sy).toBeCloseTo(l.trimH - 10, 6);
  });

  test("rejects a scale of zero and an overlap as large as the trim box", () => {
    expect(() => tileLayout(100, 100, { page: "A4", scale: 0, overlapMm: 10 })).toThrow(RangeError);
    expect(() => tileLayout(100, 100, { page: "A4", scale: 1, overlapMm: 190 })).toThrow(
      RangeError,
    );
  });
});

describe("cellName", () => {
  test("names cells by column letter and row number, past Z", () => {
    expect(cellName(0, 0)).toBe("A1");
    expect(cellName(2, 4)).toBe("E3");
    expect(cellName(0, 26)).toBe("AA1");
  });
});
