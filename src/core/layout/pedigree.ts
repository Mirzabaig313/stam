import type { TreeDocument, Union } from "@/core/model/types";

import { ancestorSet, parentSlots, viewParentUnions } from "./ancestry";
import { type CardMetrics, DEFAULT_METRICS, type SizeOf, sizerFor } from "./constants";
import { type Contour, leafContour, packSubtrees, stackUnder } from "./contour";
import { barOffset, childEdge, unionLine } from "./edges";
import { boundsOf, emptyLayout, notIn } from "./result";
import type { BlockMember, LayoutEdge, LayoutNode, LayoutResult } from "./types";

const NONE: ReadonlySet<string> = new Set();

/**
 * One row's couple: the parents of the card below (`below`, `belowMember`), father left. The
 * focus is a block of its own with no union.
 */
type ParentBlock = {
  members: BlockMember[];
  /** 0 for the focus, −k k generations up. */
  generation: number;
  union?: Union;
  /** How the card below is linked to `union`: adoptive parents are drawn on a dotted line. */
  childType?: "biological" | "adopted";
  /** `union:<id>`, or `union:<id>~n` for the n-th drawing of the same union (collapse). */
  unionEdgeId?: string;
  below: number;
  belowMember: number;
  /** Per member: the block of their parents, or −1. */
  up: number[];
  /** Per member: "+N" badge for a collapsed person. */
  hidden: number[];
};

/**
 * The pedigree view: the focus on the bottom row and, recursively, each person's two
 * biological parents (adoptive ones when there are none) as a couple on the row above (father
 * left). Ancestors reached a second
 * time (pedigree collapse) are `linked` leaves; their union is drawn again with a suffixed edge
 * id. Collapsing a person hides their ancestors.
 *
 * Packing mirrors the family view upside down: the parent couples of a block's two members are
 * packed side by side by contour, and the block centres under the midpoint of their anchors (or
 * straight under the only one). Pure, deterministic and iterative.
 */
export function layoutPedigree(
  doc: TreeDocument,
  opts: {
    focusId: string;
    collapsed?: ReadonlySet<string>;
    metrics?: CardMetrics;
    sizes?: SizeOf;
  },
): LayoutResult {
  const { focusId } = opts;
  const m = opts.metrics ?? DEFAULT_METRICS;
  const size = sizerFor(m, opts.sizes);
  const w = (member: BlockMember) => size(member.personId).w;
  const h = (member: BlockMember) => size(member.personId).h;
  /** A member's left edge in its block: the father's card, then the couple gap. */
  const offsetIn = (block: ParentBlock, k: number) =>
    k === 0 ? 0 : w(block.members[0]!) + m.coupleGap;
  const widthOf = (block: ParentBlock) =>
    offsetIn(block, block.members.length - 1) + w(block.members.at(-1)!);
  /** Where the child line leaves the block: the couple's gap, or a lone card's centre. */
  const anchorOf = (block: ParentBlock) =>
    block.members.length === 2 ? w(block.members[0]!) + m.coupleGap / 2 : w(block.members[0]!) / 2;
  if (!Object.hasOwn(doc.persons, focusId)) return emptyLayout(doc, m);
  const collapsed = opts.collapsed ?? NONE;
  const parents = viewParentUnions(doc);

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

  // Blocks in creation order: every block comes after the block below it.
  const blocks: ParentBlock[] = [
    {
      members: [place(focusId)],
      generation: 0,
      below: -1,
      belowMember: -1,
      up: [-1],
      hidden: [0],
    },
  ];
  const drawn = new Map<string, number>();
  const hiddenAt: [number, number][] = [];
  const stack: [number, number][] = [[0, 0]];
  while (stack.length > 0) {
    const [b, m] = stack.pop()!;
    const block = blocks[b]!;
    const member = block.members[m]!;
    if (member.kind === "linked") continue;
    const link = parents.get(member.personId);
    if (!link) continue;
    const { union } = link;
    if (collapsed.has(member.personId)) {
      hiddenAt.push([b, m]);
      continue;
    }
    const times = (drawn.get(union.id) ?? 0) + 1;
    drawn.set(union.id, times);
    const members = parentSlots(doc, union)
      .filter((id) => id !== undefined)
      .map(place);
    block.up[m] = blocks.length;
    blocks.push({
      members,
      generation: block.generation - 1,
      union,
      childType: link.childType,
      unionEdgeId: times === 1 ? `union:${union.id}` : `union:${union.id}~${times}`,
      below: b,
      belowMember: m,
      up: members.map(() => -1),
      hidden: members.map(() => 0),
    });
    // Father's side first.
    for (let j = members.length - 1; j >= 0; j--) stack.push([blocks.length - 1, j]);
  }

  for (const [b, m] of hiddenAt) {
    const block = blocks[b]!;
    let count = 0;
    for (const id of ancestorSet(block.members[m]!.personId, parents)) {
      if (!primary.has(id)) count++;
    }
    block.hidden[m] = count;
  }

  // Upward packing, from the top rows down: offsets are relative to the block below.
  const contours: Contour[] = Array.from({ length: blocks.length });
  const offsetOf: number[] = Array.from({ length: blocks.length }, () => 0);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    const subs: [number, number][] = [];
    block.up.forEach((u, m) => {
      if (u >= 0) subs.push([u, m]);
    });
    if (subs.length === 0) {
      contours[i] = leafContour(widthOf(block));
      continue;
    }
    const { offsets, merged } = packSubtrees(
      subs.map(([u]) => contours[u]!),
      m.gap,
    );
    const anchors = subs.map(([u], j) => offsets[j]! + anchorOf(blocks[u]!));
    const dx =
      subs.length === 2
        ? anchorOf(block) - (anchors[0]! + anchors[1]!) / 2
        : offsetIn(block, subs[0]![1]) + w(block.members[subs[0]![1]]!) / 2 - anchors[0]!;
    subs.forEach(([u], j) => (offsetOf[u] = dx + offsets[j]!));
    contours[i] = stackUnder(widthOf(block), merged, dx);
  }

  const lefts: number[] = Array.from({ length: blocks.length }, () => 0);
  let minLeft = 0;
  let minGeneration = 0;
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]!;
    lefts[i] = lefts[block.below]! + offsetOf[i]!;
    minLeft = Math.min(minLeft, lefts[i]!);
    minGeneration = Math.min(minGeneration, block.generation);
  }

  // Rows, eldest first: each as tall as its tallest card, the template's row gap between them.
  const rowGap = m.rowH - m.cardH;
  const rowHeight: number[] = [];
  for (const block of blocks) {
    const r = block.generation - minGeneration;
    rowHeight[r] = Math.max(rowHeight[r] ?? 0, ...block.members.map(h));
  }
  const rowTop: number[] = [0];
  for (let r = 1; r < rowHeight.length; r++)
    rowTop[r] = rowTop[r - 1]! + rowHeight[r - 1]! + rowGap;
  const sized = opts.sizes !== undefined;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const left = lefts[i]! - minLeft;
    const row = block.generation - minGeneration;
    const top = rowTop[row]!;
    block.members.forEach((member, k) => {
      nodes.push({
        nodeId: member.nodeId,
        personId: member.personId,
        kind: member.kind,
        x: left + offsetIn(block, k),
        y: top,
        generation: block.generation,
        hiddenCount: block.hidden[k]!,
        ...(sized ? { width: w(member), height: h(member) } : {}),
      });
    });
    const union = block.union;
    if (!union) continue;
    const [father, mother] = block.members;
    const lineY = mother ? (m.unionY ?? Math.min(h(father!), h(mother)) / 2) : h(father!);
    if (mother) {
      edges.push({
        ...unionLine(union.id, union.status, top, left, left + offsetIn(block, 1), {
          ...m,
          cardW: w(father!),
          unionY: lineY,
        }),
        id: block.unionEdgeId!,
      });
    }
    const anchor: [number, number] = [left + anchorOf(block), top + lineY];
    const below = blocks[block.below]!;
    const child = below.members[block.belowMember]!;
    edges.push(
      childEdge(
        union.id,
        block.childType ?? "biological",
        anchor,
        top + barOffset(0, 1, { ...m, cardH: rowHeight[row]!, rowH: rowHeight[row]! + rowGap }),
        child.nodeId,
        lefts[block.below]! - minLeft + offsetIn(below, block.belowMember),
        rowTop[row + 1]!,
        { ...m, cardW: w(child) },
      ),
    );
  }

  const primaryNode: Record<string, string> = {};
  for (const personId of primary) primaryNode[personId] = personId;
  return {
    nodes,
    edges,
    bounds: boundsOf(nodes, edges, m),
    generationCount: 1 - minGeneration,
    primaryNode,
    unreachable: notIn(doc, ancestorSet(focusId, parents)),
    metrics: m,
  };
}
