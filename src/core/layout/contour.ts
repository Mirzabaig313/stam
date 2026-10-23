/**
 * The horizontal extent of a subtree on each of its rows: `min[d]` and `max[d]` are the leftmost
 * and rightmost x on the row `d` levels below the subtree's top row, relative to some origin.
 */
export type Contour = { min: number[]; max: number[] };

export function leafContour(width: number): Contour {
  return { min: [0], max: [width] };
}

export function shifted(contour: Contour, dx: number): Contour {
  return { min: contour.min.map((x) => x + dx), max: contour.max.map((x) => x + dx) };
}

/** The smallest shift that puts `next` at least `gap` right of `placed` on every shared row. */
export function clearRight(placed: Contour, next: Contour, gap: number): number {
  const shared = Math.min(placed.max.length, next.min.length);
  let shift = -Infinity;
  for (let d = 0; d < shared; d++) shift = Math.max(shift, placed.max[d]! - next.min[d]! + gap);
  return shift;
}

/** The largest shift that puts `next` at least `gap` left of `placed` on every shared row. */
export function clearLeft(placed: Contour, next: Contour, gap: number): number {
  const shared = Math.min(placed.min.length, next.max.length);
  let shift = Infinity;
  for (let d = 0; d < shared; d++) shift = Math.min(shift, placed.min[d]! - next.max[d]! - gap);
  return shift;
}

/** Adds `next`, shifted by `shift`, to `placed` (in place). */
export function mergeAt(placed: Contour, next: Contour, shift: number): void {
  for (let d = 0; d < next.min.length; d++) {
    const min = next.min[d]! + shift;
    const max = next.max[d]! + shift;
    if (d < placed.min.length) {
      placed.min[d] = Math.min(placed.min[d]!, min);
      placed.max[d] = Math.max(placed.max[d]!, max);
    } else {
      placed.min.push(min);
      placed.max.push(max);
    }
  }
}

/**
 * Packs subtrees left to right. Each one is shifted right until it clears everything before it
 * by `gap` on every row they share, so a narrow subtree can tuck under a wide neighbour's
 * shallow rows. Returns each subtree's x offset (the first is 0) and their merged contour.
 */
export function packSubtrees(
  contours: readonly Contour[],
  gap: number,
): { offsets: number[]; merged: Contour } {
  const merged = shifted(contours[0]!, 0);
  const offsets = [0];
  for (let i = 1; i < contours.length; i++) {
    const next = contours[i]!;
    const shift = clearRight(merged, next, gap);
    offsets.push(shift);
    mergeAt(merged, next, shift);
  }
  return { offsets, merged };
}

/** Puts a row `[0, width]` on top of a contour that starts `dx` from the row's left edge. */
export function stackUnder(width: number, below: Contour, dx: number): Contour {
  const min = [0];
  const max = [width];
  for (let d = 0; d < below.min.length; d++) {
    min.push(below.min[d]! + dx);
    max.push(below.max[d]! + dx);
  }
  return { min, max };
}
