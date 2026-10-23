import { CARD_W } from "@/core/layout/constants";
import type { LayoutEdge, LayoutNode } from "@/core/layout/types";
import { descendantsOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import type { Frame } from "./useLayoutTween";

/** The person, all their ancestors and all their descendants, through any kind of child link. */
export function focusSet(doc: TreeDocument, personId: string): Set<string> {
  const parentUnions = new Map<string, string[]>();
  for (const union of Object.values(doc.unions)) {
    for (const child of union.children) {
      const list = parentUnions.get(child.personId);
      if (list) list.push(union.id);
      else parentUnions.set(child.personId, [union.id]);
    }
  }
  const result = descendantsOf(doc, personId);
  result.add(personId);
  const stack = [personId];
  const seen = new Set(stack);
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const unionId of parentUnions.get(current) ?? []) {
      for (const parent of doc.unions[unionId]?.partners ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        result.add(parent);
        stack.push(parent);
      }
    }
  }
  return result;
}

/**
 * Edges to dim in focus mode: a union line stays when both partners are in focus, a child line
 * when the child and at least one partner of the union are.
 */
export function dimmedEdgeIds(
  edges: readonly LayoutEdge[],
  nodes: readonly LayoutNode[],
  doc: TreeDocument,
  focus: ReadonlySet<string>,
): Set<string> {
  const personOfNode = new Map(nodes.map((n) => [n.nodeId, n.personId]));
  const dimmed = new Set<string>();
  for (const edge of edges) {
    const partners = doc.unions[edge.unionId]?.partners ?? [];
    let keep: boolean;
    if (edge.kind === "union") {
      keep = partners.every((p) => focus.has(p));
    } else {
      const childNode = edge.id.slice(`child:${edge.unionId}:`.length);
      const child = personOfNode.get(childNode);
      keep = child !== undefined && focus.has(child) && partners.some((p) => focus.has(p));
    }
    if (!keep) dimmed.add(edge.id);
  }
  return dimmed;
}

/** Flips a frame around x = 0, so the tree reads right to left. */
export function mirrorFrame(frame: Frame): Frame {
  return {
    nodes: frame.nodes.map((n) => ({ ...n, x: -(n.x + CARD_W) })),
    edges: frame.edges.map((e) => ({
      ...e,
      points: e.points.map(([x, y]): [number, number] => [-x, y]),
    })),
  };
}
