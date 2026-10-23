// Turns layoutFamily results into "frames" keyed by stable names, and blends two frames for
// the scroll-built family. Pure: the same numbers on the server, in tests and in the browser.

import { CARD_H, CARD_W, ROW_H } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import type { NodeKind } from "@/core/layout/types";
import type { ChildType, UnionStatus } from "@/core/model/types";

import { buildChapterDocs, type SampleDoc } from "./family";

export { CARD_H, CARD_W, ROW_H };

export type FrameCard = { key: string; x: number; y: number; row: number; kind: NodeKind };

export type FrameEdge = {
  id: string;
  kind: "union" | "child";
  status?: UnionStatus;
  childType?: ChildType;
  points: [number, number][];
};

export type Box = { x: number; y: number; width: number; height: number };

export type Frame = { cards: FrameCard[]; edges: FrameEdge[]; bounds: Box; rows: number };

/** Lays out one sample document from its root and renames everything to stable keys. */
export function frameOf(sample: SampleDoc, rootKey = "ada"): Frame {
  const rootId = sample.ids[rootKey];
  if (!rootId) throw new Error(`No person ${rootKey}`);
  const layout = layoutFamily(sample.doc, { rootId });
  const rename = (edgeId: string, unionId: string) => {
    const unionKey = sample.unionKeyOf[unionId] ?? unionId;
    const renamed = edgeId.replace(unionId, unionKey);
    // Child edges end with the child's node id, which is the person id.
    return renamed.replace(/:([^:]+)$/, (whole, nodeId: string) =>
      sample.keyOf[nodeId] ? `:${sample.keyOf[nodeId]}` : whole,
    );
  };
  const cards = layout.nodes.map((n) => ({
    key: sample.keyOf[n.personId] ?? n.personId,
    x: n.x,
    y: n.y,
    row: n.generation,
    kind: n.kind,
  }));
  const edges = layout.edges.map((e) => {
    const edge: FrameEdge = {
      id: rename(e.id, e.unionId),
      kind: e.kind,
      points: e.points.map(([x, y]) => [x, y] as [number, number]),
    };
    if (e.status) edge.status = e.status;
    if (e.childType) edge.childType = e.childType;
    return edge;
  });
  return { cards, edges, bounds: layout.bounds, rows: layout.generationCount };
}

/** One frame per chapter: I one person, II spouse, III children, IV grandchildren, V the rest. */
export function buildChapterFrames(): Frame[] {
  return buildChapterDocs().map((sample) => frameOf(sample));
}

// ------------------------------------------------------------------------------- blending

export type BlendCard = FrameCard & { opacity: number; entering: boolean };
export type BlendEdge = FrameEdge & { draw: number };
export type Blend = { cards: BlendCard[]; edges: BlendEdge[]; bounds: Box; rows: number };

/** How far a new card starts beside its place on the row, in layout px. */
export const ENTER_OFFSET = 140;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** expo-out, the site's one easing: fast slide, slow lock. */
export const settle = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Blend from frame `a` to frame `b` at `t` (0..1). Cards in both glide to their new place;
 * new cards slide in sideways from the outside of the tree and lock onto their row; new
 * connectors draw once the cards have nearly arrived. Rows fade in with their first card.
 */
export function blendFrames(a: Frame, b: Frame, t: number): Blend {
  const p = clamp01(t);
  const move = settle(p);
  const before = new Map(a.cards.map((c) => [c.key, c]));
  const centre = b.bounds.x + b.bounds.width / 2;
  const cards = b.cards.map((card): BlendCard => {
    const from = before.get(card.key);
    if (from) {
      return {
        ...card,
        x: lerp(from.x, card.x, move),
        y: lerp(from.y, card.y, move),
        opacity: 1,
        entering: false,
      };
    }
    const side = card.x + CARD_W / 2 < centre ? -1 : 1;
    return {
      ...card,
      x: card.x + side * ENTER_OFFSET * (1 - move),
      opacity: clamp01(p * 2.5),
      entering: p < 1,
    };
  });

  const oldEdges = new Map(a.edges.map((e) => [e.id, e]));
  const edges = b.edges.map((edge): BlendEdge => {
    const from = oldEdges.get(edge.id);
    if (from && from.points.length === edge.points.length) {
      return {
        ...edge,
        // A status change (married to divorced) switches style halfway.
        status: p < 0.5 ? from.status : edge.status,
        points: edge.points.map(([x, y], i) => [
          lerp(from.points[i]![0], x, move),
          lerp(from.points[i]![1], y, move),
        ]),
        draw: 1,
      };
    }
    return { ...edge, draw: clamp01((p - 0.2) / 0.3) };
  });

  return {
    cards,
    edges,
    bounds: {
      x: lerp(a.bounds.x, b.bounds.x, move),
      y: lerp(a.bounds.y, b.bounds.y, move),
      width: lerp(a.bounds.width, b.bounds.width, move),
      height: lerp(a.bounds.height, b.bounds.height, move),
    },
    rows: lerp(a.rows, b.rows, clamp01(p * 2.5)),
  };
}

/** The frame at a continuous story position: 0 = chapter I, 4 = chapter V, 1.5 = halfway to III. */
export function frameAt(frames: Frame[], position: number): Blend {
  const last = frames.length - 1;
  const at = Math.min(last, Math.max(0, position));
  const i = Math.floor(at);
  if (at === i) return blendFrames(frames[Math.max(0, i - 1)]!, frames[i]!, 1);
  return blendFrames(frames[i]!, frames[i + 1]!, at - i);
}

/** Row centre in layout px, for the ruler. */
export const rowCentre = (row: number) => row * ROW_H + CARD_H / 2;

/** Bounds padded so connectors and card edges never touch the frame. */
export function padded(b: Box, pad = 24): Box {
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

const ROMAN: [number, string][] = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** 1 -> "I", 4 -> "IV". Generation rows count from I. */
export function roman(n: number): string {
  let rest = n;
  let out = "";
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}
