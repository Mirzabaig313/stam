import type { TreeDocument } from "@/core/model/types";

import { type CardMetrics, DEFAULT_METRICS, type SizeOf } from "./constants";
import { layoutFamily } from "./family";
import { layoutPedigree } from "./pedigree";
import { boundsOf, emptyLayout } from "./result";
import type { LayoutEdge, LayoutNode, LayoutResult } from "./types";

/**
 * The hourglass view: the pedigree above the focus and the family view (the focus, partners and
 * descendants) below, joined at the focus card on generation 0. The two halves only share the
 * focus row, where the pedigree has nothing but the focus, so they cannot overlap.
 *
 * The family half keeps its node ids. Ancestors win over the family half: someone who is both
 * an ancestor and a partner below is primary above and a `linked` copy below. Linked copies
 * from the pedigree half are renumbered after the family half's, so every node id is unique.
 * Collapsing the focus hides both halves.
 */
export function layoutHourglass(
  doc: TreeDocument,
  opts: {
    focusId: string;
    collapsed?: ReadonlySet<string>;
    metrics?: CardMetrics;
    sizes?: SizeOf;
  },
): LayoutResult {
  const { focusId } = opts;
  const metrics = opts.metrics ?? DEFAULT_METRICS;
  if (!Object.hasOwn(doc.persons, focusId)) return emptyLayout(doc, metrics);
  const { collapsed, sizes } = opts;
  const family = layoutFamily(doc, { rootId: focusId, collapsed, metrics, sizes });
  const pedigree = layoutPedigree(doc, { focusId, collapsed, metrics, sizes });
  const familyFocus = family.nodes.find((n) => n.nodeId === focusId)!;
  const pedigreeFocus = pedigree.nodes.find((n) => n.nodeId === focusId)!;
  const dx = familyFocus.x - pedigreeFocus.x;
  const dy = familyFocus.y - pedigreeFocus.y;

  const ancestors = new Set(
    pedigree.nodes
      .filter((n) => n.kind !== "linked" && n.nodeId !== focusId)
      .map((n) => n.personId),
  );
  // Copy numbers already taken in the family half.
  const copies = new Map<string, number>();
  for (const n of family.nodes) {
    if (n.kind !== "linked") continue;
    const k = Number(n.nodeId.slice(n.personId.length + 1));
    copies.set(n.personId, Math.max(copies.get(n.personId) ?? 0, k));
  }
  const nextCopy = (personId: string) => {
    const k = (copies.get(personId) ?? 0) + 1;
    copies.set(personId, k);
    return `${personId}~${k}`;
  };

  const renamed = new Map<string, string>();
  const nodes: LayoutNode[] = [];
  for (const n of pedigree.nodes) {
    if (n.nodeId === focusId) continue;
    const nodeId = n.kind === "linked" ? nextCopy(n.personId) : n.nodeId;
    renamed.set(n.nodeId, nodeId);
    nodes.push({ ...n, nodeId, x: n.x + dx, y: n.y + dy });
  }
  for (const n of family.nodes) {
    if (n.nodeId === focusId) {
      nodes.push({ ...n, hiddenCount: n.hiddenCount + pedigreeFocus.hiddenCount });
    } else if (n.kind !== "linked" && ancestors.has(n.personId)) {
      nodes.push({ ...n, nodeId: nextCopy(n.personId), kind: "linked" });
    } else {
      nodes.push(n);
    }
  }

  const edges: LayoutEdge[] = pedigree.edges.map((e) => {
    const points = e.points.map(([x, y]): [number, number] => [x + dx, y + dy]);
    if (e.kind !== "child") return { ...e, points };
    const target = e.id.slice(`child:${e.unionId}:`.length);
    return { ...e, id: `child:${e.unionId}:${renamed.get(target) ?? target}`, points };
  });
  edges.push(...family.edges);

  // Normalize: leftmost card at x = 0, top row at y = 0.
  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
  }
  if (minX !== 0 || minY !== 0) {
    for (const n of nodes) {
      n.x -= minX;
      n.y -= minY;
    }
    for (const e of edges) e.points = e.points.map(([x, y]) => [x - minX, y - minY]);
  }

  const outsidePedigree = new Set(pedigree.unreachable);
  return {
    nodes,
    edges,
    bounds: boundsOf(nodes, edges, metrics),
    generationCount: pedigree.generationCount + family.generationCount - 1,
    primaryNode: { ...family.primaryNode, ...pedigree.primaryNode },
    unreachable: family.unreachable.filter((id) => outsidePedigree.has(id)),
    metrics,
  };
}
