import { describe, expect, test } from "bun:test";

import {
  EXPORT_FONT_FAMILY,
  fontFaceCss,
  fontsFor,
  hasArabicScript,
  hasUrduLetters,
  NASTALIQ_FAMILY,
  scriptCss,
  scriptFontsFor,
} from "@/export/render/fonts";

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

  test("Arabic-script names are detected", () => {
    const doc = docOf([person("p", "Ali", "Khan", "male", { nativeName: "علی خان" })], [], "p");
    expect(hasArabicScript(doc)).toBe(true);
    expect(hasArabicScript(famSimple())).toBe(false);
  });

  test("an Arabic-script name adds Noto Naskh Arabic as the export font's Arabic range", () => {
    const doc = docOf([person("p", "Ali", "Khan", "male", { nativeName: "محمد علي" })], [], "p");
    const fonts = fontsFor(doc);
    expect(fonts.map((f) => [f.family, f.subset])).toEqual([
      [EXPORT_FONT_FAMILY, "latin-ext"],
      [EXPORT_FONT_FAMILY, "latin"],
      [EXPORT_FONT_FAMILY, "naskh-arabic"],
    ]);
    const naskh = fonts[2]!;
    expect(naskh.base64.startsWith(WOFF2)).toBe(true);
    expect(naskh.weight).toBe("400 700");
    expect(naskh.unicodeRange).toStartWith("U+0600-06FF");
  });

  test("Urdu letters add Noto Nastaliq Urdu as well", () => {
    expect(hasUrduLetters("محمد علي")).toBe(false); // Arabic
    expect(hasUrduLetters("علی خان")).toBe(false); // Persian-style yeh, shared with Urdu
    expect(hasUrduLetters("ہمارے")).toBe(true);
    expect(hasUrduLetters("ٹیپو")).toBe(true);
    const doc = docOf([person("p", "Tipu", "", "male", { nativeName: "ٹیپو سلطان" })], [], "p");
    expect(
      fontsFor(doc)
        .map((f) => [f.family, f.subset])
        .slice(2),
    ).toEqual([
      [EXPORT_FONT_FAMILY, "naskh-arabic"],
      [NASTALIQ_FAMILY, "nastaliq-urdu"],
    ]);
  });

  test("a title or subtitle in Arabic script counts too", () => {
    expect(fontsFor(famSimple(), ["خاندان", ""]).map((f) => f.subset)).toEqual([
      "latin-ext",
      "latin",
      "naskh-arabic",
    ]);
  });

  test("names and titles in Latin script embed no Arabic-script font", () => {
    expect(fontsFor(famSimple(), ["The Khans"]).map((f) => f.subset)).toEqual([
      "latin-ext",
      "latin",
    ]);
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

describe("scriptFontsFor", () => {
  test("the Arabic-script fonts some text needs, and nothing for Latin text", () => {
    expect(scriptFontsFor(["Export", "Zoom in"])).toEqual([]);
    expect(scriptFontsFor(["تصدير"]).map((f) => f.subset)).toEqual(["naskh-arabic"]);
    expect(scriptFontsFor(["برآمد کریں"]).map((f) => f.subset)).toEqual([
      "naskh-arabic",
      "nastaliq-urdu",
    ]);
  });
});

describe("scriptCss", () => {
  test("sets the title and subtitle in Nastaliq when it is embedded, and nothing otherwise", () => {
    expect(scriptCss(scriptFontsFor(["تصدير"]))).toBe("");
    expect(scriptCss(scriptFontsFor(["ہمارا خاندان"]))).toBe(
      `.stam-export__title,.stam-export__subtitle{font-family:"${NASTALIQ_FAMILY}","${EXPORT_FONT_FAMILY}",system-ui,sans-serif}`,
    );
  });
});
