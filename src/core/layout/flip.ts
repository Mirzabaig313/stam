import { boundsOf } from "./result";
import type { LayoutResult } from "./types";

/**
 * The layout turned upside down, so the tree grows upward: the top row becomes the bottom one,
 * child lines rise from their parents to their children's bottom edges and over-brackets hang
 * under their row. Each card keeps its own box (it is mirrored about its row band, not flipped
 * inside), so cards still read the right way up. Pure.
 */
export function growUpward(layout: LayoutResult): LayoutResult {
  if (layout.nodes.length === 0) return layout;
  const { cardH } = layout.metrics;
  const lowest = Math.max(...layout.nodes.map((n) => n.y));
  const top = Math.min(...layout.nodes.map((n) => n.y));
  // A box [y, y + cardH] goes to [top + lowest - y, … + cardH]; any point p to top + lowest + cardH - p.
  const pivot = top + lowest + cardH;
  const nodes = layout.nodes.map((n) => ({ ...n, y: top + lowest - n.y }));
  const edges = layout.edges.map((e) => ({
    ...e,
    points: e.points.map(([x, y]): [number, number] => [x, pivot - y]),
  }));
  return { ...layout, nodes, edges, bounds: boundsOf(nodes, edges, layout.metrics) };
}
