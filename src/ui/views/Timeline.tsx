// SVG has no <button>: the bars are groups with an explicit role, as canvas cards are.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import "@fontsource-variable/archivo/wdth-italic.css";
import "@/ui/canvas/canvas.css";
import "./views.css";

import {
  type FocusEvent,
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { lifespanLabel } from "@/core/dates/fuzzy";
import { CARD_H } from "@/core/layout/constants";
import { displayName } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import type { TimelineBar, TimelineLayout } from "@/core/views/types";
import { GenerationRuler } from "@/ui/canvas/GenerationRuler";
import type { Rect, Viewport } from "@/ui/canvas/viewport";
import { biologicalParents, describePerson, personLabel } from "@/ui/cards/describe";
import { fitText, type Font, useFontEpoch } from "@/ui/cards/PersonCard";

import {
  AXIS_H,
  BAR_H,
  type BarBox,
  TIMELINE_GUTTER,
  timelineFit,
  timelineGeometry,
  yearTicks,
} from "./geometry";
import { focusItem, useViewCamera, type ViewHandle } from "./useViewCamera";

export type TimelineProps = {
  doc: TreeDocument;
  layout: TimelineLayout;
  selectedId: string | null;
  /** RTL runs time from right to left, like the mirrored tree. */
  dir: "ltr" | "rtl";
  /**
   * A click on a bar; null for a click on the background. Method syntax on purpose: a
   * `(personId: string) => void` handler is accepted too.
   */
  onSelect(personId: string | null): void;
  /** Double-click or Enter: make this person the centre of the view. */
  onFocus(personId: string): void;
};

const GUTTER = TIMELINE_GUTTER;
const RADIUS = 6;
const TEXT_INSET = 10;
const NAME_FONT: Font = { size: 12, weight: 600 };
const PLACEHOLDER_FONT: Font = { size: 12, weight: 400, italic: true };
const YEARS_FONT: Font = { size: 11, weight: 400 };
/** Room for a name drawn after its bar. */
const OUTSIDE_ROOM = 220;

/** How a bar ends: a known date, an estimate that fades out, or open (still living). */
type EndKind = "known" | "estimated" | "open";
const endKind = (bar: TimelineBar): EndKind =>
  bar.living ? "open" : bar.endKnown ? "known" : "estimated";

/** Which physical edges of a bar fade out. */
type Fade = "left" | "right" | "both";

function fadeOf(bar: TimelineBar, rtl: boolean): Fade | null {
  const start = !bar.startKnown;
  const end = endKind(bar) === "estimated";
  if (start && end) return "both";
  if (!start && !end) return null;
  return start !== rtl ? "left" : "right";
}

/** Gradient stops (offset, opacity) and direction for a fade. */
const FADES: Record<Fade, { x1: number; x2: number; stops: [number, number][] }> = {
  right: {
    x1: 0,
    x2: 1,
    stops: [
      [0, 1],
      [0.55, 1],
      [1, 0],
    ],
  },
  left: {
    x1: 1,
    x2: 0,
    stops: [
      [0, 1],
      [0.55, 1],
      [1, 0],
    ],
  },
  both: {
    x1: 0,
    x2: 1,
    stops: [
      [0, 0],
      [0.3, 1],
      [0.7, 1],
      [1, 0],
    ],
  },
};

/** A quarter turn of radius `r` to (x, y), clockwise; nothing for a square corner. */
const arc = (r: number, x: number, y: number) => (r > 0 ? `A${r} ${r} 0 0 1 ${x} ${y}` : "");
/** The same, anticlockwise. */
const arcBack = (r: number, x: number, y: number) => (r > 0 ? `A${r} ${r} 0 0 0 ${x} ${y}` : "");

/**
 * A bar's outline: a rounded box, or with `open` one physical side left undrawn (and square), so
 * the bar runs on past the edge of what is known.
 */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  open: "left" | "right" | null = null,
): string {
  const R = x + w;
  const B = y + h;
  const rad = Math.min(r, w / 2, h / 2);
  const lr = open === "left" ? 0 : rad;
  const rr = open === "right" ? 0 : rad;
  if (open === "right") {
    return `M${R} ${y}H${x + lr}${arcBack(lr, x, y + lr)}V${B - lr}${arcBack(lr, x + lr, B)}H${R}`;
  }
  if (open === "left") {
    return `M${x} ${y}H${R - rr}${arc(rr, R, y + rr)}V${B - rr}${arc(rr, R - rr, B)}H${x}`;
  }
  return (
    `M${x + lr} ${y}H${R - rr}${arc(rr, R, y + rr)}V${B - rr}${arc(rr, R - rr, B)}` +
    `H${x + lr}${arc(lr, x, B - lr)}V${y + lr}${arc(lr, x + lr, y)}Z`
  );
}

const rectOf = (b: BarBox): Rect => ({ x: b.x, y: b.y, width: b.width, height: BAR_H });
const keyOf = (b: BarBox) => String(b.bar.row);

/**
 * The timeline: one bar per person from birth to death on a shared year axis, grouped by
 * generation and ordered by birth. Estimated ends fade out; the living run open to today.
 * Read-only: click selects, double-click or Enter refocuses; ↑/↓ walk the rows.
 */
export const Timeline = forwardRef<ViewHandle, TimelineProps>(function Timeline(props, ref) {
  const { doc, layout, selectedId, dir, onSelect, onFocus } = props;
  const { t } = useTranslation();
  // Names are fitted to their bars by measuring: measure again once the web font has loaded.
  const fontEpoch = useFontEpoch();
  const uid = useId();
  const containerRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rtl = dir === "rtl";

  const geometry = useMemo(() => timelineGeometry(layout, dir), [layout, dir]);
  const boxes = useMemo(
    () =>
      geometry.boxes
        .filter((b) => doc.persons[b.bar.personId] !== undefined)
        .toSorted((a, b) => a.bar.row - b.bar.row),
    [geometry, doc],
  );

  // Fit the width (bars kept readable) and start at the top: a timeline is read from its first
  // generation down.
  const fitView = useCallback(
    (bounds: Rect, size: { width: number; height: number }): Viewport =>
      timelineFit(bounds, size, rtl),
    [rtl],
  );

  const camera = useViewCamera({
    containerRef,
    svgRef,
    bounds: geometry.bounds,
    fitView,
    fitKey: `${dir}|${layout.generationRows[0]?.generation ?? ""}|${boxes[0]?.bar.personId ?? ""}`,
    onBackgroundClick: () => onSelect(null),
  });
  const { viewport, size } = camera;

  useImperativeHandle(ref, () => ({
    zoomIn: camera.zoomIn,
    zoomOut: camera.zoomOut,
    fit: camera.fit,
    centerOnPerson: (personId) => {
      const box = boxes.find((b) => b.bar.personId === personId);
      if (box) camera.centerOnPoint([box.x + box.width / 2, box.y + BAR_H / 2]);
    },
  }));

  // Roving tab stop, as in the fan chart. Keys are rows: a person has one bar.
  const [active, setActive] = useState<{ key: string; selectedId: string | null } | null>(null);
  const activeKey = active && active.selectedId === selectedId ? active.key : null;
  const selectedBox = boxes.find((b) => b.bar.personId === selectedId);
  const tabStop =
    (activeKey && boxes.some((b) => keyOf(b) === activeKey) ? activeKey : null) ??
    (selectedBox ? keyOf(selectedBox) : boxes[0] ? keyOf(boxes[0]) : null);

  // Screen-reader labels, worked out once per tree, not on every pan and zoom frame.
  const labels = useMemo(() => {
    const parents = biologicalParents(doc);
    return new Map(
      boxes.map((b) => [b.bar.personId, describePerson(doc, b.bar.personId, t, { parents })]),
    );
  }, [boxes, doc, t]);

  const onKeyDown = (index: number) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const personId = boxes[index]!.bar.personId;
    if (e.key === "Enter") {
      e.preventDefault();
      onSelect(personId);
      onFocus(personId);
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      onSelect(personId);
      return;
    }
    const target =
      e.key === "ArrowUp"
        ? index - 1
        : e.key === "ArrowDown"
          ? index + 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? boxes.length - 1
              : null;
    if (target === null) return;
    e.preventDefault();
    const to = boxes[target];
    if (!to) return;
    setActive({ key: keyOf(to), selectedId });
    focusItem(svgRef.current, keyOf(to));
  };

  const onFocusIn = (e: FocusEvent<SVGSVGElement>) => {
    const key = (e.target as Element).closest("[data-key]")?.getAttribute("data-key");
    const box = boxes.find((b) => keyOf(b) === key);
    if (!box) return;
    if (activeKey !== key) setActive({ key: keyOf(box), selectedId });
    camera.reveal(rectOf(box));
  };

  // The bars do not depend on the camera: panning and zooming only move the group around them,
  // so they are built once per layout, selection and tab stop, not on every frame.
  const keyDownRef = useRef(onKeyDown);
  useLayoutEffect(() => {
    keyDownRef.current = onKeyDown;
  });
  const fadeId = useCallback((f: Fade) => `${uid}-fade-${f}`, [uid]);
  const bars = useMemo(
    () =>
      boxes.map((box, index) => {
        const { bar } = box;
        const person = doc.persons[bar.personId]!;
        const placeholder = person.isPlaceholder === true && displayName(person) === "";
        const ends = endKind(bar);
        const fade = fadeOf(bar, rtl);
        const open = ends === "open" ? (rtl ? "left" : "right") : null;
        const key = keyOf(box);
        const classes = [
          "stam-timeline__bar",
          !bar.living && "stam-timeline__bar--deceased",
          placeholder && "stam-timeline__bar--placeholder",
          bar.personId === selectedId && "stam-timeline__bar--selected",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <g key={`${bar.personId}:${bar.row}`}>
            <g
              className={classes}
              role="button"
              data-person-id={bar.personId}
              data-key={key}
              data-end={ends}
              tabIndex={key === tabStop ? 0 : -1}
              aria-label={labels.get(bar.personId)}
              aria-current={bar.personId === selectedId ? "true" : undefined}
              onClick={() => onSelect(bar.personId)}
              onDoubleClick={() => onFocus(bar.personId)}
              onKeyDown={(e) => keyDownRef.current(index)(e)}
            >
              <path
                className="stam-timeline__focus"
                d={barPath(box.x - 3, box.y - 3, box.width + 6, BAR_H + 6, RADIUS + 3)}
              />
              <g mask={fade ? `url(#${fadeId(fade)})` : undefined}>
                <path
                  className="stam-timeline__fill"
                  d={barPath(box.x, box.y, box.width, BAR_H, RADIUS, open)}
                />
                <path
                  className="stam-timeline__edge"
                  d={barPath(box.x, box.y, box.width, BAR_H, RADIUS, open)}
                />
              </g>
            </g>
            <BarText
              box={box}
              name={personLabel(person, t)}
              years={lifespanLabel(person.birth?.date, person.death?.date, person.isLiving)}
              placeholder={placeholder}
              rtl={rtl}
            />
          </g>
        );
      }),
    // `fontEpoch` is not read inside: it stands for the text widths `BarText` measures.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [boxes, doc, labels, selectedId, tabStop, rtl, fadeId, t, onSelect, onFocus, fontEpoch],
  );

  // ---- Axis, grid and rulers ---------------------------------------------------------------
  const { ticks } = yearTicks(layout.minYear, layout.maxYear, geometry.pxPerYear * viewport.k);
  const anyLiving = boxes.some((b) => b.bar.living);
  const fades = new Set(boxes.map((b) => fadeOf(b.bar, rtl)).filter((f): f is Fade => f !== null));
  const rulerRows = geometry.groups.map((g) => ({
    generation: g.generation,
    y: g.y + g.height / 2 - CARD_H / 2,
  }));
  const rulerViewport = { ...viewport, y: viewport.y - AXIS_H };
  const selectedGeneration = selectedBox?.bar.generation ?? null;
  const top = -GUTTER;
  const bottom = geometry.height + GUTTER;

  return (
    <section
      ref={containerRef}
      className="stam-view stam-timeline"
      dir={dir}
      aria-label={t("views.timeline.region")}
    >
      <svg ref={svgRef} className="stam-view__svg" width="100%" height="100%" onFocus={onFocusIn}>
        <defs>
          {[...fades].map((f) => (
            <linearGradient key={f} id={`${fadeId(f)}-g`} x1={FADES[f].x1} x2={FADES[f].x2}>
              {FADES[f].stops.map(([offset, opacity]) => (
                <stop key={offset} offset={offset} stopColor="#fff" stopOpacity={opacity} />
              ))}
            </linearGradient>
          ))}
          {[...fades].map((f) => (
            <mask key={f} id={fadeId(f)} maskContentUnits="objectBoundingBox">
              <rect width={1} height={1} fill={`url(#${fadeId(f)}-g)`} />
            </mask>
          ))}
        </defs>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
          <g className="stam-timeline__grid" aria-hidden="true">
            {ticks.map((year) => (
              <line
                key={year}
                x1={geometry.yearX(year)}
                x2={geometry.yearX(year)}
                y1={top}
                y2={bottom}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {anyLiving && (
              <line
                className="stam-timeline__now"
                x1={geometry.yearX(layout.maxYear)}
                x2={geometry.yearX(layout.maxYear)}
                y1={top}
                y2={bottom}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {geometry.groups.slice(1).map((g) => (
              <line
                key={g.generation}
                className="stam-timeline__divider"
                x1={geometry.bounds.x}
                x2={geometry.bounds.x + geometry.bounds.width}
                y1={g.y - geometry.groupGap / 2 - (geometry.rowPitch - BAR_H) / 2}
                y2={g.y - geometry.groupGap / 2 - (geometry.rowPitch - BAR_H) / 2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {bars}
        </g>
      </svg>

      {/* Physical positions: the axis is a ruler of x coordinates, so it is laid out LTR. */}
      <div className="stam-timeline__axis" dir="ltr" aria-hidden="true">
        {ticks.map((year) => {
          const x = geometry.yearX(year) * viewport.k + viewport.x;
          if (x < -40 || x > size.width + 40) return null;
          return (
            <span
              key={year}
              className="stam-timeline__tick"
              style={{ transform: `translateX(${Math.round(x * 10) / 10}px)` }}
            >
              {year}
            </span>
          );
        })}
      </div>

      <div className="stam-canvas__chrome">
        <GenerationRuler
          rows={rulerRows}
          viewport={rulerViewport}
          height={Math.max(0, size.height - AXIS_H)}
          activeGeneration={selectedGeneration}
        />
      </div>

      {boxes.length === 0 && <p className="stam-timeline__empty">{t("views.timeline.empty")}</p>}
    </section>
  );
});

/**
 * Name and years: inside the bar from its start when they fit, else the name inside and the
 * years after the bar, else both after the bar.
 */
function BarText({
  box,
  name,
  years,
  placeholder,
  rtl,
}: {
  box: BarBox;
  name: string;
  years: string;
  placeholder: boolean;
  rtl: boolean;
}) {
  const font = placeholder ? PLACEHOLDER_FONT : NAME_FONT;
  const room = box.width - 2 * TEXT_INSET;
  // An en space: SVG collapses ordinary runs of spaces.
  const gap = "\u2002";
  const fits = (text: string) => room > 0 && fitText(text, room, font) === text;
  const both = years ? `${name}${gap}${years}` : name;
  const inside = fits(both) ? "both" : fits(name) ? "name" : "none";

  // `start` follows the inherited direction: in RTL it is the right edge, where bars start.
  const startX = rtl ? box.x + box.width - TEXT_INSET : box.x + TEXT_INSET;
  const afterX = rtl ? box.x - TEXT_INSET : box.x + box.width + TEXT_INSET;
  const y = box.y + BAR_H / 2;
  const nameClass = placeholder
    ? "stam-timeline__name stam-timeline__name--placeholder"
    : "stam-timeline__name";
  // Years read left to right in either direction (views.css isolates them).
  const yearsSpan = (
    <tspan className="stam-timeline__years" fontSize={YEARS_FONT.size} fontWeight={400}>
      {years}
    </tspan>
  );

  return (
    <g className="stam-timeline__text" aria-hidden="true">
      {inside !== "none" && (
        <text
          className={nameClass}
          x={startX}
          y={y}
          textAnchor="start"
          dominantBaseline="central"
          fontSize={font.size}
          fontWeight={font.weight}
          unicodeBidi="isolate"
        >
          {name}
          {inside === "both" && years && gap}
          {inside === "both" && years && yearsSpan}
        </text>
      )}
      {inside !== "both" && (
        <text
          className={nameClass}
          x={afterX}
          y={y}
          textAnchor="start"
          dominantBaseline="central"
          fontSize={font.size}
          fontWeight={font.weight}
          unicodeBidi="isolate"
        >
          {inside === "none" && fitText(name, OUTSIDE_ROOM, font)}
          {inside === "none" && years && gap}
          {years && yearsSpan}
        </text>
      )}
    </g>
  );
}
