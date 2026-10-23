import { CARD_H, CARD_W, ROW_H } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import { withRoot } from "@/core/model/tree";
import type { Gender, TreeDocument } from "@/core/model/types";

/** The tree list's thumbnails draw this many generations from the root down. */
export const PREVIEW_GENERATIONS = 3;
/** Width over height of the thumbnail frame (`.tree-card__preview`). */
export const PREVIEW_ASPECT = 2;
/** Space around the drawing, in layout px. */
const PAD = 48;
/** A card is never less than this share of the frame's height: a wide family is cropped. */
const MIN_CARD_SHARE = 0.13;

export type PreviewCard = {
  x: number;
  y: number;
  width: number;
  height: number;
  generation: number;
  gender: Gender;
  living: boolean;
};

export type PreviewDrawing = {
  /** x, y, width, height, in layout px. */
  viewBox: [number, number, number, number];
  cards: PreviewCard[];
  /** SVG path data of the connectors ("M x y L x y …"). */
  lines: string[];
  /** The family is wider than the frame, so its sides are cut off. */
  cropped: boolean;
};

export type TreePreview = {
  /** All the generations of the family view from the root, not only the drawn ones. */
  generations: number;
  /** Null for a tree with nobody in it. */
  drawing: PreviewDrawing | null;
};

const round = (n: number) => Math.round(n);

/**
 * A thumbnail of a tree: the family view's first three generations from the root, as plain
 * boxes and lines, framed at `PREVIEW_ASPECT`. Pure; `previewOf` caches it.
 */
export function treePreview(doc: TreeDocument): TreePreview {
  const rootId = withRoot(doc).rootPersonId;
  if (rootId === undefined) return { generations: 0, drawing: null };
  const full = layoutFamily(doc, { rootId });
  // Laid out again with the last drawn generation collapsed, so the generations below it don't
  // spread the drawn ones apart.
  const last = full.nodes.filter((n) => n.generation === PREVIEW_GENERATIONS - 1);
  const layout =
    full.generationCount > PREVIEW_GENERATIONS
      ? layoutFamily(doc, { rootId, collapsed: new Set(last.map((n) => n.personId)) })
      : full;
  const shown = layout.nodes.filter((n) => n.generation < PREVIEW_GENERATIONS);
  if (shown.length === 0) return { generations: 0, drawing: null };

  const top = Math.min(...shown.map((n) => n.y));
  const lowest = top + (PREVIEW_GENERATIONS - 1) * ROW_H + CARD_H;
  const cards: PreviewCard[] = shown.map((n) => {
    const p = doc.persons[n.personId]!;
    return {
      x: round(n.x),
      y: round(n.y),
      width: CARD_W,
      height: CARD_H,
      generation: n.generation,
      gender: p.gender,
      living: p.isLiving,
    };
  });
  const lines = layout.edges
    .filter((e) => e.points.every(([, y]) => y <= lowest))
    .map((e) =>
      e.points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join(""),
    );

  // The content's box, padded, then fitted to the frame: a narrow family gets side margins, a
  // wide one first gets more height (smaller cards), and past a point is cropped around the root.
  const minX = Math.min(...cards.map((c) => c.x)) - PAD;
  const maxX = Math.max(...cards.map((c) => c.x + c.width)) + PAD;
  const minY = top - PAD;
  const maxY = Math.max(...cards.map((c) => c.y + c.height)) + PAD;
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const height = Math.max(contentH, Math.min(contentW / PREVIEW_ASPECT, CARD_H / MIN_CARD_SHARE));
  const width = height * PREVIEW_ASPECT;
  const root = cards.find((_, i) => shown[i]!.personId === rootId) ?? cards[0]!;
  const centre = root.x + root.width / 2;
  const x =
    width >= contentW
      ? minX - (width - contentW) / 2
      : Math.min(Math.max(centre - width / 2, minX), maxX - width);
  const y = minY - (height - contentH) / 2;
  return {
    generations: full.generationCount,
    drawing: {
      viewBox: [round(x), round(y), round(height) * PREVIEW_ASPECT, round(height)],
      cards,
      lines,
      cropped: width < contentW,
    },
  };
}

const cache = new Map<string, { updatedAt: string; preview: TreePreview }>();

/** `treePreview`, kept per tree until the tree's `updatedAt` changes. */
export function previewOf(doc: TreeDocument): TreePreview {
  const hit = cache.get(doc.id);
  if (hit?.updatedAt === doc.updatedAt) return hit.preview;
  const preview = treePreview(doc);
  cache.set(doc.id, { updatedAt: doc.updatedAt, preview });
  return preview;
}

/** The cached preview of a tree at this edit time, if one was made: no need to read the tree. */
export function cachedPreview(treeId: string, updatedAt: string): TreePreview | undefined {
  const hit = cache.get(treeId);
  return hit?.updatedAt === updatedAt ? hit.preview : undefined;
}
