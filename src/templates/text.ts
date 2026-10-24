import { useSyncExternalStore } from "react";

// SVG text does not ellipsize, so names are measured (canvas 2D, the same font the card draws)
// and cut with "…". Widths are cached; the cache resets when web fonts finish loading.

/** The canvas's own family; templates name theirs in `family`. */
export const DEFAULT_FAMILY = '"Archivo Variable", system-ui, sans-serif';

export type Font = { size: number; weight: number; italic?: boolean; family?: string };

export const cssFont = (f: Font) =>
  `${f.italic ? "italic " : ""}${f.weight} ${f.size}px ${f.family ?? DEFAULT_FAMILY}`;

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
let fontEpoch = 0;
const fontListeners = new Set<() => void>();
let watchingFonts = false;

export function subscribeFonts(listener: () => void): () => void {
  fontListeners.add(listener);
  if (!watchingFonts && typeof document !== "undefined" && document.fonts) {
    watchingFonts = true;
    document.fonts.addEventListener?.("loadingdone", () => {
      widths.clear();
      fontEpoch++;
      for (const l of fontListeners) l();
    });
  }
  return () => fontListeners.delete(listener);
}

export const currentFontEpoch = () => fontEpoch;

/** Forgets measured widths: after fonts load, text is measured again in them. */
export function clearTextWidths(): void {
  widths.clear();
}

/** Re-renders the caller when web fonts finish loading, so fitted text uses the real metrics. */
export function useFontEpoch(): number {
  return useSyncExternalStore(subscribeFonts, currentFontEpoch, () => 0);
}

/** Rough average advance, in ems, of a family's first face (only without a canvas). */
function averageAdvance(family: string | undefined): number {
  if (!family) return 0.56;
  if (family.startsWith('"Cormorant')) return 0.45;
  if (family.startsWith('"Caveat')) return 0.4;
  if (family.startsWith('"Fraunces')) return 0.53;
  if (family.startsWith('"Noto Nastaliq')) return 0.42;
  return 0.56;
}

export function textWidth(text: string, font: Font): number {
  const key = `${cssFont(font)}|${text}`;
  const cached = widths.get(key);
  if (cached !== undefined) return cached;
  if (context === undefined) {
    try {
      context = document.createElement("canvas").getContext("2d");
    } catch {
      context = null;
    }
  }
  let width: number;
  if (context && typeof context.measureText === "function") {
    context.font = cssFont(font);
    width = context.measureText(text).width;
  } else {
    // No canvas (tests, scripts): an average advance per family; direction marks take no room.
    const visible = text.replace(/[\u200e\u200f\u2066-\u2069]/g, "");
    width = Array.from(visible).length * font.size * averageAdvance(font.family);
  }
  if (widths.size > 20_000) widths.clear();
  widths.set(key, width);
  return width;
}

/** `text` cut with "…" so it fits `max` px in `font`. Cuts between code points, not inside one. */
export function fitText(text: string, max: number, font: Font): string {
  if (textWidth(text, font) <= max) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(`${chars.slice(0, mid).join("").trimEnd()}…`, font) <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join("").trimEnd()}…`;
}

/** A life line that is too long drops its age (" · 80 yrs") before it is cut with "…". */
export function fitLifeLine(line: string, max: number, font: Font): string {
  if (textWidth(line, font) <= max) return line;
  const at = line.lastIndexOf(" · ");
  return fitText(at > 0 ? line.slice(0, at) : line, max, font);
}
