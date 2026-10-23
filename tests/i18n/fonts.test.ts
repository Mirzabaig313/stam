import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseUnicodeRange } from "@/export/pdf/fontFaces";

// The app's Arabic-script fonts (src/i18n/fonts.css): self-hosted, and fetched only when an
// Arabic-script letter is drawn, so the English first load doesn't grow.

const css = readFileSync(
  fileURLToPath(new URL("../../src/i18n/fonts.css", import.meta.url)),
  "utf8",
);
const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body = ""]) => {
  const get = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();
  return {
    family: get("font-family")?.replace(/"/g, ""),
    src: /url\("([^"]+)"\)/.exec(body)?.[1],
    ranges: parseUnicodeRange(get("unicode-range")),
    display: get("font-display"),
  };
});
const covers = (ranges: [number, number][], cp: number) =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

/** Selectors of the rules in `text` that set --font. */
const fontSelectors = (text: string) =>
  [...text.matchAll(/([^{}]+){([^}]*)}/g)]
    .filter(([, , body = ""]) => /--font\s*:/.test(body))
    .flatMap(([, selectors = ""]) =>
      selectors
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((x) => x.trim()),
    );
// Simple selectors only: [attribute] and :pseudo-class count as classes, a leading tag as type.
const specificity = (selector: string) => {
  const classes = (selector.match(/\[|:(?!:)/g) ?? []).length;
  const types = /^[a-z]/i.test(selector) ? 1 : 0;
  return classes * 100 + types;
};

describe("fonts.css", () => {
  test("Naskh draws Arabic-script letters of any text set in Archivo; Nastaliq is Urdu's", () => {
    expect(faces.map((f) => [f.family, f.src?.split("/").at(-1)])).toEqual([
      ["Archivo Variable", "noto-naskh-arabic-arabic-wght-normal.woff2"],
      ["Noto Nastaliq Urdu Variable", "noto-nastaliq-urdu-arabic-wght-normal.woff2"],
    ]);
  });

  test("each file is self-hosted from its @fontsource package", () => {
    for (const face of faces) {
      expect(face.src).toStartWith("@fontsource-variable/");
      expect(existsSync(fileURLToPath(import.meta.resolve(face.src!)))).toBe(true);
    }
  });

  test("only Arabic-script letters fetch them: no Latin, digits, spaces or punctuation", () => {
    for (const face of faces) {
      expect(face.display).toBe("swap");
      for (const char of "مٹےۓﻻ") expect(covers(face.ranges, char.codePointAt(0)!)).toBe(true);
      const fetchedBy = [];
      for (let cp = 0; cp < 0x0600; cp++) if (covers(face.ranges, cp)) fetchedBy.push(cp);
      for (let cp = 0x2000; cp < 0x2070; cp++) if (covers(face.ranges, cp)) fetchedBy.push(cp);
      expect(fetchedBy).toEqual([]);
    }
  });

  test("the Urdu interface is set in Nastaliq, with room for its tall letters", () => {
    expect(css).toMatch(
      /html:root\[lang="ur"\]\s*{[^}]*--font:\s*"Noto Nastaliq Urdu Variable",\s*"Archivo Variable"/,
    );
    expect(css).toMatch(/html\[lang="ur"\] body\s*{[^}]*line-height/);
    // Urdu inside another language's page (the relation panel's Urdu word) too.
    expect(css).toMatch(
      /:not\(html\)\[lang="ur"\]\s*{[^}]*font-family:\s*"Noto Nastaliq Urdu Variable"/,
    );
    // Lane R's build check rejects `:lang(` selectors (Lightning CSS emits them when lowering).
    expect(css).not.toContain(":lang(");
  });

  test("the Urdu font outranks every theme's --font (the theme blocks sit on :root[data-theme])", () => {
    const tokens = readFileSync(
      fileURLToPath(new URL("../../src/ui/styles/tokens.css", import.meta.url)),
      "utf8",
    );
    const urdu = fontSelectors(css).filter((x) => x.includes('lang="ur"'));
    expect(urdu.length).toBeGreaterThan(0);
    const themes = fontSelectors(tokens);
    expect(themes.length).toBeGreaterThan(0);
    const strongestTheme = Math.max(...themes.map(specificity));
    for (const selector of urdu) expect(specificity(selector)).toBeGreaterThan(strongestTheme);
  });

  test("the app loads it with its other styles", () => {
    const main = readFileSync(
      fileURLToPath(new URL("../../src/app/main.tsx", import.meta.url)),
      "utf8",
    );
    expect(main).toContain('import "@/i18n/fonts.css";');
  });
});
