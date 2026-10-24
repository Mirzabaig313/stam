import { layoutFamily } from "@/core/layout/family";
import type { LayoutEdge, LayoutResult } from "@/core/layout/types";
import type { ExportInput, ExportOptions } from "@/export/types";
import { sizesFor } from "@/templates/cardStyle";

type Rect = { x: number; y: number; width: number; height: number };

/** Strict overlap: rects that only share an edge do not intersect (as on the canvas). */
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A segment (possibly zero-width, as most connector runs are) touching the rect. */
function segmentHits([x0, y0]: [number, number], [x1, y1]: [number, number], r: Rect): boolean {
  return (
    Math.min(x0, x1) <= r.x + r.width &&
    Math.max(x0, x1) >= r.x &&
    Math.min(y0, y1) <= r.y + r.height &&
    Math.max(y0, y1) >= r.y
  );
}

function edgeHits(edge: LayoutEdge, r: Rect): boolean {
  const pts = edge.points;
  if (pts.length === 1) return segmentHits(pts[0]!, pts[0]!, r);
  for (let i = 1; i < pts.length; i++) if (segmentHits(pts[i - 1]!, pts[i]!, r)) return true;
  return false;
}

/**
 * The layout cropped to `rect`: nodes whose card overlaps it and edges that touch it. Bounds hold
 * every kept card whole, plus the kept edges clipped to the rect (the SVG viewBox cuts the rest).
 */
export function cropLayout(layout: LayoutResult, rect: Rect): LayoutResult {
  const { cardW, cardH } = layout.metrics;
  const nodes = layout.nodes.filter((n) =>
    overlaps({ x: n.x, y: n.y, width: n.width ?? cardW, height: n.height ?? cardH }, rect),
  );
  const edges = layout.edges.filter((e) => edgeHits(e, rect));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const n of nodes) grow(n.x, n.y, n.x + (n.width ?? cardW), n.y + (n.height ?? cardH));
  const clampX = (x: number) => Math.min(Math.max(x, rect.x), rect.x + rect.width);
  const clampY = (y: number) => Math.min(Math.max(y, rect.y), rect.y + rect.height);
  for (const e of edges) {
    for (const [x, y] of e.points) grow(clampX(x), clampY(y), clampX(x), clampY(y));
  }
  const bounds =
    minX === Infinity
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  const kept = new Set(nodes.map((n) => n.nodeId));
  const primaryNode = Object.fromEntries(
    Object.entries(layout.primaryNode).filter(([, nodeId]) => kept.has(nodeId)),
  );
  return {
    nodes,
    edges,
    bounds,
    generationCount: new Set(nodes.map((n) => n.generation)).size,
    primaryNode,
    unreachable: layout.unreachable,
    metrics: layout.metrics,
  };
}

/**
 * The layout an export draws, by scope:
 * - `whole`: the whole family from the document root, nothing collapsed;
 * - `view`: the editor's current layout, as it is;
 * - `branch`: the selected person with their partners and descendants, nothing collapsed;
 * - `visible`: the current layout cropped to `visibleRect` (layout coordinates, unmirrored).
 * A scope that cannot apply (no root, no selection, no rect) falls back to `view`.
 */
export function selectScope(input: ExportInput, opts: ExportOptions): LayoutResult {
  const { doc, layout, selectedId, visibleRect } = input;
  // Cards resized on their own keep their size in a fresh layout too.
  const sizes = sizesFor(input.cardStyles ?? {}, layout.metrics);
  const own = sizes ? { sizes } : {};
  switch (opts.scope) {
    case "whole": {
      const root = doc.rootPersonId;
      return root && Object.hasOwn(doc.persons, root)
        ? layoutFamily(doc, { rootId: root, metrics: layout.metrics, ...own })
        : layout;
    }
    case "branch":
      return selectedId && Object.hasOwn(doc.persons, selectedId)
        ? layoutFamily(doc, { rootId: selectedId, metrics: layout.metrics, ...own })
        : layout;
    case "visible":
      return visibleRect ? cropLayout(layout, visibleRect) : layout;
    case "view":
      return layout;
  }
}
