// SVG has no <button>: the segments are groups with an explicit role, as canvas cards are.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import "@fontsource-variable/archivo/wdth-italic.css";
import "./views.css";

import {
  type FocusEvent,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { lifespanLabel } from "@/core/dates/fuzzy";
import { displayName } from "@/core/model/tree";
import type { Person, TreeDocument } from "@/core/model/types";
import type { FanLayout } from "@/core/views/types";
import type { Rect } from "@/ui/canvas/viewport";
import { fitBounds } from "@/ui/canvas/viewport";
import { describePerson, personLabel } from "@/ui/cards/describe";
import { fitText, type Font, initialsOf, useFontEpoch } from "@/ui/cards/PersonCard";

import {
  centreRadius,
  emptySlots,
  fanBounds,
  insetSector,
  midAngle,
  mirrorAngles,
  planLabel,
  polar,
  radialRotation,
  sectorPath,
  SEGMENT_GAP,
} from "./geometry";
import { focusItem, useViewCamera, type ViewHandle } from "./useViewCamera";

export type FanChartProps = {
  doc: TreeDocument;
  layout: FanLayout;
  selectedId: string | null;
  /** RTL mirrors the fan: the father's side is on the right. */
  dir: "ltr" | "rtl";
  /**
   * A click on a segment; null for a click on the background. Method syntax on purpose: a
   * `(personId: string) => void` handler is accepted too.
   */
  onSelect(personId: string | null): void;
  /** Double-click or Enter: make this person the centre of the view. */
  onFocus(personId: string): void;
};

type Sector = { startAngle: number; endAngle: number; innerRadius: number; outerRadius: number };

/** A focusable thing in the fan: the centre disc (`generation` 0) or an ancestor's segment. */
type Item = Sector & {
  key: string;
  personId: string;
  generation: number;
  /** Position in its generation per the layout: paternal side first, in both directions. */
  index: number;
};

const NAME_FONT: Font = { size: 13, weight: 600 };
const PLACEHOLDER_FONT: Font = { size: 13, weight: 400, italic: true };
const YEARS_FONT: Font = { size: 11, weight: 400 };
const CENTRE_FONT: Font = { size: 15, weight: 600 };
const INITIALS_FONT: Font = { size: 11, weight: 600 };
const LABEL_PAD = 4;
/** Below this many characters a cut name says less than the initials do. */
const MIN_CHARS = 4;

const FOCUS_KEY = "focus";
const keyOf = (generation: number, index: number) => `${generation}:${index}`;

/** The world box around a sector, for keeping a focused segment on screen. */
function sectorBox(s: Sector): Rect {
  const points: [number, number][] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = s.startAngle + ((s.endAngle - s.startAngle) * i) / steps;
    points.push(polar(s.outerRadius, a), polar(s.innerRadius, a));
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const contains = (outer: Sector, a: number) => outer.startAngle <= a && a <= outer.endAngle;

/** The item an arrow key leads to: sideways within a ring, up to a parent, down to the child. */
function neighbour(items: readonly Item[], from: Item, key: string): Item | undefined {
  const ring = (g: number) =>
    items.filter((i) => i.generation === g).toSorted((a, b) => a.startAngle - b.startAngle);
  const same = ring(from.generation);
  const at = same.indexOf(from);
  switch (key) {
    case "ArrowLeft":
      return same[at - 1];
    case "ArrowRight":
      return same[at + 1];
    case "Home":
      return same[0];
    case "End":
      return same.at(-1);
    case "ArrowUp":
      return ring(from.generation + 1)
        .filter((i) => contains(from, midAngle(i)))
        .toSorted((a, b) => a.index - b.index)[0];
    case "ArrowDown":
      return ring(from.generation - 1).find((i) => contains(i, midAngle(from)));
    default:
      return undefined;
  }
}

/** An arc path along radius `r`, left to right across the top, for text to follow. */
const textArc = (r: number, s: Sector) => {
  const [x0, y0] = polar(r, s.startAngle);
  const [x1, y1] = polar(r, s.endAngle);
  return `M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}`;
};

/**
 * The fan chart: the focus person as a half disc in the middle, their ancestors in rings around
 * it, each generation's arcs half as wide as their child's. Unknown parents show as empty dashed
 * arcs. Read-only: click selects, double-click or Enter refocuses; arrow keys walk the fan.
 */
export const FanChart = forwardRef<ViewHandle, FanChartProps>(function FanChart(props, ref) {
  const { doc, layout, selectedId, dir, onSelect, onFocus } = props;
  const { t } = useTranslation();
  useFontEpoch();
  const uid = useId();
  const containerRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rtl = dir === "rtl";

  const r0 = centreRadius(layout);
  const items = useMemo((): Item[] => {
    const physical = <T extends Sector>(s: T): T => (rtl ? mirrorAngles(s) : s);
    const centre: Item = {
      key: FOCUS_KEY,
      personId: layout.focusId,
      generation: 0,
      index: 0,
      startAngle: Math.PI,
      endAngle: 2 * Math.PI,
      innerRadius: 0,
      outerRadius: r0,
    };
    const segments = layout.segments.map((s): Item =>
      physical({ ...s, key: keyOf(s.generation, s.index) }),
    );
    return [centre, ...segments].filter((i) => doc.persons[i.personId] !== undefined);
  }, [layout, doc, rtl, r0]);
  const slots = useMemo(
    () => emptySlots(layout).map((s) => (rtl ? mirrorAngles(s) : s)),
    [layout, rtl],
  );
  const bounds = useMemo(() => fanBounds(layout), [layout]);

  const camera = useViewCamera({
    containerRef,
    svgRef,
    bounds,
    fitView: fitBounds,
    fitKey: `${layout.focusId}|${dir}|${layout.generations}`,
    onBackgroundClick: () => onSelect(null),
  });
  const { viewport } = camera;

  useImperativeHandle(ref, () => ({
    zoomIn: camera.zoomIn,
    zoomOut: camera.zoomOut,
    fit: camera.fit,
    centerOnPerson: (personId) => {
      const item = items.find((i) => i.personId === personId);
      if (!item) return;
      const box = sectorBox(item);
      camera.centerOnPoint([box.x + box.width / 2, box.y + box.height / 2]);
    },
  }));

  // Roving tab stop: the item the keyboard last moved to (while the selection stays the same),
  // else the selected person, else the focus.
  const [active, setActive] = useState<{ key: string; selectedId: string | null } | null>(null);
  const keys = new Set(items.map((i) => i.key));
  const activeKey = active && active.selectedId === selectedId ? active.key : null;
  const selectedKey = items.find((i) => i.personId === selectedId)?.key;
  const tabStop = (activeKey && keys.has(activeKey) ? activeKey : null) ?? selectedKey ?? FOCUS_KEY;

  const onKeyDown = (item: Item) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onSelect(item.personId);
      onFocus(item.personId);
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      onSelect(item.personId);
      return;
    }
    const to = neighbour(items, item, e.key);
    if (!to && !e.key.startsWith("Arrow") && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (!to) return;
    setActive({ key: to.key, selectedId });
    focusItem(svgRef.current, to.key);
  };

  const onFocusIn = (e: FocusEvent<SVGSVGElement>) => {
    const key = (e.target as Element).closest("[data-key]")?.getAttribute("data-key");
    const item = items.find((i) => i.key === key);
    if (!item) return;
    if (activeKey !== item.key) setActive({ key: item.key, selectedId });
    camera.reveal(sectorBox(item));
  };

  const focusPerson = doc.persons[layout.focusId];
  const focusName = focusPerson ? personLabel(focusPerson, t) : "";

  return (
    <section
      ref={containerRef}
      className="stam-view stam-fan"
      dir={dir}
      aria-label={t("views.fan.region", { name: focusName })}
    >
      <svg ref={svgRef} className="stam-view__svg" width="100%" height="100%" onFocus={onFocusIn}>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
          <g aria-hidden="true">
            <line
              className="stam-fan__baseline"
              x1={bounds.x}
              x2={bounds.x + bounds.width}
              y1={0}
              y2={0}
            />
            {slots.map((s) => (
              <path
                key={`${s.generation}:${s.startAngle}`}
                className="stam-fan__slot"
                d={sectorPath(...sectorArgs(insetSector(s)))}
              />
            ))}
          </g>
          {items.map((item) => {
            const person = doc.persons[item.personId]!;
            const centre = item.key === FOCUS_KEY;
            const placeholder = person.isPlaceholder === true && displayName(person) === "";
            const classes = [
              "stam-fan__cell",
              centre ? "stam-fan__centre" : "stam-fan__seg",
              (!person.isLiving || person.death !== undefined) && "stam-fan__cell--deceased",
              placeholder && "stam-fan__cell--placeholder",
              item.personId === selectedId && "stam-fan__seg--selected",
            ]
              .filter(Boolean)
              .join(" ");
            // The centre keeps its flat edge on the baseline: only its arc is pulled in.
            const drawn = centre
              ? { ...item, outerRadius: item.outerRadius - SEGMENT_GAP / 2 }
              : insetSector(item);
            const ring = centre
              ? { ...item, outerRadius: item.outerRadius + 1 }
              : insetSector(item, SEGMENT_GAP - 6);
            return (
              <g key={item.key}>
                <g
                  className={classes}
                  role="button"
                  data-person-id={item.personId}
                  data-key={item.key}
                  tabIndex={item.key === tabStop ? 0 : -1}
                  aria-label={describePerson(doc, item.personId, t)}
                  aria-current={item.personId === selectedId ? "true" : undefined}
                  onClick={() => onSelect(item.personId)}
                  onDoubleClick={() => onFocus(item.personId)}
                  onKeyDown={onKeyDown(item)}
                >
                  <path className="stam-fan__focus" d={sectorPath(...sectorArgs(ring))} />
                  <path className="stam-fan__bg" d={sectorPath(...sectorArgs(drawn))} />
                </g>
                <g
                  className={
                    placeholder ? "stam-fan__label stam-fan__label--placeholder" : "stam-fan__label"
                  }
                  aria-hidden="true"
                >
                  {centre
                    ? centreLabel(person, placeholder, r0 - SEGMENT_GAP / 2, t)
                    : segmentLabel(person, placeholder, drawn, `${uid}-${item.key}`, t)}
                </g>
              </g>
            );
          })}
        </g>
      </svg>
    </section>
  );
});

const sectorArgs = (s: Sector) => [s.innerRadius, s.outerRadius, s.startAngle, s.endAngle] as const;

type Translate = ReturnType<typeof useTranslation>["t"];

function nameOf(person: Person, t: Translate): string {
  return personLabel(person, t);
}

function yearsOf(person: Person): string {
  return lifespanLabel(person.birth?.date, person.death?.date, person.isLiving);
}

/** The focus person's name and years, centred in the half disc. */
function centreLabel(person: Person, placeholder: boolean, r: number, t: Translate): ReactNode {
  const nameY = -r * 0.42;
  const yearsY = nameY + 18;
  const chord = (y: number) => 2 * Math.sqrt(Math.max(0, r * r - y * y)) - 2 * LABEL_PAD;
  const years = yearsOf(person);
  const nameFont = placeholder ? { ...CENTRE_FONT, weight: 400, italic: true } : CENTRE_FONT;
  return (
    <>
      <text
        className="stam-fan__name"
        x={0}
        y={nameY}
        textAnchor="middle"
        fontSize={CENTRE_FONT.size}
        fontWeight={nameFont.weight}
        unicodeBidi="isolate"
      >
        {fitText(nameOf(person, t), chord(nameY - 6), nameFont)}
      </text>
      {years && (
        <text
          className="stam-fan__years"
          x={0}
          y={yearsY}
          textAnchor="middle"
          fontSize={YEARS_FONT.size}
        >
          {fitText(years, chord(yearsY), YEARS_FONT)}
        </text>
      )}
    </>
  );
}

/** A cut name too short to say much: the initials say more. */
const tooShort = (fitted: string, full: string) =>
  fitted !== full && Array.from(fitted).length < MIN_CHARS;

function initialsLabel(person: Person, s: Sector): ReactNode {
  const [x, y] = polar((s.innerRadius + s.outerRadius) / 2, midAngle(s));
  return (
    <text
      className="stam-fan__initials"
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={INITIALS_FONT.size}
      fontWeight={INITIALS_FONT.weight}
    >
      {initialsOf(person)}
    </text>
  );
}

/**
 * A segment's text: name (and years when two lines fit) along the arc, or along the radius in a
 * narrow deep segment, else the initials, else nothing (the aria-label still names the person).
 */
function segmentLabel(
  person: Person,
  placeholder: boolean,
  s: Sector,
  pathId: string,
  t: Translate,
): ReactNode {
  const plan = planLabel(s);
  if (plan.mode === "none") return null;
  if (plan.mode === "initials") return initialsLabel(person, s);

  const name = nameOf(person, t);
  const years = yearsOf(person);
  const font = placeholder ? PLACEHOLDER_FONT : NAME_FONT;
  const mid = (s.innerRadius + s.outerRadius) / 2;
  const twoLines = plan.lines === 2 && years !== "";

  if (plan.mode === "arc") {
    const nameR = twoLines ? mid + 3 : mid - 4;
    const yearsR = mid - 13;
    const room = (r: number) => r * (s.endAngle - s.startAngle) - 2 * LABEL_PAD;
    const fitted = fitText(name, room(nameR), font);
    if (tooShort(fitted, name)) return initialsLabel(person, s);
    return (
      <>
        <defs>
          <path id={`${pathId}-n`} d={textArc(nameR, s)} />
          {twoLines && <path id={`${pathId}-y`} d={textArc(yearsR, s)} />}
        </defs>
        <text
          className="stam-fan__name"
          fontSize={font.size}
          fontWeight={font.weight}
          unicodeBidi="isolate"
        >
          <textPath href={`#${pathId}-n`} startOffset="50%" textAnchor="middle">
            {fitted}
          </textPath>
        </text>
        {twoLines && (
          <text className="stam-fan__years" fontSize={YEARS_FONT.size}>
            <textPath href={`#${pathId}-y`} startOffset="50%" textAnchor="middle">
              {fitText(years, room(yearsR), YEARS_FONT)}
            </textPath>
          </text>
        )}
      </>
    );
  }

  // Radial: along the radius, upright on both sides.
  const fitted = fitText(name, plan.length, font);
  if (tooShort(fitted, name)) return initialsLabel(person, s);
  const a = midAngle(s);
  const [x, y] = polar(mid, a);
  return (
    <g
      className="stam-fan__label--radial"
      transform={`translate(${x} ${y}) rotate(${Math.round(radialRotation(a) * 100) / 100})`}
    >
      <text
        className="stam-fan__name"
        y={twoLines ? -7 : 0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={font.size - 1}
        fontWeight={font.weight}
        unicodeBidi="isolate"
      >
        {fitted}
      </text>
      {twoLines && (
        <text
          className="stam-fan__years"
          y={8}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={YEARS_FONT.size}
        >
          {fitText(years, plan.length, YEARS_FONT)}
        </text>
      )}
    </g>
  );
}
