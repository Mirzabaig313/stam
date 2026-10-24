import { displayName } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import type { TemplateId } from "@/templates/look";

import {
  archivoBase64,
  notoBase64,
  templateFontBase64,
} from "./fontData.macro.ts" with { type: "macro" };

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

/** The family Urdu text is set in (titles, the Urdu HTML viewer); Arabic-script range only. */
export const NASTALIQ_FAMILY = "Noto Nastaliq Urdu";

// The Arabic blocks of @fontsource-variable's "arabic" subsets, without the punctuation and
// direction marks they share with Archivo's latin range.
const ARABIC_RANGE =
  "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+FB50-FDFF," +
  "U+FE70-FE74,U+FE76-FEFC";

// Naskh is the export family's Arabic-script range, as in the app (src/i18n/fonts.css): every
// text drawn in Archivo, card names included, falls through to it, and cards measure as on screen.
const NASKH: EmbeddedFont = {
  family: EXPORT_FONT_FAMILY,
  style: "normal",
  weight: "400 700",
  subset: "naskh-arabic",
  unicodeRange: ARABIC_RANGE,
  base64: notoBase64("noto-naskh-arabic-arabic-wght-normal.woff2"),
};

const NASTALIQ: EmbeddedFont = {
  family: NASTALIQ_FAMILY,
  style: "normal",
  weight: "400 700",
  subset: "nastaliq-urdu",
  unicodeRange: ARABIC_RANGE,
  base64: notoBase64("noto-nastaliq-urdu-arabic-wght-normal.woff2"),
};

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/u;
/**
 * Letters only Urdu uses among Arabic-script languages: ٹ ڈ ڑ ں ھ ہ ۂ ۃ ے ۓ. Yeh (ی) and keheh (ک)
 * are shared with Persian, so a name with only those stays in Naskh.
 */
const URDU_LETTERS = /[\u0679\u0688\u0691\u06BA\u06BE\u06C1-\u06C3\u06D2\u06D3]/u;

const namesOf = (doc: TreeDocument) =>
  Object.values(doc.persons).flatMap((p) => [p.firstName, p.lastName, p.nickname, p.nativeName]);

/** True when any name in the document is written in Arabic script (Arabic, Urdu, Persian…). */
export function hasArabicScript(doc: TreeDocument): boolean {
  return namesOf(doc).some((s) => s && ARABIC_SCRIPT.test(s));
}

/** True when the text has a letter only Urdu uses, so it reads best in Nastaliq. */
export function hasUrduLetters(text: string): boolean {
  return URDU_LETTERS.test(text);
}

/**
 * The Arabic-script fonts some text needs: Noto Naskh Arabic for any Arabic-script letter, and
 * Noto Nastaliq Urdu as well when there is Urdu.
 */
export function scriptFontsFor(texts: readonly (string | undefined)[]): EmbeddedFont[] {
  const arabic = texts.filter((s): s is string => !!s && ARABIC_SCRIPT.test(s));
  if (arabic.length === 0) return [];
  return arabic.some(hasUrduLetters) ? [NASKH, NASTALIQ] : [NASKH];
}

// The templates' own families, as in the app (src/templates/fonts.css). Latin only: names in
// other Latin-extended letters fall through to Archivo, Arabic-script ones to Naskh.
const templateFace = (
  family: string,
  style: "normal" | "italic",
  weight: string,
  base64: string,
): EmbeddedFont => ({ family, style, weight, subset: "latin", unicodeRange: LATIN, base64 });

const CORMORANT = [
  templateFace(
    "Cormorant Garamond Variable",
    "normal",
    "300 700",
    templateFontBase64("cormorant-garamond-latin-wght-normal.woff2"),
  ),
  templateFace(
    "Cormorant Garamond Variable",
    "italic",
    "300 700",
    templateFontBase64("cormorant-garamond-latin-wght-italic.woff2"),
  ),
];
const FRAUNCES = [
  templateFace(
    "Fraunces Variable",
    "normal",
    "100 900",
    templateFontBase64("fraunces-latin-wght-normal.woff2"),
  ),
  templateFace(
    "Fraunces Variable",
    "italic",
    "100 900",
    templateFontBase64("fraunces-latin-wght-italic.woff2"),
  ),
];
const CAVEAT = [
  templateFace(
    "Caveat Variable",
    "normal",
    "400 700",
    templateFontBase64("caveat-latin-wght-normal.woff2"),
  ),
];

/** The families each template draws in, besides Archivo and the Arabic-script fonts. */
const TEMPLATE_FONTS: Record<TemplateId, EmbeddedFont[]> = {
  album: CAVEAT,
  heritage: CORMORANT,
  botanical: FRAUNCES,
  gallery: [],
  shajara: CORMORANT,
  swiss: [],
};

/**
 * The fonts an export of `doc` needs: Archivo (latin and latin-ext) always, its italic only when
 * an unnamed placeholder is drawn (the "Unknown father" label is italic), the template's own
 * families, and the Arabic-script fonts its names and `texts` (the title and subtitle) need.
 * Shajara draws names and its title in Nastaliq, so it always takes Nastaliq with Naskh.
 */
export function fontsFor(
  doc: TreeDocument,
  texts: readonly string[] = [],
  template?: TemplateId,
): EmbeddedFont[] {
  const italic = Object.values(doc.persons).some((p) => p.isPlaceholder && !displayName(p));
  const script = scriptFontsFor([...namesOf(doc), ...texts]);
  const shajara =
    template === "shajara" ? [NASKH, NASTALIQ].filter((f) => !script.includes(f)) : [];
  return [
    ...ARCHIVO_NORMAL,
    ...(italic ? ARCHIVO_ITALIC : []),
    ...(template ? TEMPLATE_FONTS[template] : []),
    ...script,
    ...shajara,
  ];
}

/**
 * Rules for the embedded script fonts: with Nastaliq embedded, the title and subtitle set their
 * Urdu in it (cards keep Naskh, the font they are fitted with on screen).
 */
export function scriptCss(fonts: readonly EmbeddedFont[]): string {
  if (!fonts.some((f) => f.family === NASTALIQ_FAMILY)) return "";
  return `.stam-export__title,.stam-export__subtitle{font-family:"${NASTALIQ_FAMILY}","${EXPORT_FONT_FAMILY}",system-ui,sans-serif}`;
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
