import { afterEach, describe, expect, test } from "bun:test";

import * as fontkit from "fontkit";

import { parseFontFaces } from "@/export/pdf/fontFaces";
import { createFontSet } from "@/export/pdf/fonts";
import { textToPaths } from "@/export/pdf/textToPaths";

import { pdfFixtureSvg } from "../../fixtures/pdfSvg";

const fixture = pdfFixtureSvg();
const fonts = createFontSet(fontkit, parseFontFaces(fixture.svg));

function mount(svg: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const el = document.importNode(parsed, true) as unknown as SVGSVGElement;
  document.body.append(el);
  return el;
}

/** Min and max x over all the coordinates in a path's d. */
function xExtent(d: string): [number, number] {
  const xs = [...d.matchAll(/[MLQCZ]?(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
  return [Math.min(...xs), Math.max(...xs)];
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("textToPaths", () => {
  test("replaces every <text> in the fixture with an outline path", () => {
    const svg = mount(fixture.svg);
    const textCount = svg.querySelectorAll("text").length;
    const result = textToPaths(svg, fonts);
    expect(result.converted).toBe(textCount);
    expect(result.unsupported).toEqual([]);
    expect(svg.querySelectorAll("text")).toHaveLength(0);
  });

  test("keeps class and fill so the card's CSS still applies", () => {
    const svg = mount(fixture.svg);
    textToPaths(svg, fonts);
    const names = svg.querySelectorAll("path.name");
    expect(names).toHaveLength(2);
    expect(names[0]!.getAttribute("fill")).toBe("#1d1b16");
  });

  test("text-anchor middle centres the outlines on x", () => {
    const svg = mount(
      `<svg xmlns="http://www.w3.org/2000/svg"><text x="300" y="50" text-anchor="middle" font-family="Archivo Variable" font-size="20">Khan family</text></svg>`,
    );
    textToPaths(svg, fonts);
    const [lo, hi] = xExtent(svg.querySelector("path")!.getAttribute("d")!);
    // The ink is centred up to the glyphs' side bearings.
    expect(Math.abs((lo + hi) / 2 - 300)).toBeLessThan(1.5);
  });

  test("in right-to-left text, text-anchor end puts the left edge at x", () => {
    // direction rtl flips start and end: "end" puts the text's left edge at x.
    const svg = mount(
      `<svg xmlns="http://www.w3.org/2000/svg"><text x="100" y="50" text-anchor="end" direction="rtl" font-family="Noto Naskh Arabic" font-size="20">محمد علي</text></svg>`,
    );
    textToPaths(svg, fonts);
    const [lo] = xExtent(svg.querySelector("path")!.getAttribute("d")!);
    expect(lo).toBeGreaterThanOrEqual(99);
    expect(lo).toBeLessThan(104);
  });

  test("a bolder weight draws different outlines", () => {
    const svg = mount(
      `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Archivo Variable" font-weight="300">k</text><text font-family="Archivo Variable" font-weight="800">k</text></svg>`,
    );
    textToPaths(svg, fonts);
    const [light, heavy] = [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(light).not.toBe(heavy);
  });

  test("Latin inside right-to-left text keeps its own order", () => {
    const svg = mount(
      `<svg xmlns="http://www.w3.org/2000/svg"><text direction="rtl" text-anchor="end" font-family="Noto Naskh Arabic" font-size="20">علي AB</text><text font-family="Archivo Variable" font-size="20">AB</text></svg>`,
    );
    textToPaths(svg, fonts);
    const [mixed, latin] = [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d")!);
    // In rtl base direction the Latin run comes first (leftmost), still reading A then B.
    const [mixedLo] = xExtent(mixed!);
    const [latinLo] = xExtent(latin!);
    expect(mixedLo - latinLo).toBeLessThan(2);
  });

  test("characters no embedded font has are reported and dropped; all-unsupported text stays", () => {
    const svg = mount(
      `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Archivo Variable">Ali 山</text><text>山田</text></svg>`,
    );
    const result = textToPaths(svg, fonts);
    expect(result.converted).toBe(1);
    expect(result.unsupported).toEqual(["山", "山", "田"]);
    expect(svg.querySelectorAll("text")).toHaveLength(1);
  });

  test("positioned tspans are drawn at their own positions", () => {
    const svg = mount(
      `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Archivo Variable" font-size="20"><tspan x="10" y="20">A</tspan><tspan x="200" y="20">B</tspan></text></svg>`,
    );
    textToPaths(svg, fonts);
    const [lo, hi] = xExtent(svg.querySelector("path")!.getAttribute("d")!);
    expect(lo).toBeLessThan(15);
    expect(hi).toBeGreaterThan(200);
  });
});
