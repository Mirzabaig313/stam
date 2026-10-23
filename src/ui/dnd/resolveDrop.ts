import { type DropAction, validDropActions } from "@/core/commands/validActions";
import { CARD_H, CARD_W, GAP } from "@/core/layout/constants";
import type { LayoutNode, LayoutResult } from "@/core/layout/types";
import { parentUnionOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

export type DropTarget =
  | { kind: "none" }
  | { kind: "reorder"; unionId: string; toIndex: number; indicatorX: number; rowY: number }
  | { kind: "person"; personId: string; actions: DropAction[] };

const centreX = (n: LayoutNode): number => n.x + CARD_W / 2;

function inCard(n: LayoutNode, [px, py]: [number, number]): boolean {
  return px >= n.x && px < n.x + CARD_W && py >= n.y && py < n.y + CARD_H;
}

/**
 * What a drag of `draggedPersonId` currently points at, with the pointer in world coordinates.
 * A card other than the dragged person's own (or its linked copy) is a person target; an empty
 * action list there means "not allowed". Otherwise, inside the dragged person's row and between
 * the first and last of their siblings (or within one GAP outside them), it is a reorder;
 * anywhere else, none.
 */
export function resolveDrop(
  layout: LayoutResult,
  doc: TreeDocument,
  draggedPersonId: string,
  pointer: [number, number],
): DropTarget {
  const hit = layout.nodes.find((n) => n.personId !== draggedPersonId && inCard(n, pointer));
  if (hit) {
    return {
      kind: "person",
      personId: hit.personId,
      actions: validDropActions(doc, draggedPersonId, hit.personId),
    };
  }
  return resolveReorder(layout, doc, draggedPersonId, pointer);
}

function resolveReorder(
  layout: LayoutResult,
  doc: TreeDocument,
  draggedPersonId: string,
  [px, py]: [number, number],
): DropTarget {
  const none: DropTarget = { kind: "none" };
  const union = parentUnionOf(doc, draggedPersonId);
  const draggedNodeId = layout.primaryNode[draggedPersonId];
  const dragged = layout.nodes.find((n) => n.nodeId === draggedNodeId);
  if (!union || !dragged) return none;
  if (py < dragged.y || py > dragged.y + CARD_H) return none;

  const byId = new Map(layout.nodes.map((n) => [n.nodeId, n]));
  const siblings: LayoutNode[] = [];
  for (const child of union.children) {
    const node = byId.get(layout.primaryNode[child.personId] ?? "");
    if (node) siblings.push(node);
  }
  // The zone reaches one GAP past the outermost cards, so the front and the end are droppable.
  const span = siblings.length > 0 ? siblings : [dragged];
  const left = Math.min(...span.map((n) => n.x)) - GAP;
  const right = Math.max(...span.map((n) => n.x + CARD_W)) + GAP;
  if (px < left || px > right) return none;

  const others = siblings
    .filter((n) => n.personId !== draggedPersonId)
    .toSorted((a, b) => a.x - b.x);
  const toIndex = others.filter((n) => centreX(n) < px).length;

  // The line sits mid-gap between its neighbours, or half a GAP outside the outermost card.
  const before = others[toIndex - 1];
  const after = others[toIndex];
  let indicatorX = centreX(dragged);
  if (before && after) indicatorX = (before.x + CARD_W + after.x) / 2;
  else if (after) indicatorX = after.x - GAP / 2;
  else if (before) indicatorX = before.x + CARD_W + GAP / 2;

  return { kind: "reorder", unionId: union.id, toIndex, indicatorX, rowY: dragged.y };
}
