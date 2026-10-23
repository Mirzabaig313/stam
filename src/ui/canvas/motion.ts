// The one motion family: expo-out. Layout re-flow takes 450 ms; quick moves (camera, hover,
// card return) take 250 ms. Under prefers-reduced-motion nothing animates.

export const REFLOW_MS = 450;
export const QUICK_MS = 250;

/** CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress in [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  /** The curve parameter whose x is `x`: Newton first, bisection if it stalls. */
  const solve = (x: number): number => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < 1e-7) return s;
      const d = slopeX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    while (hi - lo > 1e-7) {
      if (sampleX(s) < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return s;
  };

  return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solve(t)));
}

/** `cubic-bezier(0.16, 1, 0.3, 1)`, the global easing. */
export const ease = cubicBezier(0.16, 1, 0.3, 1);

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Calls `onFrame` with eased progress on every animation frame for `duration` ms, ending with 1.
 * Returns a cancel function. Without requestAnimationFrame it finishes at once.
 */
export function animate(duration: number, onFrame: (progress: number) => void): () => void {
  if (typeof requestAnimationFrame !== "function" || duration <= 0) {
    onFrame(1);
    return () => {};
  }
  let start: number | null = null;
  let id = requestAnimationFrame(function tick(now) {
    start ??= now;
    const t = Math.min(1, (now - start) / duration);
    onFrame(ease(t));
    if (t < 1) id = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(id);
}
