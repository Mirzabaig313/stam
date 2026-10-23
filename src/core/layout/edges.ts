import type { ChildType, UnionStatus } from "@/core/model/types";

import { CARD_H, CARD_W, ROW_H } from "./constants";
import type { LayoutEdge } from "./types";

type Point = [number, number];

// Over-brackets (third and later spouses) rise between BRACKET_RISE and BRACKET_RISE_MAX above
// the cards, outer ones higher, and start just right of the blood person's top centre so they
// never run along the line from that person's parents.
const BRACKET_RISE = 12;
const BRACKET_RISE_MAX = 20;
const BRACKET_INSET = 8;

// Sibling bars: the first at CARD_H + 24 below the parent row, 8 apart. They always stay in
// [CARD_H + 12, ROW_H - 24] below the parent row top, which keeps them clear of the next row's
// cards and of its brackets.
const BAR_DROP = 24;
const BAR_STEP = 8;
const BAR_MIN = CARD_H + 12;
const BAR_MAX = ROW_H - 24;

/** How far bracket `index` of `count` rises above its row. */
export function bracketRise(index: number, count: number): number {
  if (count <= 1) return BRACKET_RISE;
  return BRACKET_RISE + index * Math.min(4, (BRACKET_RISE_MAX - BRACKET_RISE) / (count - 1));
}

/** Where bracket `index` of `count` leaves the blood person's top edge, from the card's left. */
export function bracketStart(index: number, count: number): number {
  const step = count <= 1 ? 0 : Math.min(8, (CARD_W / 2 - 2 * BRACKET_INSET) / (count - 1));
  return CARD_W / 2 + BRACKET_INSET + (count - 1 - index) * step;
}

/**
 * Sibling bar offset below the parent row top. Level 0 is the lowest bar; with `levels` bars
 * in a block, they are BAR_STEP apart, or squeezed evenly into the allowed band.
 */
export function barOffset(level: number, levels: number): number {
  const top = levels - 1;
  const first = CARD_H + BAR_DROP;
  if (first + BAR_STEP * top <= BAR_MAX) return first + BAR_STEP * (top - level);
  return BAR_MIN + ((BAR_MAX - BAR_MIN) / top) * (top - level);
}

/** A line at mid-height across the gap between two neighbouring cards. */
export function unionLine(
  unionId: string,
  status: UnionStatus,
  rowTop: number,
  leftX: number,
  rightX: number,
): LayoutEdge {
  const y = rowTop + CARD_H / 2;
  const points: Point[] = [
    [leftX + CARD_W, y],
    [rightX, y],
  ];
  return { id: `union:${unionId}`, kind: "union", unionId, status, points };
}

/** A bracket over the cards from `fromX` up `rise`, across, and down to the spouse's top centre. */
export function unionBracket(
  unionId: string,
  status: UnionStatus,
  rowTop: number,
  fromX: number,
  spouseX: number,
  rise: number,
): LayoutEdge {
  const to = spouseX + CARD_W / 2;
  const top = rowTop - rise;
  const points: Point[] = [
    [fromX, rowTop],
    [fromX, top],
    [to, top],
    [to, rowTop],
  ];
  return { id: `union:${unionId}`, kind: "union", unionId, status, points };
}

/** Anchor, down to the union's sibling bar, along it, down to the child's top centre. */
export function childEdge(
  unionId: string,
  childType: ChildType,
  anchor: Point,
  barY: number,
  childNodeId: string,
  childX: number,
  childY: number,
): LayoutEdge {
  const childCentre = childX + CARD_W / 2;
  return {
    id: `child:${unionId}:${childNodeId}`,
    kind: "child",
    unionId,
    childType,
    points: [anchor, [anchor[0], barY], [childCentre, barY], [childCentre, childY]],
  };
}
