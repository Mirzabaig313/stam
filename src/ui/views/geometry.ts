// Pure geometry for the fan chart and the timeline: no React, no DOM. World coordinates are the
// same kind as the canvas's (px at zoom 1); the views pan and zoom them with `viewport.ts`.
import type { FanLayout, TimelineBar, TimelineLayout } from "@/core/views/types";
import { MIN_ZOOM, type Rect, type Viewport } from "@/ui/canvas/viewport";

// ---- Fan chart ------------------------------------------------------------------------------

type Angles = { startAngle: number; endAngle: number };
type Sector = Angles & { innerRadius: number; outerRadius: number };

/** An empty arc: a parent nobody has recorded, of someone who is drawn. */
export type FanSlot = Sector & { generation: number };

/** Gap between neighbouring segments, in px: they read as separate cards. */
export const SEGMENT_GAP = 4;
/** Space between a segment's edge and its text. */
const LABEL_PAD = 4;

const round = (n: number) => Math.round(n * 100) / 100 + 0; // + 0 turns -0 into 0

/** The point at radius `r` and angle `a` (0 = right, clockwise with y pointing down). */
export function polar(r: number, a: number): [number, number] {
  return [round(r * Math.cos(a)), round(r * Math.sin(a))];
}

/** An annular sector from `start` to `end` (clockwise); `inner` 0 draws a wedge. */
export function sectorPath(inner: number, outer: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const [ox0, oy0] = polar(outer, start);
  const [ox1, oy1] = polar(outer, end);
  const outerArc = `M${ox0} ${oy0}A${outer} ${outer} 0 ${large} 1 ${ox1} ${oy1}`;
  if (inner <= 0) return `${outerArc}L0 0Z`;
  const [ix1, iy1] = polar(inner, end);
  const [ix0, iy0] = polar(inner, start);
  return `${outerArc}L${ix1} ${iy1}A${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0}Z`;
}

/** Reflects angles across the vertical axis (RTL), staying in the upper half (π..2π). */
export function mirrorAngles<T extends Angles>(s: T): T {
  return { ...s, startAngle: 3 * Math.PI - s.endAngle, endAngle: 3 * Math.PI - s.startAngle };
}

/** The sector shrunk by half of `gap` on every side, so neighbours keep `gap` between them. */
export function insetSector<T extends Sector>(s: T, gap = SEGMENT_GAP): T {
  const half = gap / 2;
  const mid = (s.innerRadius + s.outerRadius) / 2;
  let innerRadius = s.innerRadius > 0 ? s.innerRadius + half : 0;
  let outerRadius = s.outerRadius - half;
  if (outerRadius < innerRadius) innerRadius = outerRadius = mid;
  const pad = mid > 0 ? half / mid : 0;
  let startAngle = s.startAngle + pad;
  let endAngle = s.endAngle - pad;
  if (endAngle < startAngle) startAngle = endAngle = (s.startAngle + s.endAngle) / 2;
  return { ...s, innerRadius, outerRadius, startAngle, endAngle };
}

export const midAngle = (s: Angles) => (s.startAngle + s.endAngle) / 2;

/** The focus person's disc: inside the parents' ring, else an even share of the radius. */
export function centreRadius(layout: FanLayout): number {
  const parents = layout.segments.filter((s) => s.generation === 1);
  if (parents.length > 0) return Math.min(...parents.map((s) => s.innerRadius));
  return layout.radius / (Math.max(1, layout.generations) + 1);
}

/** Half-angle tolerance when matching a slot to a segment. */
const EPS = 1e-6;

/**
 * The empty arcs to outline: for the focus and each drawn segment, the halves of its arc in the
 * next generation that have no segment. Unknowns of unknowns are left blank, so a sparse tree
 * does not fill with outlines. Ring radii come from the generation's segments, else continue the
 * ring before it.
 */
export function emptySlots(layout: FanLayout): FanSlot[] {
  const r0 = centreRadius(layout);
  const byGeneration = new Map<number, Sector[]>();
  for (const s of layout.segments) {
    const list = byGeneration.get(s.generation) ?? [];
    list.push(s);
    byGeneration.set(s.generation, list);
  }

  const rings: { inner: number; outer: number }[] = [{ inner: 0, outer: r0 }];
  for (let g = 1; g <= layout.generations; g++) {
    const own = byGeneration.get(g);
    const prev = rings[g - 1]!;
    if (own && own.length > 0) {
      rings.push({
        inner: Math.min(...own.map((s) => s.innerRadius)),
        outer: Math.max(...own.map((s) => s.outerRadius)),
      });
    } else {
      const width = g === 1 ? r0 : prev.outer - prev.inner;
      rings.push({ inner: prev.outer, outer: prev.outer + width });
    }
  }

  const slots: FanSlot[] = [];
  const children: Angles[][] = [[{ startAngle: Math.PI, endAngle: 2 * Math.PI }]];
  for (let g = 1; g <= layout.generations; g++) {
    const own = byGeneration.get(g) ?? [];
    for (const child of children[g - 1] ?? []) {
      const mid = midAngle(child);
      for (const [startAngle, endAngle] of [
        [child.startAngle, mid],
        [mid, child.endAngle],
      ] as const) {
        const centre = (startAngle + endAngle) / 2;
        const known = own.some((s) => s.startAngle - EPS <= centre && centre <= s.endAngle + EPS);
        if (!known) {
          slots.push({
            generation: g,
            startAngle,
            endAngle,
            innerRadius: rings[g]!.inner,
            outerRadius: rings[g]!.outer,
          });
        }
      }
    }
    children.push(own);
  }
  return slots;
}

/** Room for the focus's name below the centre line. */
const BELOW = 24;

/**
 * The upper half disc, plus a little room below the centre line. Only as large as the rings that
 * are drawn: a sparse fan asked for seven generations is fitted to the few it has.
 */
export function fanBounds(layout: FanLayout): Rect {
  const slots = emptySlots(layout);
  const r = Math.max(
    centreRadius(layout),
    ...layout.segments.map((s) => s.outerRadius),
    ...slots.map((s) => s.outerRadius),
  );
  return { x: -r, y: -r, width: 2 * r, height: r + BELOW };
}

export type LabelMode = "arc" | "radial" | "initials" | "none";

/**
 * How a segment's name fits: along the arc for wide segments, along the radius for narrow deep
 * ones, initials where only a little fits, nothing in a sliver. `length` is the room for the
 * text's run, `lines` how many lines (name, then years) fit across it.
 */
export function planLabel(s: Sector): { mode: LabelMode; length: number; lines: 1 | 2 } {
  const span = (s.endAngle - s.startAngle) * ((s.innerRadius + s.outerRadius) / 2);
  const arcLength = span - 2 * LABEL_PAD;
  const depth = s.outerRadius - s.innerRadius - 2 * LABEL_PAD;
  if (depth >= 16 && arcLength >= 40 && arcLength >= depth) {
    return { mode: "arc", length: arcLength, lines: depth >= 34 ? 2 : 1 };
  }
  if (arcLength >= 14 && depth >= 40) {
    return { mode: "radial", length: depth, lines: arcLength >= 30 ? 2 : 1 };
  }
  if (arcLength >= 16 && depth >= 16) return { mode: "initials", length: 0, lines: 1 };
  return { mode: "none", length: 0, lines: 1 };
}

/**
 * Rotation, in degrees, for text that runs along the radius at angle `a`, kept upright: on the
 * left it reads inwards, on the right outwards.
 */
export function radialRotation(a: number): number {
  const turn = a < 1.5 * Math.PI ? a - Math.PI : a;
  return (turn * 180) / Math.PI;
}

// ---- Timeline -------------------------------------------------------------------------------

/** Horizontal scale at zoom 1. */
export const PX_PER_YEAR = 8;
export const BAR_H = 24;
const ROW_PITCH = 32;
const GROUP_GAP = 28;
/** Bars never shrink below this, so a person with one known year still shows. */
const MIN_BAR = 6;
/** Room past the last year for names drawn after a bar. */
export const LABEL_ROOM = 240;

export type BarBox = { bar: TimelineBar; x: number; y: number; width: number };
export type TimelineGroup = { generation: number; y: number; height: number };

export type TimelineGeometry = {
  boxes: BarBox[];
  groups: TimelineGroup[];
  /** Width of the year range, without the label room. */
  chartWidth: number;
  height: number;
  pxPerYear: number;
  rowPitch: number;
  groupGap: number;
  /** Year to world x; RTL runs right to left. */
  yearX: (year: number) => number;
  /** The drawing's extent, label room included. */
  bounds: Rect;
};

export function timelineGeometry(layout: TimelineLayout, dir: "ltr" | "rtl"): TimelineGeometry {
  const pxPerYear = PX_PER_YEAR;
  const chartWidth = Math.max(0, layout.maxYear - layout.minYear) * pxPerYear;
  const rtl = dir === "rtl";
  const yearX = (year: number) => {
    const x = (year - layout.minYear) * pxPerYear;
    return rtl ? chartWidth - x : x;
  };

  const groupOfRow = new Map<number, number>();
  layout.generationRows.forEach((g, i) => {
    for (let row = g.firstRow; row <= g.lastRow; row++) groupOfRow.set(row, i);
  });
  const rowY = (row: number) => row * ROW_PITCH + (groupOfRow.get(row) ?? 0) * GROUP_GAP;

  const boxes = layout.bars.map((bar): BarBox => {
    const a = yearX(bar.start);
    const b = yearX(Math.max(bar.start, bar.end));
    let x = Math.min(a, b);
    let width = Math.abs(b - a);
    if (width < MIN_BAR) {
      if (rtl) x -= MIN_BAR - width;
      width = MIN_BAR;
    }
    return { bar, x, y: rowY(bar.row), width };
  });

  const groups = layout.generationRows.map((g): TimelineGroup => ({
    generation: g.generation,
    y: rowY(g.firstRow),
    height: (g.lastRow - g.firstRow) * ROW_PITCH + BAR_H,
  }));
  const last = layout.generationRows.at(-1);
  const height = last ? rowY(last.lastRow) + BAR_H : 0;

  return {
    boxes,
    groups,
    chartWidth,
    height,
    pxPerYear,
    rowPitch: ROW_PITCH,
    groupGap: GROUP_GAP,
    yearX,
    bounds: {
      x: rtl ? -LABEL_ROOM : 0,
      y: 0,
      width: chartWidth + LABEL_ROOM,
      height,
    },
  };
}

/** Height of the timeline's year axis along the top edge (matches views.css). */
export const AXIS_H = 32;
/** Room for the generation ruler (40 px) plus a gutter. */
export const RULER_ROOM = 56;
export const TIMELINE_GUTTER = 16;
/** The timeline never fits so small that a bar is shorter than this on screen. */
export const MIN_BAR_PX = 10;

/**
 * The timeline's first view: the full width when that keeps bars readable (never past 1:1), else
 * bars `MIN_BAR_PX` tall and the rest reached by panning (a phone); from the top, the start of
 * time at the inline-start edge.
 */
export function timelineFit(
  bounds: Rect,
  size: { width: number; height: number },
  rtl: boolean,
): Viewport {
  const room = size.width - RULER_ROOM - TIMELINE_GUTTER;
  const fitWidth = bounds.width > 0 ? room / bounds.width : 1;
  const k = Math.max(MIN_ZOOM, MIN_BAR_PX / BAR_H, Math.min(1, fitWidth));
  const x = rtl
    ? size.width - RULER_ROOM - (bounds.x + bounds.width) * k
    : RULER_ROOM - bounds.x * k;
  return { k, x, y: AXIS_H + TIMELINE_GUTTER - bounds.y * k };
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
/** Labels on the year axis are at least this far apart on screen. */
const MIN_TICK_PX = 64;

/** Round years for the axis at `pxPerYear` screen px per year. */
export function yearTicks(
  minYear: number,
  maxYear: number,
  pxPerYear: number,
): { step: number; ticks: number[] } {
  const step = STEPS.find((s) => s * pxPerYear >= MIN_TICK_PX) ?? STEPS.at(-1)!;
  const ticks: number[] = [];
  for (let y = Math.ceil(minYear / step) * step; y <= maxYear; y += step) ticks.push(y);
  return { step, ticks };
}
