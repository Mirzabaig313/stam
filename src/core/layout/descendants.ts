import type { ChildType, TreeDocument } from "@/core/model/types";

import { CARD_H, CARD_W, GAP, ROW_H } from "./constants";
import { type Contour, leafContour, packSubtrees, stackUnder } from "./contour";
import { barOffset, childEdge } from "./edges";
import { boundsOf, emptyLayout, notIn } from "./result";
import type { BlockMember, LayoutEdge, LayoutNode, LayoutResult } from "./types";

const NONE: ReadonlySet<string> = new Set();

type Card = {
  member: BlockMember;
  depth: number;
  parent: number;
  /** The union that holds this child, and the link type, for the child edge. */
  unionId: string;
  childType: ChildType;
  kids: number[];
  hiddenCount: number;
};

/**
 * The descendants-only view: the root and their descendants through every union and child
 * link, one card each, no partners. Children of all a person's unions are packed together under
 * them and every child line starts at the parent's bottom centre. A person reached a second
 * time (a child of two descendants) is a `linked` leaf. Pure, deterministic and iterative.
 */
export function layoutDescendants(
  doc: TreeDocument,
  opts: { rootId: string; collapsed?: ReadonlySet<string> },
): LayoutResult {
  const { rootId } = opts;
  if (!Object.hasOwn(doc.persons, rootId)) return emptyLayout(doc);
  const collapsed = opts.collapsed ?? NONE;

  const primary = new Set<string>();
  const copies = new Map<string, number>();
  const place = (personId: string): BlockMember => {
    if (!primary.has(personId)) {
      primary.add(personId);
      return { nodeId: personId, personId, kind: "blood" };
    }
    const n = (copies.get(personId) ?? 0) + 1;
    copies.set(personId, n);
    return { nodeId: `${personId}~${n}`, personId, kind: "linked" };
  };

  type Visit = {
    personId: string;
    depth: number;
    parent: number;
    unionId: string;
    type: ChildType;
  };
  // Pre-order, so every parent comes before its children.
  const cards: Card[] = [];
  const hiddenIn: number[] = [];
  const stack: Visit[] = [
    { personId: rootId, depth: 0, parent: -1, unionId: "", type: "biological" },
  ];
  while (stack.length > 0) {
    const visit = stack.pop()!;
    const index = cards.length;
    const member = place(visit.personId);
    cards.push({
      member,
      depth: visit.depth,
      parent: visit.parent,
      unionId: visit.unionId,
      childType: visit.type,
      kids: [],
      hiddenCount: 0,
    });
    if (visit.parent >= 0) cards[visit.parent]!.kids.push(index);
    if (member.kind === "linked") continue;
    if (collapsed.has(visit.personId)) {
      hiddenIn.push(index);
      continue;
    }
    const unionIds = doc.unionOrder[visit.personId] ?? [];
    for (let u = unionIds.length - 1; u >= 0; u--) {
      const union = doc.unions[unionIds[u]!];
      if (!union) continue;
      for (let c = union.children.length - 1; c >= 0; c--) {
        const { personId, type } = union.children[c]!;
        stack.push({ personId, depth: visit.depth + 1, parent: index, unionId: union.id, type });
      }
    }
  }
  for (const index of hiddenIn) {
    const card = cards[index]!;
    for (const id of descendantSet(doc, card.member.personId)) {
      if (!primary.has(id)) card.hiddenCount++;
    }
  }

  // Bottom-up: each parent centred over its first and last child.
  const contours: Contour[] = Array.from({ length: cards.length });
  const offsetOf: number[] = Array.from({ length: cards.length }, () => 0);
  for (let i = cards.length - 1; i >= 0; i--) {
    const { kids } = cards[i]!;
    if (kids.length === 0) {
      contours[i] = leafContour(CARD_W);
      continue;
    }
    const { offsets, merged } = packSubtrees(
      kids.map((k) => contours[k]!),
      GAP,
    );
    const dx = -(offsets[0]! + offsets.at(-1)!) / 2;
    kids.forEach((k, j) => (offsetOf[k] = dx + offsets[j]!));
    contours[i] = stackUnder(CARD_W, merged, dx);
  }

  const xs: number[] = Array.from({ length: cards.length }, () => 0);
  let minX = 0;
  let maxDepth = 0;
  for (let i = 1; i < cards.length; i++) {
    xs[i] = xs[cards[i]!.parent]! + offsetOf[i]!;
    minX = Math.min(minX, xs[i]!);
  }

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    const x = xs[i]! - minX;
    const y = card.depth * ROW_H;
    maxDepth = Math.max(maxDepth, card.depth);
    nodes.push({
      nodeId: card.member.nodeId,
      personId: card.member.personId,
      kind: card.member.kind,
      x,
      y,
      generation: card.depth,
      hiddenCount: card.hiddenCount,
    });
    if (card.parent < 0) continue;
    const parentX = xs[card.parent]! - minX;
    const parentTop = y - ROW_H;
    edges.push(
      childEdge(
        card.unionId,
        card.childType,
        [parentX + CARD_W / 2, parentTop + CARD_H],
        parentTop + barOffset(0, 1),
        card.member.nodeId,
        x,
        y,
      ),
    );
  }

  const primaryNode: Record<string, string> = {};
  for (const personId of primary) primaryNode[personId] = personId;
  return {
    nodes,
    edges,
    bounds: boundsOf(nodes, edges),
    generationCount: maxDepth + 1,
    primaryNode,
    unreachable: notIn(doc, descendantSet(doc, rootId)),
  };
}

/** The person and everyone below them, through every union and child link. */
function descendantSet(doc: TreeDocument, personId: string): Set<string> {
  const seen = new Set([personId]);
  const stack = [personId];
  while (stack.length > 0) {
    for (const unionId of doc.unionOrder[stack.pop()!] ?? []) {
      for (const { personId: child } of doc.unions[unionId]?.children ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}
