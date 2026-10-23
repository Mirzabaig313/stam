import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A hand-written stand-in for lane R's export SVG: cards as rounded rects, a dashed connector,
 * names in Archivo (variable, latin + latin-ext subsets) and one Arabic-script name set in
 * Noto Naskh Arabic, all fonts embedded as base64 woff2 the way the renderer embeds them.
 */

const modules = fileURLToPath(new URL("../../node_modules/", import.meta.url));

function woff2(path: string): string {
  return readFileSync(modules + path).toString("base64");
}

export const ARABIC_NAME = "محمد علي";
export const LATIN_EXT_NAME = "Đurđa Čolić";

export function pdfFixtureSvg(): { svg: string; width: number; height: number } {
  const archivoLatin = woff2("@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2");
  const archivoExt = woff2(
    "@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2",
  );
  const naskh = woff2(
    "@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-arabic-400-normal.woff2",
  );
  const width = 640;
  const height = 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
@font-face{font-family:"Archivo Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${archivoLatin}) format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Archivo Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${archivoExt}) format("woff2-variations");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Noto Naskh Arabic";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${naskh}) format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}
svg{font-family:"Archivo Variable",system-ui,sans-serif}
.card{fill:#fffdf8;stroke:#1d1b16;stroke-width:1.5}
.name{font-size:16px;font-weight:600;fill:#1d1b16}
.years{font-size:12px;fill:#6b665c;letter-spacing:0.02em}
.native{font-family:"Noto Naskh Arabic","Archivo Variable",sans-serif;font-size:16px;fill:#1d1b16}
</style>
<rect width="${width}" height="${height}" fill="#f6f3ec"/>
<text x="${width / 2}" y="40" text-anchor="middle" font-size="24" font-weight="800" fill="#1d1b16">The Khan family</text>
<path d="M170 200 H470" fill="none" stroke="#1d1b16" stroke-width="1.5" stroke-dasharray="6 4"/>
<g transform="translate(40 160)">
  <rect class="card" width="200" height="80" rx="10"/>
  <text class="name" x="16" y="34">Ali Khan</text>
  <text class="years" x="16" y="58">1931 – 2004</text>
</g>
<g transform="translate(400 160)">
  <rect class="card" width="200" height="80" rx="10"/>
  <text class="name" x="16" y="34" unicode-bidi="isolate">${LATIN_EXT_NAME}</text>
  <text class="native" x="184" y="62" direction="rtl" unicode-bidi="isolate">${ARABIC_NAME}</text>
</g>
<text x="${width / 2}" y="${height - 30}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="#6b665c">Centred caption</text>
</svg>`;
  return { svg, width, height };
}
