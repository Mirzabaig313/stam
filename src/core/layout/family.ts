import type { TreeDocument } from "@/core/model/types";

import { buildBlockTree } from "./blocks";
import { type CardMetrics, DEFAULT_METRICS, type SizeOf, sizerFor } from "./constants";
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
import { boundsOf, emptyLayout } from "./result";
import type { Block, LayoutEdge, LayoutNode, LayoutResult } from "./types";

const NONE: ReadonlySet<string> = new Set();
/** Minimum distance between one union's outermost child line and a neighbouring union's drop. */
const LINE_CLEARANCE = 16;

const bloodIndex = (block: Block) => block.members.findIndex((m) => m.nodeId === block.bloodNodeId);

/**
 * A block's geometry: each member's width and height, and each member's left edge from the
 * block's left edge (cards `coupleGap` apart). Cards may differ in size (a card resized on its own).
 */
type BlockBox = { widths: number[]; heights: number[]; offsets: number[]; width: number };

function boxOf(block: Block, size: ReturnType<typeof sizerFor>, m: CardMetrics): BlockBox {
  const widths = block.members.map((member) => size(member.personId).w);
  const heights = block.members.map((member) => size(member.personId).h);
  const offsets: number[] = [];
  let x = 0;
  for (const w of widths) {
    offsets.push(x);
    x += w + m.coupleGap;
  }
  return { widths, heights, offsets, width: x - m.coupleGap };
}

/** How one union of a block is drawn, relative to the block's left edge and row top. */
type UnionShape = {
  /** Where its child lines start. */
  anchor: [number, number];
  line?: { leftX: number; rightX: number; leftW: number; y: number };
  bracket?: { fromX: number; spouseX: number; spouseW: number; rise: number };
};

/**
 * Union `[a, b]` of the blood person at `self`: a line across the gap at the couple line height;
 * for a third or later spouse a bracket (children drop from the bracket, through the gap left of
 * the spouse); single-parent unions spread their anchors along the bottom of the blood person's card.
 */
function unionShapes(block: Block, box: BlockBox, m: CardMetrics): UnionShape[] {
  const self = bloodIndex(block);
  const soloCount = block.unions.filter((u) => u.anchorBetween[0] === u.anchorBetween[1]).length;
  const bracketCount = block.unions.filter(
    ({ anchorBetween: [a, b] }) => a !== b && a !== self && b !== self,
  ).length;
  const { widths: w, heights: h, offsets: x } = box;
  let solo = 0;
  let bracket = 0;
  return block.unions.map(({ anchorBetween: [a, b] }): UnionShape => {
    if (a === b) {
      const at = x[self]! + (w[self]! * ++solo) / (soloCount + 1);
      return { anchor: [at, h[self]!] };
    }
    const gapX = (x[a]! + w[a]! + x[b]!) / 2;
    if (a === self || b === self) {
      // Between two cards of different heights the line keeps to the shorter one's middle.
      const y = m.unionY ?? Math.min(h[a]!, h[b]!) / 2;
      return { anchor: [gapX, y], line: { leftX: x[a]!, rightX: x[b]!, leftW: w[a]!, y } };
    }
    const rise = bracketRise(bracket, bracketCount);
    const fromX = x[self]! + bracketStart(bracket++, bracketCount, { ...m, cardW: w[self]! });
    return { anchor: [gapX, -rise], bracket: { fromX, spouseX: x[b]!, spouseW: w[b]!, rise } };
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
 * Cards take their own size from `sizes` (the template's card otherwise); each row is as tall as
 * its tallest card, and cards sit at their row's top. Pure and deterministic. A root that is not
 * in the document gives an empty layout.
 */
export function layoutFamily(
  doc: TreeDocument,
  opts: {
    rootId: string;
    collapsed?: ReadonlySet<string>;
    metrics?: CardMetrics;
    sizes?: SizeOf;
  },
): LayoutResult {
  const m = opts.metrics ?? DEFAULT_METRICS;
  const size = sizerFor(m, opts.sizes);
  if (!Object.hasOwn(doc.persons, opts.rootId)) return emptyLayout(doc, m);
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

  const boxes = blocks.map((b) => boxOf(b, size, m));
  // Rows: each as tall as its tallest card, the template's row gap between them.
  const rowGap = m.rowH - m.cardH;
  const rowHeight: number[] = [];
  blocks.forEach((b, i) => {
    rowHeight[b.depth] = Math.max(rowHeight[b.depth] ?? 0, ...boxes[i]!.heights);
  });
  const rowTop: number[] = [0];
  for (let d = 1; d < rowHeight.length; d++) {
    rowTop[d] = rowTop[d - 1]! + rowHeight[d - 1]! + rowGap;
  }
  /** The metrics a row's sibling bars are kept in: its tallest card, its distance to the next. */
  const rowMetrics = (d: number): CardMetrics => ({
    ...m,
    cardH: rowHeight[d]!,
    rowH: rowHeight[d]! + rowGap,
  });

  // Bottom-up: place each union's children under that union, then the block on top.
  const shapes = blocks.map((b, i) => unionShapes(b, boxes[i]!, m));
  const contours: Contour[] = Array.from({ length: blocks.length });
  const offsetOf: number[] = Array.from({ length: blocks.length }, () => 0);
  const barOf: number[][] = blocks.map((b) => b.unions.map(() => 0));
  for (let i = blocks.length - 1; i >= 0; i--) {
    const groups = groupsOf(kidsOf[i]!, shapes[i]!, blocks, boxes, contours, m);
    const placed = placeGroups(groups, m.gap);
    groups.forEach((group, g) => {
      group.kids.forEach((k, j) => (offsetOf[k] = placed.x[g]! + group.offsets[j]!));
      barOf[i]![group.union] = barOffset(
        Math.abs(g - placed.pivot),
        placed.levels,
        rowMetrics(blocks[i]!.depth),
      );
    });
    const width = boxes[i]!.width;
    contours[i] = placed.contour ? stackUnder(width, placed.contour, 0) : leafContour(width);
  }

  // Top-down: absolute left edges.
  const lefts: number[] = Array.from({ length: blocks.length }, () => 0);
  let minLeft = 0;
  for (let i = 1; i < blocks.length; i++) {
    lefts[i] = lefts[parentOf[i]!]! + offsetOf[i]!;
    minLeft = Math.min(minLeft, lefts[i]!);
  }
  const memberX = (i: number, k: number) => lefts[i]! - minLeft + boxes[i]!.offsets[k]!;
  const sized = opts.sizes !== undefined;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let maxDepth = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const box = boxes[i]!;
    const top = rowTop[block.depth]!;
    const left = memberX(i, 0);
    maxDepth = Math.max(maxDepth, block.depth);
    block.members.forEach((member, k) => {
      nodes.push({
        nodeId: member.nodeId,
        personId: member.personId,
        kind: member.kind,
        x: memberX(i, k),
        y: top,
        generation: block.depth,
        hiddenCount: member.nodeId === block.bloodNodeId ? block.hiddenCount : 0,
        // Only a layout with per-card sizes says so; every card is the metrics' size otherwise.
        ...(sized ? { width: box.widths[k]!, height: box.heights[k]! } : {}),
      });
    });

    block.unions.forEach((entry, u) => {
      const union = doc.unions[entry.unionId]!;
      const { anchor, line, bracket } = shapes[i]![u]!;
      if (line) {
        edges.push(
          unionLine(union.id, union.status, top, left + line.leftX, left + line.rightX, {
            ...m,
            cardW: line.leftW,
            unionY: line.y,
          }),
        );
      } else if (bracket) {
        const { fromX, spouseX, spouseW, rise } = bracket;
        edges.push(
          unionBracket(union.id, union.status, top, left + fromX, left + spouseX, rise, {
            ...m,
            cardW: spouseW,
          }),
        );
      }
      const start: [number, number] = [left + anchor[0], top + anchor[1]];
      const barY = top + barOf[i]![u]!;
      kidsOf[i]![u]!.forEach((k, c) => {
        const child = blocks[k]!;
        const blood = bloodIndex(child);
        edges.push(
          childEdge(
            union.id,
            union.children[c]!.type,
            start,
            barY,
            child.bloodNodeId,
            memberX(k, blood),
            rowTop[child.depth]!,
            { ...m, cardW: boxes[k]!.widths[blood]! },
          ),
        );
      });
    });
  }

  return {
    nodes,
    edges,
    bounds: boundsOf(nodes, edges, m),
    generationCount: maxDepth + 1,
    primaryNode: tree.primaryNode,
    unreachable: tree.unreachable,
    metrics: m,
  };
}

/** Packs each union's children into a group, ordered left to right by the union's anchor. */
function groupsOf(
  kidsByUnion: number[][],
  shapes: UnionShape[],
  blocks: Block[],
  boxes: BlockBox[],
  contours: Contour[],
  m: CardMetrics,
): Group[] {
  const groups: Group[] = [];
  const lineOf = (k: number) => {
    const blood = bloodIndex(blocks[k]!);
    return boxes[k]!.offsets[blood]! + boxes[k]!.widths[blood]! / 2;
  };
  kidsByUnion.forEach((kids, union) => {
    if (kids.length === 0) return;
    const { offsets, merged } = packSubtrees(
      kids.map((k) => contours[k]!),
      m.gap,
    );
    const first = kids[0]!;
    const last = kids.at(-1)!;
    const lastOffset = offsets.at(-1)!;
    groups.push({
      union,
      kids,
      offsets,
      contour: merged,
      anchorX: shapes[union]!.anchor[0],
      centre: (boxes[first]!.width / 2 + lastOffset + boxes[last]!.width / 2) / 2,
      firstLine: lineOf(first),
      lastLine: lastOffset + lineOf(last),
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
function placeGroups(
  groups: Group[],
  gap: number,
): {
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
      clearRight(placed, group.contour, gap),
    );
    mergeAt(placed, group.contour, x[g]!);
  }
  for (let g = pivot - 1; g >= 0; g--) {
    const group = groups[g]!;
    x[g] = Math.min(
      group.anchorX - group.centre,
      groups[g + 1]!.anchorX - LINE_CLEARANCE - group.lastLine,
      clearLeft(placed, group.contour, gap),
    );
    mergeAt(placed, group.contour, x[g]!);
  }

  const levels = Math.max(pivot, groups.length - 1 - pivot) + 1;
  return { x, pivot, levels, contour: placed };
}
