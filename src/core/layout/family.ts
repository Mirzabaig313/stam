import type { TreeDocument } from "@/core/model/types";

import { buildBlockTree } from "./blocks";
import { CARD_H, CARD_W, COUPLE_GAP, GAP, ROW_H } from "./constants";
import {
  clearLeft,
  clearRight,
  type Contour,
  leafContour,
  mergeAt,
  packSubtrees,
  shifted,
  stackUnder,
} from "./contour";
import { barOffset, bracketRise, bracketStart, childEdge, unionBracket, unionLine } from "./edges";
import type { Block, LayoutEdge, LayoutNode, LayoutResult } from "./types";

const NONE: ReadonlySet<string> = new Set();
const STEP = CARD_W + COUPLE_GAP;
/** Minimum distance between one union's outermost child line and a neighbouring union's drop. */
const LINE_CLEARANCE = 16;

const blockWidth = (block: Block) => block.members.length * STEP - COUPLE_GAP;
const bloodIndex = (block: Block) => block.members.findIndex((m) => m.nodeId === block.bloodNodeId);

/** How one union of a block is drawn, relative to the block's left edge and row top. */
type UnionShape = {
  /** Where its child lines start. */
  anchor: [number, number];
  line?: { leftX: number; rightX: number };
  bracket?: { fromX: number; spouseX: number; rise: number };
};

/**
 * Union `[a, b]` of the blood person at `self`: a mid-height line across the gap; for a third or
 * later spouse a bracket (children drop from the bracket, through the gap left of the spouse);
 * single-parent unions spread their anchors along the bottom of the blood person's card.
 */
function unionShapes(block: Block): UnionShape[] {
  const self = bloodIndex(block);
  const soloCount = block.unions.filter((u) => u.anchorBetween[0] === u.anchorBetween[1]).length;
  const bracketCount = block.unions.filter(
    ({ anchorBetween: [a, b] }) => a !== b && a !== self && b !== self,
  ).length;
  let solo = 0;
  let bracket = 0;
  return block.unions.map(({ anchorBetween: [a, b] }): UnionShape => {
    if (a === b) {
      const x = self * STEP + (CARD_W * ++solo) / (soloCount + 1);
      return { anchor: [x, CARD_H] };
    }
    const gapX = (a * STEP + CARD_W + b * STEP) / 2;
    if (a === self || b === self) {
      return { anchor: [gapX, CARD_H / 2], line: { leftX: a * STEP, rightX: b * STEP } };
    }
    const rise = bracketRise(bracket, bracketCount);
    const fromX = self * STEP + bracketStart(bracket++, bracketCount);
    return { anchor: [gapX, -rise], bracket: { fromX, spouseX: b * STEP, rise } };
  });
}

/** One union's children, packed together. Offsets are relative to the group's own origin. */
type Group = {
  union: number;
  kids: number[];
  offsets: number[];
  contour: Contour;
  anchorX: number;
  /** Midpoint of the first and last child blocks. */
  centre: number;
  /** x of the first and last child lines. */
  firstLine: number;
  lastLine: number;
};

/**
 * The family view: blood relatives below `rootId` on generation rows, partners beside them,
 * each union's children grouped under that union and neighbouring branches packed by contour.
 * Pure and deterministic. A root that is not in the document gives an empty layout.
 */
export function layoutFamily(
  doc: TreeDocument,
  opts: { rootId: string; collapsed?: ReadonlySet<string> },
): LayoutResult {
  if (!Object.hasOwn(doc.persons, opts.rootId)) {
    return {
      nodes: [],
      edges: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      generationCount: 0,
      primaryNode: {},
      unreachable: Object.keys(doc.persons),
    };
  }
  const tree = buildBlockTree(doc, opts.rootId, opts.collapsed ?? NONE);

  // Blocks in pre-order, so every parent comes before its children.
  const blocks: Block[] = [];
  const parentOf: number[] = [];
  /** Per block, per union: child block indexes. */
  const kidsOf: number[][][] = [];
  const stack: [Block, number, number][] = [[tree.root, -1, -1]];
  while (stack.length > 0) {
    const [block, parent, union] = stack.pop()!;
    const index = blocks.length;
    blocks.push(block);
    parentOf.push(parent);
    kidsOf.push(block.unions.map(() => []));
    if (parent >= 0) kidsOf[parent]![union]!.push(index);
    for (let u = block.unions.length - 1; u >= 0; u--) {
      const children = block.unions[u]!.children;
      for (let c = children.length - 1; c >= 0; c--) stack.push([children[c]!, index, u]);
    }
  }

  // Bottom-up: place each union's children under that union, then the block on top.
  const shapes = blocks.map(unionShapes);
  const contours: Contour[] = Array.from({ length: blocks.length });
  const offsetOf: number[] = Array.from({ length: blocks.length }, () => 0);
  const barOf: number[][] = blocks.map((b) => b.unions.map(() => 0));
  for (let i = blocks.length - 1; i >= 0; i--) {
    const groups = groupsOf(kidsOf[i]!, shapes[i]!, blocks, contours);
    const placed = placeGroups(groups);
    groups.forEach((group, g) => {
      group.kids.forEach((k, j) => (offsetOf[k] = placed.x[g]! + group.offsets[j]!));
      barOf[i]![group.union] = barOffset(Math.abs(g - placed.pivot), placed.levels);
    });
    const width = blockWidth(blocks[i]!);
    contours[i] = placed.contour ? stackUnder(width, placed.contour, 0) : leafContour(width);
  }

  // Top-down: absolute left edges.
  const lefts: number[] = Array.from({ length: blocks.length }, () => 0);
  let minLeft = 0;
  for (let i = 1; i < blocks.length; i++) {
    lefts[i] = lefts[parentOf[i]!]! + offsetOf[i]!;
    minLeft = Math.min(minLeft, lefts[i]!);
  }
  const memberX = (i: number, m: number) => lefts[i]! - minLeft + m * STEP;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let maxDepth = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const rowTop = block.depth * ROW_H;
    const left = memberX(i, 0);
    maxDepth = Math.max(maxDepth, block.depth);
    block.members.forEach((member, m) => {
      nodes.push({
        nodeId: member.nodeId,
        personId: member.personId,
        kind: member.kind,
        x: memberX(i, m),
        y: rowTop,
        generation: block.depth,
        hiddenCount: member.nodeId === block.bloodNodeId ? block.hiddenCount : 0,
      });
    });

    block.unions.forEach((entry, u) => {
      const union = doc.unions[entry.unionId]!;
      const { anchor, line, bracket } = shapes[i]![u]!;
      if (line) {
        edges.push(
          unionLine(union.id, union.status, rowTop, left + line.leftX, left + line.rightX),
        );
      } else if (bracket) {
        const { fromX, spouseX, rise } = bracket;
        edges.push(
          unionBracket(union.id, union.status, rowTop, left + fromX, left + spouseX, rise),
        );
      }
      const start: [number, number] = [left + anchor[0], rowTop + anchor[1]];
      const barY = rowTop + barOf[i]![u]!;
      kidsOf[i]![u]!.forEach((k, c) => {
        const child = blocks[k]!;
        edges.push(
          childEdge(
            union.id,
            union.children[c]!.type,
            start,
            barY,
            child.bloodNodeId,
            memberX(k, bloodIndex(child)),
            child.depth * ROW_H,
          ),
        );
      });
    });
  }

  return {
    nodes,
    edges,
    bounds: boundsOf(nodes, edges),
    generationCount: maxDepth + 1,
    primaryNode: tree.primaryNode,
    unreachable: tree.unreachable,
  };
}

/** Packs each union's children into a group, ordered left to right by the union's anchor. */
function groupsOf(
  kidsByUnion: number[][],
  shapes: UnionShape[],
  blocks: Block[],
  contours: Contour[],
): Group[] {
  const groups: Group[] = [];
  kidsByUnion.forEach((kids, union) => {
    if (kids.length === 0) return;
    const { offsets, merged } = packSubtrees(
      kids.map((k) => contours[k]!),
      GAP,
    );
    const first = blocks[kids[0]!]!;
    const last = blocks[kids.at(-1)!]!;
    const lastOffset = offsets.at(-1)!;
    groups.push({
      union,
      kids,
      offsets,
      contour: merged,
      anchorX: shapes[union]!.anchor[0],
      centre: (blockWidth(first) / 2 + lastOffset + blockWidth(last) / 2) / 2,
      firstLine: bloodIndex(first) * STEP + CARD_W / 2,
      lastLine: lastOffset + bloodIndex(last) * STEP + CARD_W / 2,
    });
  });
  return groups.toSorted((a, b) => a.anchorX - b.anchorX);
}

/**
 * R12. The widest group (the pivot) is centred under its anchor. Groups to its right are placed
 * in order, each as close under its anchor as the groups already placed allow, and pushed right
 * until its first child line clears the previous union's anchor; groups to its left mirror
 * that. Bars sit lowest at the pivot and step up outwards. Together these keep every union's
 * drop, bar and child lines off every other union's (see the R12 notes in the report).
 *
 * Returns each group's x offset from the block's left edge, the pivot, the number of bar levels
 * and the children's merged contour.
 */
function placeGroups(groups: Group[]): {
  x: number[];
  pivot: number;
  levels: number;
  contour: Contour | undefined;
} {
  if (groups.length === 0) return { x: [], pivot: 0, levels: 0, contour: undefined };
  const widthOf = (g: Group) => g.contour.max[0]! - g.contour.min[0]!;
  let pivot = 0;
  groups.forEach((g, k) => {
    if (widthOf(g) > widthOf(groups[pivot]!)) pivot = k;
  });

  const x: number[] = Array.from({ length: groups.length }, () => 0);
  const p = groups[pivot]!;
  x[pivot] = p.anchorX - p.centre;
  const placed = shifted(p.contour, x[pivot]!);

  for (let g = pivot + 1; g < groups.length; g++) {
    const group = groups[g]!;
    x[g] = Math.max(
      group.anchorX - group.centre,
      groups[g - 1]!.anchorX + LINE_CLEARANCE - group.firstLine,
      clearRight(placed, group.contour, GAP),
    );
    mergeAt(placed, group.contour, x[g]!);
  }
  for (let g = pivot - 1; g >= 0; g--) {
    const group = groups[g]!;
    x[g] = Math.min(
      group.anchorX - group.centre,
      groups[g + 1]!.anchorX - LINE_CLEARANCE - group.lastLine,
      clearLeft(placed, group.contour, GAP),
    );
    mergeAt(placed, group.contour, x[g]!);
  }

  const levels = Math.max(pivot, groups.length - 1 - pivot) + 1;
  return { x, pivot, levels, contour: placed };
}

function boundsOf(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutResult["bounds"] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + CARD_W);
    maxY = Math.max(maxY, node.y + CARD_H);
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
