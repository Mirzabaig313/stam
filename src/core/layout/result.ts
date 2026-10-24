import type { TreeDocument } from "@/core/model/types";

import { type CardMetrics, DEFAULT_METRICS } from "./constants";
import type { LayoutEdge, LayoutNode, LayoutResult } from "./types";

/** The layout for a view root that is not in the document: nothing placed. */
export function emptyLayout(doc: TreeDocument, metrics = DEFAULT_METRICS): LayoutResult {
  return {
    metrics,
    nodes: [],
    edges: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    generationCount: 0,
    primaryNode: {},
    unreachable: Object.keys(doc.persons),
  };
}

/** A node's card width and height: its own, or the layout's card. */
export const nodeWidth = (n: Pick<LayoutNode, "width">, m: CardMetrics) => n.width ?? m.cardW;
export const nodeHeight = (n: Pick<LayoutNode, "height">, m: CardMetrics) => n.height ?? m.cardH;

/** The box around every card and every edge point. */
export function boundsOf(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  metrics: CardMetrics = DEFAULT_METRICS,
): LayoutResult["bounds"] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + nodeWidth(node, metrics));
    maxY = Math.max(maxY, node.y + nodeHeight(node, metrics));
  }
  for (const edge of edges) {
    for (const [x, y] of edge.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The persons not in `placed`, in document order. */
export function notIn(doc: TreeDocument, placed: ReadonlySet<string>): string[] {
  return Object.keys(doc.persons).filter((id) => !placed.has(id));
}
