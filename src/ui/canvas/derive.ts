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

/**
 * The edges a relationship path runs along: a union line when two neighbours on the path are
 * partners, a child line when one is the child and the other is a partner of its union.
 */
export function pathEdgeIds(
  edges: readonly LayoutEdge[],
  nodes: readonly LayoutNode[],
  doc: TreeDocument,
  path: readonly string[],
): Set<string> {
  const steps = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    steps.add(`${path[i - 1]}|${path[i]}`);
    steps.add(`${path[i]}|${path[i - 1]}`);
  }
  const ids = new Set<string>();
  if (steps.size === 0) return ids;
  const personOfNode = new Map(nodes.map((n) => [n.nodeId, n.personId]));
  for (const edge of edges) {
    const partners = doc.unions[edge.unionId]?.partners ?? [];
    if (edge.kind === "union") {
      const [a, b] = partners;
      if (b !== undefined && steps.has(`${a}|${b}`)) ids.add(edge.id);
      continue;
    }
    const child = personOfNode.get(edge.id.slice(`child:${edge.unionId}:`.length));
    if (child !== undefined && partners.some((p) => steps.has(`${child}|${p}`))) ids.add(edge.id);
  }
  return ids;
}

/** Flips a frame around x = 0, so the tree reads right to left. */
export function mirrorFrame(frame: Frame, cardW: number): Frame {
  return {
    // A card resized on its own flips around its own width.
    nodes: frame.nodes.map((n) => ({ ...n, x: -(n.x + (n.width ?? cardW)) })),
    edges: frame.edges.map((e) => ({
      ...e,
      points: e.points.map(([x, y]): [number, number] => [-x, y]),
    })),
  };
}
