export const MAX_SIDE = 16_384;
export const MAX_AREA = 268_435_456;
export const MAX_AREA_IOS = 16_777_216;

export type RasterEnv = { ios: boolean };
export type RasterWarning = "SIDE_LIMIT" | "AREA_LIMIT";

/** iOS Safari (and iPadOS, which reports as a Mac with touch) has a much smaller canvas budget. */
export function detectEnv(): RasterEnv {
  if (typeof navigator === "undefined") return { ios: false };
  const ua = navigator.userAgent ?? "";
  const ios =
    /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  return { ios };
}

const floor2 = (n: number): number => Math.floor(n * 100) / 100;

/** The largest scale at or below `requested` that keeps the bitmap inside the browser limits. */
export function maxScale(
  width: number,
  height: number,
  requested: number,
  env: RasterEnv = detectEnv(),
): { scale: number; warning?: RasterWarning } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const bySide = MAX_SIDE / Math.max(w, h);
  const byArea = Math.sqrt((env.ios ? MAX_AREA_IOS : MAX_AREA) / (w * h));
  if (requested <= bySide && requested <= byArea) return { scale: requested };
  const sideTighter = bySide <= byArea;
  const scale = Math.max(0.01, floor2(Math.min(bySide, byArea)));
  return { scale, warning: sideTighter ? "SIDE_LIMIT" : "AREA_LIMIT" };
}
