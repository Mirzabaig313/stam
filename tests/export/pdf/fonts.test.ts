import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import * as fontkit from "fontkit";

import { parseFontFaces } from "@/export/pdf/fontFaces";
import { createFontSet, type KitFont } from "@/export/pdf/fonts";
import { fontFaceCss, scriptFontsFor } from "@/export/render/fonts";

import { pdfFixtureSvg } from "../../fixtures/pdfSvg";

const faces = parseFontFaces(pdfFixtureSvg().svg);
const set = createFontSet(fontkit, faces);
const ARCHIVO = ["Archivo Variable", "system-ui", "sans-serif"];

function glyphPath(font: KitFont, char: string): string {
  return JSON.stringify(font.layout(char).glyphs[0]!.path.commands);
}

describe("createFontSet", () => {
  test("reads the three embedded faces from the fixture", () => {
    expect(faces.map((f) => f.family)).toEqual([
      "Archivo Variable",
      "Archivo Variable",
      "Noto Naskh Arabic",
    ]);
  });

  test("picks the subset whose unicode-range covers the character", () => {
    expect(set.faceFor(ARCHIVO, 400, "normal", "A".codePointAt(0)!)).toBe(0);
    expect(set.faceFor(ARCHIVO, 400, "normal", "Đ".codePointAt(0)!)).toBe(1);
  });

  test("falls back to any embedded face that has the glyph", () => {
    expect(set.faceFor(ARCHIVO, 400, "normal", "م".codePointAt(0)!)).toBe(2);
    expect(set.faceFor(ARCHIVO, 400, "normal", 0x4e00)).toBeNull();
  });

  test("a variable WOFF2 instance has the outlines of the matching static weight", () => {
    const bold = set.font(0, 700);
    const regular = set.font(0, 400);
    expect(glyphPath(bold, "k")).not.toBe(glyphPath(regular, "k"));
    const static700 = fontkit.create(
      readFileSync("node_modules/@fontsource/archivo/files/archivo-latin-700-normal.woff2"),
    ) as unknown as KitFont;
    expect(glyphPath(bold, "k")).toBe(glyphPath(static700, "k"));
    // Composite glyphs (an accented letter) vary too.
    expect(glyphPath(set.font(1, 700), "Ć")).toBe(glyphPath(set.font(1, 700), "Ć"));
    expect(glyphPath(set.font(1, 700), "Ć")).not.toBe(glyphPath(set.font(1, 300), "Ć"));
  });

  test("instances are cached per weight and clamped to the axis", () => {
    expect(set.font(0, 700)).toBe(set.font(0, 700));
    expect(set.font(0, 2000)).toBe(set.font(0, 900));
  });

  test("Arabic is shaped: joined letters use contextual forms, not the isolated ones", () => {
    const font = set.font(2, 400);
    const ids = (text: string) =>
      font.layout(text).glyphs.map((g) => (g as unknown as { id: number }).id);
    const isolated = [..."محمد"].flatMap((c) => ids(c));
    const joined = ids("محمد");
    expect(joined).toHaveLength(4);
    expect(joined.toSorted()).not.toEqual(isolated.toSorted());
  });

  test("Nastaliq lays out ڑ and its neighbours (fontkit's NULL mark anchor is skipped, not fatal)", () => {
    const nastaliq = createFontSet(fontkit, parseFontFaces(fontFaceCss(scriptFontsFor(["جوڑنے"]))));
    const face = nastaliq.faceFor(["Noto Nastaliq Urdu"], 400, "normal", "ڑ".codePointAt(0)!);
    expect(face).not.toBeNull();
    for (const word of ["جوڑنے", "چوڑائی", "بڑا", "ڑ"]) {
      const glyphs = nastaliq.font(face!, 400).layout(word).glyphs;
      expect(glyphs.length).toBeGreaterThan(0);
    }
  });
});
