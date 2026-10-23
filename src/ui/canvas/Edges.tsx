import { memo } from "react";

import type { LayoutEdge } from "@/core/layout/types";

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

type EdgePathProps = {
  edge: LayoutEdge & { opacity?: number };
  detailed: boolean;
  dimmed: boolean;
};

const EdgePath = memo(function EdgePath({ edge, detailed, dimmed }: EdgePathProps) {
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
};

/**
 * Connector lines. They are drawn in ink inside one group faded to the R32 strength (3:1 against
 * the ground, see canvas.css), so lines that share a run (a union's drop to its sibling bar) do not darken where they overlap.
 * Below full detail, lines are 1 screen px and married couples get a single line.
 */
export function Edges({ edges, lod, dimmedIds, highlightIds }: EdgesProps) {
  const detailed = lod === "full";
  const lit = (edge: { id: string }) => highlightIds?.has(edge.id) ?? false;
  const draw = (list: typeof edges) =>
    list.map((edge) => (
      <EdgePath
        key={edge.id}
        edge={edge}
        detailed={detailed}
        dimmed={dimmedIds?.has(edge.id) ?? false}
      />
    ));
  if (!highlightIds) {
    return (
      <g className="stam-edges" fill="none">
        {draw(edges)}
      </g>
    );
  }
  return (
    <>
      <g className="stam-edges" fill="none">
        {draw(edges.filter((e) => !lit(e)))}
      </g>
      <g className="stam-edges stam-edges--path" fill="none">
        {draw(edges.filter(lit))}
      </g>
    </>
  );
}
