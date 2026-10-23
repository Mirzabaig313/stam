import { describe, expect, test } from "bun:test";

import { fontFaceCss, fontsFor, hasArabicScript } from "@/export/render/fonts";

import { docOf, famSimple, person } from "../../fixtures/families";

// "wOF2", the woff2 signature, in base64.
const WOFF2 = "d09GMg";

describe("fontsFor", () => {
  test("Archivo latin and latin-ext, upright, for a plain family", () => {
    const fonts = fontsFor(famSimple());
    expect(fonts.map((f) => [f.family, f.style, f.subset])).toEqual([
      ["Archivo Variable", "normal", "latin-ext"],
      ["Archivo Variable", "normal", "latin"],
    ]);
    for (const f of fonts) expect(f.base64.startsWith(WOFF2)).toBe(true);
  });

  test("adds the italic faces when a placeholder is drawn (its label is set in italic)", () => {
    const doc = docOf([person("p", "", "", "male", { isPlaceholder: true })], [], "p");
    expect(fontsFor(doc).map((f) => f.style)).toEqual(["normal", "normal", "italic", "italic"]);
  });

  test("Arabic-script names are detected (M4 adds their fonts; Archivo only for now)", () => {
    const doc = docOf([person("p", "Ali", "Khan", "male", { nativeName: "علی خان" })], [], "p");
    expect(hasArabicScript(doc)).toBe(true);
    expect(hasArabicScript(famSimple())).toBe(false);
    expect(fontsFor(doc).every((f) => f.family === "Archivo Variable")).toBe(true);
  });
});

describe("fontFaceCss", () => {
  test("one @font-face per font, base64 woff2 inline, variable axes and unicode range", () => {
    const css = fontFaceCss(fontsFor(famSimple()));
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain(`url(data:font/woff2;base64,${WOFF2}`);
    expect(css).toContain("font-weight:100 900");
    expect(css).toContain("font-stretch:62% 125%");
    expect(css).toContain("unicode-range:U+0000-00FF");
    expect(css).not.toContain("<");
    expect(css).not.toContain("&");
  });
});
