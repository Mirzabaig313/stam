import { memo } from "react";

import type { CardMetrics } from "@/core/layout/constants";
import type { LayoutEdge } from "@/core/layout/types";
import type { ConnectorStyle } from "@/templates/types";

import type { Lod } from "./viewport";

type Point = [number, number];

/** Line width at full detail, and the distance between a married couple's two lines. */
const STROKE = 1.5;
const DOUBLE_GAP = 3;

export type EdgeStyle = { double: boolean; dash: string | undefined };

/**
 * Married (and widowed) unions: two parallel lines. Partner and engaged: one solid line.
 * Divorced and separated: dashed 6 4. Child lines: solid for biological, dotted 2 3 otherwise.
 */
export function edgeStyle(edge: LayoutEdge): EdgeStyle {
  if (edge.kind === "child") {
    return {
      double: false,
      dash: edge.childType && edge.childType !== "biological" ? "2 3" : undefined,
    };
  }
  switch (edge.status) {
    case "married":
    case "widowed":
      return { double: true, dash: undefined };
    case "divorced":
    case "separated":
      return { double: false, dash: "6 4" };
    default:
      return { double: false, dash: undefined };
  }
}

/**
 * The polyline moved `d` to its left-hand normal (positive d = +y for a line running in +x),
 * with mitred corners. Zero-length segments are skipped.
 */
export function offsetPolyline(points: readonly Point[], d: number): Point[] {
  const pts: Point[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  if (pts.length < 2) return pts.map(([x, y]) => [x, y]);
  const normals = pts.slice(1).map((p, i): Point => {
    const [x0, y0] = pts[i]!;
    const len = Math.hypot(p[0] - x0, p[1] - y0);
    return [-(p[1] - y0) / len, (p[0] - x0) / len];
  });
  return pts.map(([x, y], i): Point => {
    const n1 = normals[Math.max(0, i - 1)]!;
    const n2 = normals[Math.min(normals.length - 1, i)]!;
    const scale = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [clean(x + (n1[0] + n2[0]) * scale), clean(y + (n1[1] + n2[1]) * scale)];
  });
}

/** Rounds to 1/100 px and turns -0 into 0, so paths stay short and stable. */
const clean = (n: number) => Math.round(n * 100) / 100 + 0;

function pathOf(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${clean(x)} ${clean(y)}`).join("");
}

/** A polyline with its corners rounded to `r` (clamped to half of each segment). */
function roundedPath(points: readonly Point[], r: number): string {
  if (r <= 0 || points.length < 3) return pathOf(points);
  let d = `M${clean(points[0]![0])} ${clean(points[0]![1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    if (l1 === 0 || l2 === 0) continue;
    const k = Math.min(r, l1 / 2, l2 / 2);
    const ax = x1 - ((x1 - x0) / l1) * k;
    const ay = y1 - ((y1 - y0) / l1) * k;
    const bx = x1 + ((x2 - x1) / l2) * k;
    const by = y1 + ((y2 - y1) / l2) * k;
    d += `L${clean(ax)} ${clean(ay)}Q${clean(x1)} ${clean(y1)} ${clean(bx)} ${clean(by)}`;
  }
  const last = points.at(-1)!;
  return `${d}L${clean(last[0])} ${clean(last[1])}`;
}

/** A polyline drawn by hand: each segment bows a little to alternate sides. */
function wobblyPath(points: readonly Point[], amp: number): string {
  let d = `M${clean(points[0]![0])} ${clean(points[0]![1])}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) continue;
    // Short runs barely bow; long ones up to `amp`.
    const a = (i % 2 ? amp : -amp) * Math.min(1, len / 80);
    const mx = (x0 + x1) / 2 - ((y1 - y0) / len) * a;
    const my = (y0 + y1) / 2 + ((x1 - x0) / len) * a;
    d += `Q${clean(mx)} ${clean(my)} ${clean(x1)} ${clean(y1)}`;
  }
  return d;
}

/**
 * How a template draws the connectors (see `ConnectorStyle`). Lengths in it are at 100 % card
 * size; `scale` is the look's card size.
 */
export type EdgeLook = {
  style: ConnectorStyle;
  colour: string;
  scale: number;
  metrics: CardMetrics;
  /** Botanical: line weight by height, thick near the root and thinner towards the leaves. */
  taper?: (y: number) => number;
};

function TemplateEdge({
  edge,
  look,
  detailed,
  dimmed,
}: {
  edge: LayoutEdge & { opacity?: number };
  look: EdgeLook;
  detailed: boolean;
  dimmed: boolean;
}) {
  const { style, colour, scale, metrics } = look;
  const className = dimmed ? "stam-edge stam-edge--dimmed" : "stam-edge";
  const opacity = edge.opacity !== undefined && edge.opacity < 1 ? edge.opacity : undefined;
  const base = style.width * scale * (look.taper ? look.taper(edge.points[0]![1]) : 1);
  const width = detailed ? base : 1;
  const line = (points: readonly Point[]) =>
    style.wobble && detailed
      ? wobblyPath(points, style.wobble * scale)
      : roundedPath(points, detailed ? style.radius * scale : 0);
  const stroke = {
    stroke: colour,
    strokeWidth: width,
    ...(detailed ? {} : { vectorEffect: "non-scaling-stroke" as const }),
  };

  if (edge.kind === "union") {
    let points = edge.points;
    // Gallery: a couple line runs on into each card, up to its medallion.
    if (style.coupleMeets && points.length === 2) {
      const inset = metrics.cardW / 2 - style.coupleMeets * scale - 1;
      const [[ax, ay], [bx, by]] = points as [Point, Point];
      const dirX = Math.sign(bx - ax) || 1;
      points = [
        [ax - dirX * inset, ay],
        [bx + dirX * inset, by],
      ];
    }
    const split = edge.status === "divorced" || edge.status === "separated";
    const [mx, my] = midpoint(points);
    const mark = 6 * scale;
    return (
      <g className={className} data-edge-id={edge.id} opacity={opacity}>
        <path d={line(points)} {...stroke} />
        {detailed && split && (
          <path
            className="stam-edge__divorce"
            d={`M${clean(mx - mark * 0.9)} ${clean(my + mark * 1.2)}L${clean(mx - mark * 0.1)} ${clean(my - mark * 1.2)}M${clean(mx + mark * 0.1)} ${clean(my + mark * 1.2)}L${clean(mx + mark * 0.9)} ${clean(my - mark * 1.2)}`}
            {...stroke}
          />
        )}
        {detailed && !split && style.coupleMark === "diamond" && (
          <path
            className="stam-edge__mark"
            d={`M${clean(mx)} ${clean(my - mark)}l${clean(mark)} ${clean(mark)}l${clean(-mark)} ${clean(mark)}l${clean(-mark)} ${clean(-mark)}z`}
            style={{ fill: look.colour }}
          />
        )}
      </g>
    );
  }

  // An adopted, step or foster child: only the child's own drop is dashed, never the bar the
  // siblings share, so a biological sibling on the same bar never looks adopted.
  const otherwise = edge.childType && edge.childType !== "biological";
  if (otherwise && edge.points.length >= 3 && detailed) {
    const pts = edge.points;
    const corner = pts.at(-2)!;
    const before = pts.at(-3)!;
    const run = Math.hypot(corner[0] - before[0], corner[1] - before[1]);
    const keep = run === 0 ? 0 : Math.min(1, (style.radius * scale + 1) / run);
    const cut: Point = [
      corner[0] - (corner[0] - before[0]) * keep,
      corner[1] - (corner[1] - before[1]) * keep,
    ];
    return (
      <g className={className} data-edge-id={edge.id} opacity={opacity}>
        <path d={line([...pts.slice(0, -2), cut])} {...stroke} />
        <path
          d={line([cut, corner, pts.at(-1)!])}
          strokeDasharray={style.adoptedDash}
          {...stroke}
        />
      </g>
    );
  }
  return (
    <path
      className={className}
      data-edge-id={edge.id}
      d={line(edge.points)}
      strokeDasharray={otherwise ? style.adoptedDash : undefined}
      opacity={opacity}
      {...stroke}
    />
  );
}

/** The middle of a polyline, by length. */
function midpoint(points: readonly Point[]): Point {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len >= left && len > 0)
      return [x0 + ((x1 - x0) * left) / len, y0 + ((y1 - y0) * left) / len];
    left -= len;
  }
  return points[0]!;
}

type EdgePathProps = {
  edge: LayoutEdge & { opacity?: number };
  detailed: boolean;
  dimmed: boolean;
  look?: EdgeLook;
};

const EdgePath = memo(function EdgePath({ edge, detailed, dimmed, look }: EdgePathProps) {
  if (look) return <TemplateEdge edge={edge} look={look} detailed={detailed} dimmed={dimmed} />;
  const { double, dash } = edgeStyle(edge);
  const className = dimmed ? "stam-edge stam-edge--dimmed" : "stam-edge";
  const opacity = edge.opacity !== undefined && edge.opacity < 1 ? edge.opacity : undefined;
  const stroke = detailed
    ? { strokeWidth: STROKE }
    : { strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const };
  if (double && detailed) {
    return (
      <g className={className} data-edge-id={edge.id} opacity={opacity}>
        <path d={pathOf(offsetPolyline(edge.points, -DOUBLE_GAP / 2))} {...stroke} />
        <path d={pathOf(offsetPolyline(edge.points, DOUBLE_GAP / 2))} {...stroke} />
      </g>
    );
  }
  return (
    <path
      className={className}
      data-edge-id={edge.id}
      d={pathOf(edge.points)}
      strokeDasharray={dash}
      opacity={opacity}
      {...stroke}
    />
  );
});

export type EdgesProps = {
  edges: readonly (LayoutEdge & { opacity?: number })[];
  lod: Lod;
  /** Edge ids drawn faded (focus mode). */
  dimmedIds?: ReadonlySet<string> | null;
  /**
   * A relationship path: these edges are drawn at full ink strength, in a group of their own (the
   * others sit in the faded group, and should be in `dimmedIds`).
   */
  highlightIds?: ReadonlySet<string> | null;
  /** The tree's template: its line style and colour. Today's ink lines when left out. */
  look?: EdgeLook;
};

/**
 * Connector lines. They are drawn in ink inside one group faded to the R32 strength (3:1 against
 * the ground, see canvas.css), so lines that share a run (a union's drop to its sibling bar) do not darken where they overlap.
 * Below full detail, lines are 1 screen px and married couples get a single line.
 */
export function Edges({ edges, lod, dimmedIds, highlightIds, look }: EdgesProps) {
  const detailed = lod === "full";
  const lit = (edge: { id: string }) => highlightIds?.has(edge.id) ?? false;
  const draw = (list: typeof edges) =>
    list.map((edge) => (
      <EdgePath
        key={edge.id}
        edge={edge}
        detailed={detailed}
        dimmed={dimmedIds?.has(edge.id) ?? false}
        look={look}
      />
    ));
  // A template's lines carry their own colour at full strength (its palettes keep them at 3:1).
  const own = look ? { style: { opacity: 1 } } : {};
  if (!highlightIds) {
    return (
      <g className="stam-edges" fill="none" {...own}>
        {draw(edges)}
      </g>
    );
  }
  return (
    <>
      <g className="stam-edges" fill="none" {...own}>
        {draw(edges.filter((e) => !lit(e)))}
      </g>
      <g className="stam-edges stam-edges--path" fill="none">
        {draw(edges.filter(lit))}
      </g>
    </>
  );
}
