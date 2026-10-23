import { describe, expect, test } from "bun:test";

import * as fontkit from "fontkit";

import { parseFontFaces } from "@/export/pdf/fontFaces";
import { createFontSet } from "@/export/pdf/fonts";
import { drawLabel, labelFaces, type PathSink } from "@/export/pdf/labels";
import { fontFaceCss, fontsFor } from "@/export/render/fonts";

import { famSimple } from "../../fixtures/families";

// The tiled PDF's guide and tile labels: drawn as outlines in the export's fonts (Archivo, and
// Noto for Arabic script), not as Helvetica text, which has neither latin-ext nor Arabic.

/** The export SVG's faces for a tree with only Latin names: Archivo alone. */
const archivoOnly = parseFontFaces(fontFaceCss(fontsFor(famSimple())));

/** Records the path calls; one shape per `fill`. */
function recorder() {
  const ops: [string, ...number[]][] = [];
  const sink: PathSink = {
    moveTo: (x, y) => (ops.push(["m", x, y]), sink),
    lineTo: (x, y) => (ops.push(["l", x, y]), sink),
    curveTo: (...c) => (ops.push(["c", ...c]), sink),
    close: () => (ops.push(["h"]), sink),
    fill: () => (ops.push(["f"]), sink),
  } as PathSink;
  const xs = () => ops.flatMap(([op, ...c]) => (op === "c" ? [c[0]!, c[2]!, c[4]!] : [c[0]!]));
  const ys = () => ops.flatMap(([op, ...c]) => (op === "c" ? [c[1]!, c[3]!, c[5]!] : [c[1]!]));
  const box = () => {
    const x = xs().filter(Number.isFinite);
    const y = ys().filter(Number.isFinite);
    return {
      left: Math.min(...x),
      right: Math.max(...x),
      top: Math.min(...y),
      bottom: Math.max(...y),
    };
  };
  return { sink, ops, box };
}

describe("labelFaces", () => {
  test("adds the Noto fonts the label text needs when the tree embedded none", () => {
    expect(labelFaces(archivoOnly, ["Assembly guide"])).toHaveLength(archivoOnly.length);
    const urdu = labelFaces(archivoOnly, ["جوڑنے کی رہنمائی"]);
    expect(urdu.map((f) => f.family).slice(archivoOnly.length)).toEqual([
      "Archivo Variable",
      "Noto Nastaliq Urdu",
    ]);
  });

  test("doesn't add a font the tree's SVG already embeds", () => {
    const withNaskh = parseFontFaces(fontFaceCss(fontsFor(famSimple(), ["علي"])));
    expect(labelFaces(withNaskh, ["دليل التجميع"])).toHaveLength(withNaskh.length);
  });
});

describe("drawLabel", () => {
  test("fills glyph outlines at the size asked for (pt, on a mm page)", () => {
    const fonts = createFontSet(fontkit, archivoOnly);
    const { sink, ops, box } = recorder();
    const r = drawLabel(sink, fonts, "Row 2, column 3 · Đ", 20, 30, { sizePt: 11 });
    expect(r.unsupported).toEqual([]);
    expect(ops.filter(([op]) => op === "f")).toHaveLength(1);
    const b = box();
    expect(b.left).toBeGreaterThanOrEqual(20);
    expect(b.left).toBeLessThan(21);
    // Cap height of 11 pt Archivo is about 2.8 mm above the baseline.
    expect(30 - b.top).toBeGreaterThan(2.2);
    expect(30 - b.top).toBeLessThan(3.5);
  });

  test("draws Urdu and Arabic, shaped, once their fonts are added", () => {
    for (const text of ["جوڑنے کی رہنمائی", "دليل التجميع"]) {
      const fonts = createFontSet(fontkit, labelFaces(archivoOnly, [text]));
      const { sink, ops } = recorder();
      expect(drawLabel(sink, fonts, text, 100, 30, { sizePt: 16 }).unsupported).toEqual([]);
      expect(ops.length).toBeGreaterThan(20);
    }
  });

  test("right-to-left text aligned left starts at x; aligned right ends at x", () => {
    const fonts = createFontSet(fontkit, labelFaces(archivoOnly, ["دليل"]));
    const left = recorder();
    drawLabel(left.sink, fonts, "دليل التجميع", 50, 30, { sizePt: 12 });
    expect(left.box().left).toBeGreaterThanOrEqual(49.5);
    expect(left.box().left).toBeLessThan(51);
    const right = recorder();
    drawLabel(right.sink, fonts, "دليل التجميع", 150, 30, { sizePt: 12, align: "right" });
    expect(right.box().right).toBeLessThanOrEqual(150.5);
    expect(right.box().right).toBeGreaterThan(149);
  });

  test("centres, hangs from the top, and turns a quarter for the side labels", () => {
    const fonts = createFontSet(fontkit, archivoOnly);
    const centred = recorder();
    drawLabel(centred.sink, fonts, "B4", 100, 50, { sizePt: 9, align: "center" });
    const c = centred.box();
    expect((c.left + c.right) / 2).toBeCloseTo(100, 0);
    const hanging = recorder();
    drawLabel(hanging.sink, fonts, "B4", 100, 50, { sizePt: 9, baseline: "top" });
    expect(hanging.box().top).toBeGreaterThanOrEqual(50);
    const turned = recorder();
    drawLabel(turned.sink, fonts, "B4", 100, 50, { sizePt: 9, align: "center", angle: 90 });
    const t = turned.box();
    // Reads bottom to top: taller than wide, centred on y, the letters left of x.
    expect(t.bottom - t.top).toBeGreaterThan(t.right - t.left);
    expect((t.top + t.bottom) / 2).toBeCloseTo(50, 0);
    expect(t.right).toBeLessThanOrEqual(100.1);
  });
});
