import type { LayoutNode, LayoutResult } from "@/core/layout/types";
import { childrenOf, parentsOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * The node to focus after an arrow key, or null when there is none.
 * Up: primary card of the first biological parent, if on screen. Down: primary card of the
 * first child that is on screen (the other way round when the tree grows upward). Left/Right: the nearest card in the same row by x, whatever
 * its kind; in RTL the two swap so the arrows follow what the user sees.
 */
export function nextFocus(
  layout: LayoutResult,
  doc: TreeDocument,
  nodeId: string,
  key: ArrowKey,
  dir: "ltr" | "rtl" = "ltr",
  growth: "down" | "up" = "down",
): string | null {
  const node = layout.nodes.find((n) => n.nodeId === nodeId);
  if (!node) return null;

  // In a tree that grows upward the arrows still follow what the user sees: up goes to a child.
  const towards =
    growth === "up" && (key === "ArrowUp" || key === "ArrowDown")
      ? key === "ArrowUp"
        ? "ArrowDown"
        : "ArrowUp"
      : key;
  switch (towards) {
    case "ArrowUp": {
      const parent = parentsOf(doc, node.personId)[0];
      return parent === undefined ? null : (layout.primaryNode[parent] ?? null);
    }
    case "ArrowDown": {
      for (const child of childrenOf(doc, node.personId)) {
        const childNode = layout.primaryNode[child];
        if (childNode !== undefined) return childNode;
      }
      return null;
    }
    case "ArrowLeft":
    case "ArrowRight": {
      const toRight = (key === "ArrowRight") === (dir === "ltr");
      return nearestInRow(layout.nodes, node, toRight)?.nodeId ?? null;
    }
  }
}

function nearestInRow(nodes: LayoutNode[], from: LayoutNode, toRight: boolean): LayoutNode | null {
  let best: LayoutNode | null = null;
  for (const n of nodes) {
    if (n.nodeId === from.nodeId || n.y !== from.y) continue;
    const delta = toRight ? n.x - from.x : from.x - n.x;
    if (delta <= 0) continue;
    if (best === null || delta < (toRight ? best.x - from.x : from.x - best.x)) best = n;
  }
  return best;
}
