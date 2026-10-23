/** screen = world * k + (x, y) */
export type Viewport = { x: number; y: number; k: number };

export type Rect = { x: number; y: number; width: number; height: number };

type Size = { width: number; height: number };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Scales by `factor` around a screen point, which stays over the same world point. */
export function zoomAt(v: Viewport, screenPoint: [number, number], factor: number): Viewport {
  const k = clampZoom(v.k * factor);
  const ratio = k / v.k;
  return {
    x: screenPoint[0] - (screenPoint[0] - v.x) * ratio,
    y: screenPoint[1] - (screenPoint[1] - v.y) * ratio,
    k,
  };
}

/** The viewport that shows all of `bounds`, centred, never zoomed in past 1. */
export function fitBounds(bounds: Rect, screen: Size, padding = 48): Viewport {
  const fitW = bounds.width > 0 ? (screen.width - 2 * padding) / bounds.width : Infinity;
  const fitH = bounds.height > 0 ? (screen.height - 2 * padding) / bounds.height : Infinity;
  const k = clampZoom(Math.min(1, fitW, fitH));
  return {
    k,
    x: (screen.width - bounds.width * k) / 2 - bounds.x * k,
    y: (screen.height - bounds.height * k) / 2 - bounds.y * k,
  };
}

/** Pans so `worldPoint` sits at the screen centre; zoom is unchanged. */
export function centerOn(v: Viewport, worldPoint: [number, number], screen: Size): Viewport {
  return {
    k: v.k,
    x: screen.width / 2 - worldPoint[0] * v.k,
    y: screen.height / 2 - worldPoint[1] * v.k,
  };
}

/** The world rect on screen, grown by `margin` screen pixels on every side (for culling). */
export function visibleRect(v: Viewport, screen: Size, margin = 200): Rect {
  return {
    x: (-v.x - margin) / v.k,
    y: (-v.y - margin) / v.k,
    width: (screen.width + 2 * margin) / v.k,
    height: (screen.height + 2 * margin) / v.k,
  };
}

/** True when the rects overlap; rects that only share an edge do not. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** How much of a card is drawn: everything, the name only, or a dot. */
export type Lod = "full" | "name" | "dot";

/** Level of detail for a card at zoom `k`. */
export function lod(k: number): Lod {
  if (k < 0.2) return "dot";
  if (k < 0.45) return "name";
  return "full";
}
