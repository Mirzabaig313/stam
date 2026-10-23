import { displayName } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import { archivoBase64 } from "./fontData.macro.ts" with { type: "macro" };

/** A font embedded in an exported SVG as an `@font-face` with base64 woff2 data. */
export type EmbeddedFont = {
  family: string;
  style: "normal" | "italic";
  /** CSS `font-weight` range of the variable font. */
  weight: string;
  /** CSS `font-stretch` range, when the font has a width axis. */
  stretch?: string;
  subset: string;
  unicodeRange: string;
  base64: string;
};

/** The family name the canvas uses, so exported cards measure and fit as they do on screen. */
export const EXPORT_FONT_FAMILY = "Archivo Variable";

// Unicode ranges as published by @fontsource-variable/archivo (wdth.css).
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF," +
  "U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329," +
  "U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

// The same files the app loads (wdth.css / wdth-italic.css): weight and width axes, so the
// ruler's 112% stretch renders as on screen. Inlined at bundle time; this module is lazy-loaded.
const archivo = (
  style: "normal" | "italic",
  subset: string,
  unicodeRange: string,
  base64: string,
) =>
  ({
    family: EXPORT_FONT_FAMILY,
    style,
    weight: "100 900",
    stretch: "62% 125%",
    subset,
    unicodeRange,
    base64,
  }) satisfies EmbeddedFont;

const ARCHIVO_NORMAL: EmbeddedFont[] = [
  archivo("normal", "latin-ext", LATIN_EXT, archivoBase64("archivo-latin-ext-wdth-normal.woff2")),
  archivo("normal", "latin", LATIN, archivoBase64("archivo-latin-wdth-normal.woff2")),
];
const ARCHIVO_ITALIC: EmbeddedFont[] = [
  archivo("italic", "latin-ext", LATIN_EXT, archivoBase64("archivo-latin-ext-wdth-italic.woff2")),
  archivo("italic", "latin", LATIN, archivoBase64("archivo-latin-wdth-italic.woff2")),
];

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/u;

/** True when any name in the document is written in Arabic script (Arabic, Urdu, Persian…). */
export function hasArabicScript(doc: TreeDocument): boolean {
  return Object.values(doc.persons).some((p) =>
    [p.firstName, p.lastName, p.nickname, p.nativeName].some((s) => s && ARABIC_SCRIPT.test(s)),
  );
}

/**
 * The fonts an export of `doc` needs: Archivo (latin and latin-ext) always, its italic only when
 * an unnamed placeholder is drawn (the "Unknown father" label is italic).
 *
 * The seam for script fonts: M4 adds Noto Naskh Arabic and Noto Nastaliq Urdu here when
 * `hasArabicScript(doc)`. Until then Arabic-script names fall back to the viewer's system fonts.
 */
export function fontsFor(doc: TreeDocument): EmbeddedFont[] {
  const italic = Object.values(doc.persons).some((p) => p.isPlaceholder && !displayName(p));
  return italic ? [...ARCHIVO_NORMAL, ...ARCHIVO_ITALIC] : ARCHIVO_NORMAL;
}

/** `@font-face` rules for `fonts`. Base64 and the ranges hold no `<` or `&`: safe in SVG/HTML. */
export function fontFaceCss(fonts: readonly EmbeddedFont[]): string {
  return fonts
    .map((f) =>
      [
        "@font-face{",
        `font-family:"${f.family}";`,
        `font-style:${f.style};`,
        `font-weight:${f.weight};`,
        f.stretch ? `font-stretch:${f.stretch};` : "",
        `src:url(data:font/woff2;base64,${f.base64}) format("woff2");`,
        `unicode-range:${f.unicodeRange}`,
        "}",
      ].join(""),
    )
    .join("\n");
}
