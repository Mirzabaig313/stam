/** An `@font-face` embedded in the exported SVG as a data URL. */
export type FontFace = {
  family: string;
  /** Inclusive weight range; a static face has min = max. */
  weight: [number, number];
  style: string;
  ranges: [number, number][];
  bytes: Uint8Array;
};

const FACE_RE = /@font-face\s*{([^}]*)}/g;

function descriptor(body: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(body);
  return match?.[1]?.trim();
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function weightValue(token: string): number {
  if (token === "normal") return 400;
  if (token === "bold") return 700;
  const n = Number(token);
  return Number.isFinite(n) ? n : 400;
}

function parseWeight(value: string | undefined): [number, number] {
  const tokens = (value ?? "400").toLowerCase().split(/\s+/).map(weightValue);
  const min = tokens[0] ?? 400;
  return [min, tokens[1] ?? min];
}

/** `U+0000-00FF, U+0131, U+06??` as inclusive code point ranges. No value means everything. */
export function parseUnicodeRange(value: string | undefined): [number, number][] {
  if (!value) return [[0, 0x10ffff]];
  const ranges: [number, number][] = [];
  for (const part of value.split(",")) {
    const match = /^\s*u\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!match?.[1]) continue;
    const start = match[1];
    if (start.includes("?")) {
      ranges.push([
        parseInt(start.replace(/\?/g, "0"), 16),
        parseInt(start.replace(/\?/g, "f"), 16),
      ]);
    } else {
      const lo = parseInt(start, 16);
      ranges.push([lo, match[2] ? parseInt(match[2], 16) : lo]);
    }
  }
  return ranges;
}

export function inRange(ranges: [number, number][], codePoint: number): boolean {
  return ranges.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Every `@font-face` in the CSS whose source is an embedded base64 data URL. */
export function parseFontFaces(css: string): FontFace[] {
  const faces: FontFace[] = [];
  for (const [, body = ""] of css.matchAll(FACE_RE)) {
    const family = descriptor(body, "font-family");
    const src = /url\(\s*["']?data:[^;,]*;base64,([A-Za-z0-9+/=]+)["']?\s*\)/.exec(body);
    if (!family || !src?.[1]) continue;
    faces.push({
      family: unquote(family),
      weight: parseWeight(descriptor(body, "font-weight")),
      style: (descriptor(body, "font-style") ?? "normal").toLowerCase(),
      ranges: parseUnicodeRange(descriptor(body, "unicode-range")),
      bytes: decodeBase64(src[1]),
    });
  }
  return faces;
}

/** The CSS with its `@font-face` rules removed (svg2pdf can't use them, and they are large). */
export function stripFontFaces(css: string): string {
  return css.replace(FACE_RE, "");
}
