import { nodeHeight, nodeWidth } from "@/core/layout/result";
import type { Block, LayoutEdge, LayoutResult } from "@/core/layout/types";

// Geometry checks shared by the unit and property tests. Each throws an Error naming what broke.

/** An axis-aligned segment as its bounding box. */
type Segment = { x1: number; x2: number; y1: number; y2: number; edge: LayoutEdge };

function segmentsOf(edges: readonly LayoutEdge[]): Segment[] {
  const out: Segment[] = [];
  for (const edge of edges) {
    for (let i = 1; i < edge.points.length; i++) {
      const [ax, ay] = edge.points[i - 1]!;
      const [bx, by] = edge.points[i]!;
      if (ax !== bx && ay !== by) throw new Error(`${edge.id} has a diagonal segment`);
      out.push({
        x1: Math.min(ax, bx),
        x2: Math.max(ax, bx),
        y1: Math.min(ay, by),
        y2: Math.max(ay, by),
        edge,
      });
    }
  }
  return out.toSorted((a, b) => a.x1 - b.x1);
}

/**
 * Sweeps axis-aligned segments left to right. Two such segments meet exactly when their
 * bounding boxes do (touching counts), so `conflict` sees every meeting pair once.
 */
function sweep(segments: Segment[], conflict: (a: Segment, b: Segment) => boolean): void {
  let active: Segment[] = [];
  for (const s of segments) {
    active = active.filter((a) => a.x2 >= s.x1);
    for (const a of active) {
      if (a.y1 <= s.y2 && s.y1 <= a.y2 && conflict(a, s)) {
        throw new Error(`${a.edge.id} meets ${s.edge.id} near (${s.x1}, ${s.y1})`);
      }
    }
    active.push(s);
  }
}

/**
 * R12: no child edge meets a child edge of another union. `groupOf` says which edges may share
 * lines (by default, those of one union).
 */
export function expectNoCrossingChildEdges(
  layout: LayoutResult,
  groupOf: (edge: LayoutEdge) => string = (e) => e.unionId,
): void {
  const childEdges = layout.edges.filter((e) => e.kind === "child");
  sweep(segmentsOf(childEdges), (a, b) => groupOf(a.edge) !== groupOf(b.edge));
}

/** Over-brackets (union edges with more than two points) never meet each other. */
export function expectNoOverlappingBrackets(layout: LayoutResult): void {
  const brackets = layout.edges.filter((e) => e.kind === "union" && e.points.length > 2);
  sweep(segmentsOf(brackets), (a, b) => a.edge !== b.edge);
}

/** Sibling bars stay in the band between the parent row's cards and the child row. */
export function expectBarsBetweenRows(layout: LayoutResult): void {
  for (const edge of layout.edges) {
    if (edge.kind !== "child") continue;
    const barY = edge.points[1]![1];
    const childTop = edge.points.at(-1)![1];
    // The bar sits in the gap above the child's row: below every card of the row above.
    const above = Math.max(...layout.nodes.filter((n) => n.y < childTop).map((n) => n.y));
    const parentBottom = Math.max(
      ...layout.nodes.filter((n) => n.y === above).map((n) => n.y + nodeHeight(n, layout.metrics)),
    );
    if (barY < parentBottom + 12 || barY > childTop - 12) {
      throw new Error(`${edge.id} bar at ${barY} is outside its row band`);
    }
  }
}

/**
 * Each union's children are grouped under that union's own anchor. One group per block (the
 * pivot) is centred exactly under its anchor; the groups before it may only be pushed left of
 * their anchors and the groups after it only right.
 */
export function expectGroupsUnderAnchors(root: Block, layout: LayoutResult): void {
  const xOf = new Map(layout.nodes.map((n) => [n.nodeId, n.x]));
  const widthOf = new Map(layout.nodes.map((n) => [n.nodeId, nodeWidth(n, layout.metrics)]));
  const anchorOf = new Map<string, number>();
  for (const edge of layout.edges) {
    if (edge.kind === "child") anchorOf.set(edge.unionId, edge.points[0]![0]);
  }
  const centre = (block: Block) =>
    (xOf.get(block.members[0]!.nodeId)! +
      xOf.get(block.members.at(-1)!.nodeId)! +
      widthOf.get(block.members.at(-1)!.nodeId)!) /
    2;

  const stack = [root];
  while (stack.length > 0) {
    const block = stack.pop()!;
    const groups = block.unions
      .filter((u) => u.children.length > 0)
      .map((u) => ({
        unionId: u.unionId,
        anchor: anchorOf.get(u.unionId)!,
        centre: (centre(u.children[0]!) + centre(u.children.at(-1)!)) / 2,
      }))
      .toSorted((a, b) => a.anchor - b.anchor);
    for (const u of block.unions) stack.push(...u.children);
    if (groups.length === 0) continue;

    const ok = groups.some(
      (pivot, k) =>
        Math.abs(pivot.centre - pivot.anchor) <= 0.5 &&
        groups.every((g, j) =>
          j < k ? g.centre <= g.anchor + 0.5 : j > k ? g.centre >= g.anchor - 0.5 : true,
        ),
    );
    if (!ok) {
      const detail = groups.map((g) => `${g.unionId}: centre ${g.centre} anchor ${g.anchor}`);
      throw new Error(`${block.bloodNodeId}'s groups are not under their anchors: ${detail}`);
    }
  }
}
