// Draws engine frames as HTML cards over SVG connectors, in the editor's card style.
// Static trees scale with their container (percent positions, sizes in container units), so
// they need no JavaScript; the live stage reuses the same pieces in layout pixels.

import type { CSSProperties, ReactNode } from "react";

import type { UnionStatus } from "@/core/model/types";
import { samplePerson } from "@/site/sample/family";
import {
  type Box,
  CARD_H,
  CARD_W,
  type Frame,
  type FrameEdge,
  padded,
  roman,
  ROW_H,
  rowCentre,
} from "@/site/sample/frames";

/** SVG path data for one connector. Married partners get the editor's double line. */
export function edgePath(
  points: [number, number][],
  kind: FrameEdge["kind"],
  status?: UnionStatus,
) {
  if (kind === "union" && status === "married" && points.length === 2) {
    const [[x1, y], [x2]] = points as [[number, number], [number, number]];
    return `M${x1} ${y - 2.5}H${x2}M${x1} ${y + 2.5}H${x2}`;
  }
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("");
}

export function edgeClass(edge: Pick<FrameEdge, "kind" | "status" | "childType">) {
  if (edge.kind === "union") {
    return edge.status === "divorced" || edge.status === "separated" ? "edge edge--dashed" : "edge";
  }
  return edge.childType && edge.childType !== "biological" ? "edge edge--dotted" : "edge";
}

/** The years line: "1946", or "1921", a drawn rule, "†2009". No dash characters. */
export function Years({ born, died }: { born: number; died?: number }) {
  return (
    <span className="card__years">
      <span>{born}</span>
      {died !== undefined && (
        <>
          <span className="card__rule">
            <span className="sr-only"> to </span>
          </span>
          <span>†{died}</span>
        </>
      )}
    </span>
  );
}

/** One person card. `as` lets the calculator render it as a button. */
export function CardBody({ personKey }: { personKey: string }) {
  const p = samplePerson(personKey);
  return (
    <>
      <span className="card__avatar" aria-hidden="true">
        {p.initials}
      </span>
      <span className="card__text">
        <bdi className="card__name">{p.name}</bdi>
        <Years born={p.born} {...(p.died !== undefined ? { died: p.died } : {})} />
      </span>
      {/* The smallest level of detail shows the first name alone (CSS picks the level). */}
      <span className="card__first" aria-hidden="true">
        {p.first}
      </span>
      <span className="card__sex" aria-hidden="true">
        {p.gender === "male" ? "♂" : "♀"}
      </span>
    </>
  );
}

export function cardClass(personKey: string, extra = "") {
  const p = samplePerson(personKey);
  return `card${p.died !== undefined ? " card--deceased" : ""}${extra ? ` ${extra}` : ""}`;
}

const pct = (v: number) => `${+(v * 100).toFixed(4)}%`;

/** Percent geometry of a card inside a viewBox, for absolutely positioned overlays. */
export function placeIn(view: Box, x: number, y: number): CSSProperties {
  return {
    left: pct((x - view.x) / view.width),
    top: pct((y - view.y) / view.height),
    width: pct(CARD_W / view.width),
    height: pct(CARD_H / view.height),
  };
}

export type StaticTreeProps = {
  frame: Frame;
  className?: string;
  /** Extra padding around the bounds, in layout px. */
  pad?: number;
  /** Replace a card's markup, e.g. with a button. */
  renderCard?: (key: string, style: CSSProperties) => ReactNode;
  /** Edge ids drawn in the accent colour. */
  highlight?: ReadonlySet<string>;
  /** Edge ids drawn as a lighter accent preview (a path under the pointer). */
  preview?: ReadonlySet<string>;
  /** Index used by CSS for a row-by-row entrance. */
  stagger?: boolean;
  children?: ReactNode;
};

/** A complete tree that scales with its container's width. Decorative unless a caller adds buttons. */
export function StaticTree({
  frame,
  className = "",
  pad = 24,
  renderCard,
  highlight,
  preview,
  stagger = false,
  children,
}: StaticTreeProps) {
  const view = padded(frame.bounds, pad);
  const style = {
    aspectRatio: `${view.width} / ${view.height}`,
    "--tree-w": view.width,
  } as CSSProperties;
  return (
    <div className={`tree ${className}`} style={style} dir="ltr">
      <svg
        className="tree__edges"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        aria-hidden="true"
        focusable="false"
      >
        {frame.edges.map((edge) => (
          <path
            key={edge.id}
            className={`${edgeClass(edge)}${highlight?.has(edge.id) ? " edge--on" : preview?.has(edge.id) ? " edge--preview" : ""}`}
            d={edgePath(edge.points, edge.kind, edge.status)}
            style={stagger ? ({ "--row": edgeRow(edge) } as CSSProperties) : undefined}
          />
        ))}
      </svg>
      {frame.cards.map((card, i) => {
        const placed = placeIn(view, card.x, card.y);
        if (renderCard) return renderCard(card.key, placed);
        const entrance = stagger
          ? ({ "--row": card.row, "--i": i, "--side": cardSide(frame, card.x) } as CSSProperties)
          : {};
        return (
          <div
            key={card.key}
            className={cardClass(card.key)}
            style={{ ...placed, ...entrance }}
            aria-hidden="true"
          >
            <CardBody personKey={card.key} />
          </div>
        );
      })}
      {children}
    </div>
  );
}

const edgeRow = (edge: FrameEdge) => {
  const last = edge.points.at(-1)!;
  return Math.round((last[1] - CARD_H / 2) / ROW_H);
};

const cardSide = (frame: Frame, x: number) =>
  x + CARD_W / 2 < frame.bounds.x + frame.bounds.width / 2 ? -1 : 1;

/** Roman numerals for each row, positioned against the same viewBox as the tree. */
export function RulerMarks({ frame, pad = 24 }: { frame: Frame; pad?: number }) {
  const view = padded(frame.bounds, pad);
  return (
    <ol className="ruler" aria-hidden="true">
      {Array.from({ length: frame.rows }, (_, row) => (
        <li
          key={row}
          className="ruler__mark"
          style={
            { top: pct((rowCentre(row) - view.y) / view.height), "--row": row } as CSSProperties
          }
        >
          {roman(row + 1)}
        </li>
      ))}
    </ol>
  );
}

/**
 * A plain-language description of a frame, for screen readers and crawlers. With `previous`,
 * only the people this step added are named, so the five chapter figures never repeat.
 */
export function describeFrame(frame: Frame, previous?: Frame): string {
  const before = new Set(previous?.cards.map((c) => c.key) ?? []);
  const rows: string[][] = Array.from({ length: frame.rows }, () => []);
  for (const card of frame.cards) {
    if (!before.has(card.key)) rows[card.row]!.push(samplePerson(card.key).name);
  }
  const lines = rows.flatMap((names, i) => {
    if (names.length === 0) return [];
    return previous
      ? [`${names.join(", ")} on row ${roman(i + 1)}.`]
      : [`Row ${roman(i + 1)}: ${names.join(", ")}.`];
  });
  return previous ? `Added in this step: ${lines.join(" ")}` : lines.join(" ");
}
