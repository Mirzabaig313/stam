import type { TFunction } from "i18next";
import type { ReactNode } from "react";

import { unionYOf } from "@/core/layout/constants";
import type { LayoutResult } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";
import { MARHUM } from "@/templates/faces/shajara";
import { fitText, type Font, textWidth } from "@/templates/text";
import type { Palette, Template } from "@/templates/types";

// The poster around the tree: a page grid with a title band on top, a legend band at the
// bottom and the tree centred on the stage between them. Every template decorates the bands
// its own way; none of them may change their size. Lengths are export px.

const MARGIN = 40;
const PAD = 32;
const TITLE_H = 128;
const LEGEND_H = 60;
/** The inline-start gutter for generation numerals. */
const NUMERALS_W = 56;
/** Botanical's trunk and roots grow below the tree. */
const TRUNK_H = 120;

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

export type FrameGeometry = {
  width: number;
  height: number;
  /** Layout coordinates to page. */
  dx: number;
  dy: number;
  title: { x: number; y: number; width: number; height: number };
  legend: { x: number; y: number; width: number; height: number };
  stage: { x: number; y: number; width: number; height: number };
  numerals: boolean;
};

const hasNumerals = (template: Template) =>
  template.id === "heritage" || template.id === "gallery" || template.id === "swiss";

/** The page size and where everything goes on it. `rtl` puts the numerals on the right. */
export function frameGeometry(
  layout: LayoutResult,
  template: Template,
  rtl: boolean,
  titleWidth: number,
): FrameGeometry {
  const b = layout.bounds;
  const numerals = hasNumerals(template) && layout.nodes.length > 0;
  const gutter = numerals ? NUMERALS_W : 0;
  const trunk = template.id === "botanical" && layout.nodes.length > 0 ? TRUNK_H : 0;
  const stageW = Math.max(b.width + 2 * PAD, titleWidth + 2 * PAD - gutter);
  const stageH = b.height + 2 * PAD + trunk;
  const width = Math.ceil(stageW + gutter + 2 * MARGIN);
  const height = Math.ceil(stageH + TITLE_H + LEGEND_H + 2 * MARGIN);
  const stageX = rtl ? MARGIN : MARGIN + gutter;
  const stageY = MARGIN + TITLE_H;
  const treeX = stageX + (stageW - b.width) / 2;
  const treeY = stageY + PAD;
  return {
    width,
    height,
    dx: r2(treeX - b.x),
    dy: r2(treeY - b.y),
    title: { x: MARGIN, y: MARGIN, width: width - 2 * MARGIN, height: TITLE_H },
    legend: {
      x: MARGIN,
      y: height - MARGIN - LEGEND_H,
      width: width - 2 * MARGIN,
      height: LEGEND_H,
    },
    stage: { x: stageX, y: stageY, width: stageW, height: stageH },
    numerals,
  };
}

/** The marks a tree uses, so the legend explains exactly those. */
export type LegendUse = {
  deceased: boolean;
  divorced: boolean;
  adopted: boolean;
  unknown: boolean;
  folded: boolean;
  marriedIn: boolean;
  /** Both genders on the tree: the photo rings' two colours need a key. */
  genders: boolean;
};

export function legendUse(doc: TreeDocument, layout: LayoutResult): LegendUse {
  const shown = layout.nodes.map((n) => doc.persons[n.personId]).filter((p) => p !== undefined);
  return {
    deceased: shown.some((p) => !p.isLiving || p.death !== undefined),
    divorced: layout.edges.some(
      (e) => e.kind === "union" && (e.status === "divorced" || e.status === "separated"),
    ),
    adopted: layout.edges.some(
      (e) => e.kind === "child" && e.childType !== undefined && e.childType !== "biological",
    ),
    unknown: shown.some((p) => p.isPlaceholder),
    folded: layout.nodes.some((n) => n.hiddenCount > 0),
    marriedIn: layout.nodes.some((n) => n.kind === "spouse"),
    genders:
      shown.some((p) => p.gender === "male" && !p.isPlaceholder) &&
      shown.some((p) => p.gender === "female" && !p.isPlaceholder),
  };
}

/** "3 generations, 1921 to today": counted from the layout, the year from the oldest birth. */
export function autoSubtitle(doc: TreeDocument, layout: LayoutResult, t: TFunction): string {
  let year = Infinity;
  for (const n of layout.nodes) {
    const born = doc.persons[n.personId]?.birth?.date?.year;
    if (born !== undefined) year = Math.min(year, born);
  }
  const count = layout.generationCount;
  return Number.isFinite(year)
    ? t("export.frameText.subtitle", { count, year })
    : t("export.frameText.subtitleNoYear", { count });
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const roman = (n: number) => ROMAN[n - 1] ?? String(n);

function Text({
  x,
  y,
  font,
  fill,
  anchor = "middle",
  children,
  className,
  spacing,
}: {
  x: number;
  y: number;
  font: Font;
  fill: string;
  anchor?: "start" | "middle" | "end";
  children: string;
  className?: string;
  spacing?: number;
}) {
  return (
    <text
      className={className}
      x={r2(x)}
      y={r2(y)}
      textAnchor={anchor}
      fontFamily={font.family}
      fontSize={font.size}
      fontWeight={font.weight}
      fontStyle={font.italic ? "italic" : undefined}
      letterSpacing={spacing}
      unicodeBidi="isolate"
      style={{ fill }}
    >
      {children}
    </text>
  );
}

type LegendItem = { key: string; label: string; symbol: (x: number, y: number) => ReactNode };

/** The legend's entries in the template's own symbols, for the marks the tree uses. */
function legendItems(template: Template, p: Palette, use: LegendUse, t: TFunction): LegendItem[] {
  const w = template.connectors.width;
  const line = p.line;
  const items: LegendItem[] = [];
  const ring = (colour: string) => (x: number, y: number) => (
    <circle cx={x + 11} cy={y} r={6.5} style={{ fill: p.card, stroke: colour, strokeWidth: 2.5 }} />
  );
  const label = (key: string) => {
    const text = t(`export.frameText.legend.${key}`);
    // A shajara's legend reads Urdu first, in the template's own words.
    if (template.id !== "shajara") return text;
    const urdu: Record<string, string> = {
      deceased: MARHUM,
      divorced: "طلاق",
      adopted: "لے پالک",
      unknown: "نامعلوم",
      folded: "بند شاخ",
    };
    return urdu[key] && urdu[key] !== text ? `${urdu[key]} · ${text}` : text;
  };
  if (use.deceased) {
    items.push({
      key: "deceased",
      label: label("deceased"),
      symbol: (x, y) => {
        switch (template.id) {
          case "gallery":
            return (
              <circle
                cx={x + 11}
                cy={y}
                r={6.5}
                style={{ fill: p.ground, stroke: p.ink, strokeWidth: 2 }}
              />
            );
          case "swiss":
            return (
              <text x={x + 11} y={y + 5} textAnchor="middle" fontSize={15} style={{ fill: p.ink }}>
                †
              </text>
            );
          case "shajara":
            return (
              <text
                x={x + 11}
                y={y + 5}
                textAnchor="middle"
                fontFamily={template.fonts.native.family}
                fontSize={12}
                style={{ fill: p.soft }}
              >
                {MARHUM}
              </text>
            );
          case "album":
            return (
              <g>
                <rect
                  x={x}
                  y={y - 7}
                  width={22}
                  height={14}
                  style={{ fill: p.cardDeceased, stroke: p.edge }}
                />
                <path
                  d={`M${x + 14} ${y + 7}L${x + 22} ${y - 1}V${y + 3}L${x + 18} ${y + 7}Z`}
                  style={{ fill: p.memorial }}
                />
              </g>
            );
          default:
            return (
              <rect
                x={x}
                y={y - 6}
                width={22}
                height={12}
                rx={template.id === "botanical" ? 6 : 1}
                style={{
                  fill: p.cardDeceased,
                  stroke: template.id === "botanical" ? p.memorial : p.ink,
                }}
              />
            );
        }
      },
    });
  }
  if (use.marriedIn && template.id === "botanical") {
    items.push({
      key: "marriedIn",
      label: label("marriedIn"),
      symbol: (x, y) => (
        <rect
          x={x}
          y={y - 6}
          width={22}
          height={12}
          rx={6}
          style={{ fill: p.card, stroke: p.soft, strokeWidth: 1.5 }}
        />
      ),
    });
  }
  if (template.id === "gallery") {
    items.unshift({
      key: "eldest",
      label: label("eldest"),
      symbol: (x, y) => <circle cx={x + 11} cy={y} r={7} style={{ fill: p.accent }} />,
    });
  }
  if (use.genders) {
    items.push({ key: "male", label: label("male"), symbol: ring(p.male) });
    items.push({ key: "female", label: label("female"), symbol: ring(p.female) });
  }
  if (use.divorced) {
    items.push({
      key: "divorced",
      label: label("divorced"),
      symbol: (x, y) => (
        <g style={{ stroke: line, strokeWidth: Math.max(1.2, w * 0.6) }}>
          <line x1={x} y1={y} x2={x + 22} y2={y} />
          <line x1={x + 7} y1={y + 5} x2={x + 10} y2={y - 5} />
          <line x1={x + 12} y1={y + 5} x2={x + 15} y2={y - 5} />
        </g>
      ),
    });
  }
  if (use.adopted) {
    items.push({
      key: "adopted",
      label: label("adopted"),
      symbol: (x, y) => (
        <line
          x1={x}
          y1={y}
          x2={x + 22}
          y2={y}
          strokeDasharray={template.connectors.adoptedDash
            .split(" ")
            .map((n) => r2(Number(n) * 0.6))
            .join(" ")}
          style={{ stroke: line, strokeWidth: Math.max(1.2, w * 0.6) }}
        />
      ),
    });
  }
  if (use.unknown) {
    items.push({
      key: "unknown",
      label: label("unknown"),
      symbol: (x, y) => (
        <rect
          x={x}
          y={y - 6}
          width={22}
          height={12}
          rx={2}
          strokeDasharray="3 3"
          style={{ fill: "none", stroke: p.muted }}
        />
      ),
    });
  }
  if (use.folded) {
    items.push({
      key: "folded",
      label: label("folded"),
      symbol: (x, y) => (
        <g>
          <rect
            x={x}
            y={y - 7}
            width={22}
            height={14}
            rx={7}
            style={{ fill: p.card, stroke: p.ink }}
          />
          <text
            x={x + 11}
            y={y + 4}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            style={{ fill: p.ink }}
          >
            +
          </text>
        </g>
      ),
    });
  }
  return items;
}

function Legend({
  geo,
  template,
  palette: p,
  use,
  t,
  rtl,
  madeWith,
}: {
  geo: FrameGeometry;
  template: Template;
  palette: Palette;
  use: LegendUse;
  t: TFunction;
  rtl: boolean;
  madeWith: boolean;
}) {
  const items = legendItems(template, p, use, t);
  const font: Font = { ...template.fonts.name, size: 13, italic: false, weight: 500 };
  const box = geo.legend;
  const cy = box.y + box.height / 2;
  const widths = items.map((it) => 30 + textWidth(it.label, font) + 26);
  const total = widths.reduce((a, b) => a + b, 0);
  const credit = madeWith ? t("export.frameText.madeWith") : "";
  const creditW = credit ? textWidth(credit, font) + 24 : 0;
  // Centred, unless the credit needs the inline end; RTL lays the entries out right to left.
  const room = box.width - creditW;
  let x = rtl
    ? box.x + box.width - Math.max(0, (room - total) / 2)
    : box.x + Math.max(0, (room - total) / 2);
  const out: ReactNode[] = [];
  items.forEach((it, i) => {
    const w = widths[i]!;
    if (rtl) {
      out.push(<g key={`${it.key}-s`}>{it.symbol(x - 22, cy)}</g>);
      // The page is direction="rtl": "start" is the right edge, so the label ends at the symbol.
      out.push(
        <Text key={it.key} x={x - 30} y={cy + 4.5} font={font} fill={p.muted} anchor="start">
          {it.label}
        </Text>,
      );
      x -= w;
    } else {
      out.push(<g key={`${it.key}-s`}>{it.symbol(x, cy)}</g>);
      out.push(
        <Text key={it.key} x={x + 30} y={cy + 4.5} font={font} fill={p.muted} anchor="start">
          {it.label}
        </Text>,
      );
      x += w;
    }
  });
  return (
    <g className="stam-export__legend">
      {out}
      {credit && (
        <Text
          className="stam-export__credit"
          x={rtl ? box.x : box.x + box.width}
          y={cy + 4.5}
          font={{ ...font, size: 11 }}
          fill={p.muted}
          anchor="end"
          spacing={1}
        >
          {credit}
        </Text>
      )}
    </g>
  );
}

/** Generation numerals in the inline-start gutter, level with each row's cards. */
function Numerals({
  geo,
  layout,
  template,
  palette: p,
  rtl,
}: {
  geo: FrameGeometry;
  layout: LayoutResult;
  template: Template;
  palette: Palette;
  rtl: boolean;
}) {
  if (!geo.numerals) return null;
  const rows = [...new Set(layout.nodes.map((n) => n.y))].toSorted((a, b) => a - b);
  // Count from the eldest row, wherever it is drawn.
  const eldestFirst = template.growth === "up" ? rows.toReversed() : rows;
  const x = rtl ? geo.width - MARGIN - NUMERALS_W / 2 : MARGIN + NUMERALS_W / 2;
  const font: Font =
    template.id === "heritage"
      ? { ...template.fonts.name, size: 26, weight: 600 }
      : template.id === "gallery"
        ? { ...template.fonts.name, size: 30, weight: 300 }
        : { ...template.fonts.name, size: 16, weight: 400 };
  const fill = template.id === "heritage" ? p.accent : template.id === "gallery" ? p.muted : p.ink;
  return (
    <g className="stam-export__numerals">
      {eldestFirst.map((y, i) => {
        const cy = y + geo.dy + layout.metrics.cardH / 2;
        return (
          <g key={y}>
            {template.id === "gallery" && (
              <line
                x1={geo.stage.x}
                x2={geo.stage.x + geo.stage.width}
                y1={r2(y + geo.dy + layout.metrics.cardH + 10)}
                y2={r2(y + geo.dy + layout.metrics.cardH + 10)}
                style={{ stroke: p.ink, strokeOpacity: 0.08 }}
              />
            )}
            <Text x={x} y={cy + font.size * 0.35} font={font} fill={fill}>
              {template.id === "swiss" ? String(i + 1) : roman(i + 1)}
            </Text>
          </g>
        );
      })}
    </g>
  );
}

/** The template's page: ground, border and title block. Drawn under the tree. */
function Page({
  geo,
  template,
  palette: p,
  title,
  subtitle,
  stats,
  t,
  rtl,
}: {
  geo: FrameGeometry;
  template: Template;
  palette: Palette;
  title: string;
  subtitle: string;
  stats: { generations: number; people: number; earliest: number | null };
  t: TFunction;
  rtl: boolean;
}) {
  const { width: W, height: H } = geo;
  const tb = geo.title;
  const cx = W / 2;
  const titleFont = template.fonts.title;
  const sub: Font = { ...template.fonts.years, size: 15, italic: true, weight: 400 };
  const fitted = (s: string, f: Font, max: number) => fitText(s, max, f);
  const ground = (
    <rect className="stam-export__ground" width={W} height={H} style={{ fill: p.ground }} />
  );

  switch (template.id) {
    case "heritage": {
      const plaqueW = Math.min(tb.width * 0.7, Math.max(360, textWidth(title, titleFont) + 140));
      const y0 = tb.y + 14;
      const y1 = tb.y + tb.height - 22;
      const my = (y0 + y1) / 2;
      const corner = (x: number, y: number) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <rect
            x={-9}
            y={-9}
            width={18}
            height={18}
            style={{ fill: p.ground, stroke: p.ink, strokeWidth: 1.2 }}
          />
          <rect
            x={-9}
            y={-9}
            width={18}
            height={18}
            transform="rotate(45)"
            style={{ fill: "none", stroke: p.accent, strokeWidth: 1.2 }}
          />
          <circle r={2.4} style={{ fill: p.accent }} />
        </g>
      );
      return (
        <>
          {ground}
          <rect
            x={12}
            y={12}
            width={W - 24}
            height={H - 24}
            style={{ fill: "none", stroke: p.ink, strokeWidth: 2.4 }}
          />
          <rect
            x={19}
            y={19}
            width={W - 38}
            height={H - 38}
            style={{ fill: "none", stroke: p.accent, strokeWidth: 0.9 }}
          />
          {[19 + 5, H - 19 - 5].map((y) => (
            <line
              key={y}
              x1={30}
              x2={W - 30}
              y1={y}
              y2={y}
              strokeDasharray="1.5 9"
              strokeLinecap="round"
              style={{ stroke: p.accent, strokeWidth: 3 }}
            />
          ))}
          {[corner(19, 19), corner(W - 19, 19), corner(19, H - 19), corner(W - 19, H - 19)]}
          <path
            d={`M${cx - plaqueW / 2} ${y0}H${cx + plaqueW / 2}L${cx + plaqueW / 2 + 18} ${my}L${cx + plaqueW / 2} ${y1}H${cx - plaqueW / 2}L${cx - plaqueW / 2 - 18} ${my}Z`}
            style={{ fill: p.ground, stroke: p.ink, strokeWidth: 1.2 }}
          />
          <path
            d={`M${cx - plaqueW / 2 + 5} ${y0 + 5}H${cx + plaqueW / 2 - 5}L${cx + plaqueW / 2 + 11} ${my}L${cx + plaqueW / 2 - 5} ${y1 - 5}H${cx - plaqueW / 2 + 5}L${cx - plaqueW / 2 - 11} ${my}Z`}
            style={{ fill: "none", stroke: p.accent, strokeWidth: 0.8 }}
          />
          <Text
            className="stam-export__title"
            x={cx}
            y={my + 2}
            font={{ ...titleFont, size: 34 }}
            fill={p.ink}
          >
            {fitted(title, { ...titleFont, size: 34 }, plaqueW - 40)}
          </Text>
          <Text
            className="stam-export__subtitle"
            x={cx}
            y={my + 28}
            font={{ ...sub, size: 14, italic: false }}
            fill={p.accent}
            spacing={2}
          >
            {subtitle.toUpperCase()}
          </Text>
        </>
      );
    }
    case "botanical":
      return (
        <>
          {ground}
          <Text
            className="stam-export__title"
            x={cx}
            y={tb.y + 58}
            font={{ ...titleFont, size: 40 }}
            fill={p.ink}
          >
            {fitted(title, { ...titleFont, size: 40 }, tb.width)}
          </Text>
          <Text
            className="stam-export__subtitle"
            x={cx}
            y={tb.y + 88}
            font={{ ...sub, size: 16 }}
            fill={p.muted}
          >
            {subtitle}
          </Text>
        </>
      );
    case "gallery": {
      const statFont: Font = { ...template.fonts.name, size: 30, weight: 800 };
      const labelFont: Font = { ...template.fonts.name, size: 12, weight: 500 };
      const list = [
        { big: String(stats.generations), small: t("export.frameText.stats.generations") },
        { big: String(stats.people), small: t("export.frameText.stats.people") },
        ...(stats.earliest === null
          ? []
          : [{ big: String(stats.earliest), small: t("export.frameText.stats.earliest") }]),
      ];
      const big: Font = { ...titleFont, size: 76 };
      const startX = rtl ? W - MARGIN : MARGIN;
      const endX = rtl ? MARGIN : W - MARGIN;
      return (
        <>
          {ground}
          <Text
            className="stam-export__title"
            x={startX}
            y={tb.y + 72}
            font={big}
            fill={p.ink}
            anchor="start"
            spacing={-3}
          >
            {fitted(title, big, tb.width * 0.6)}
          </Text>
          <Text
            className="stam-export__subtitle"
            x={startX}
            y={tb.y + 100}
            font={{ ...labelFont, size: 14 }}
            fill={p.muted}
            anchor="start"
          >
            {subtitle}
          </Text>
          {list.map((s, i) => {
            const x = rtl ? endX + i * 96 : endX - (list.length - 1 - i) * 96;
            return (
              <g key={s.small}>
                <Text x={x} y={tb.y + 52} font={statFont} fill={p.ink} anchor="end">
                  {s.big}
                </Text>
                <Text x={x} y={tb.y + 70} font={labelFont} fill={p.muted} anchor="end">
                  {s.small}
                </Text>
              </g>
            );
          })}
        </>
      );
    }
    case "album": {
      const ribbonW = Math.min(
        tb.width * 0.7,
        Math.max(320, textWidth(title, titleFont) * 1.5 + 120),
      );
      const y0 = tb.y + 16;
      const h = 46;
      return (
        <>
          {ground}
          <defs>
            <pattern id="stam-linen" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 6L6 0" style={{ stroke: p.ink, strokeOpacity: 0.035 }} />
              <path d="M0 0L6 6" style={{ stroke: "#ffffff", strokeOpacity: 0.25 }} />
            </pattern>
          </defs>
          <rect width={W} height={H} style={{ fill: "url(#stam-linen)" }} />
          <path
            d={`M${cx - ribbonW / 2} ${y0}H${cx + ribbonW / 2}L${cx + ribbonW / 2 - 16} ${y0 + h / 2}L${cx + ribbonW / 2} ${y0 + h}H${cx - ribbonW / 2}L${cx - ribbonW / 2 + 16} ${y0 + h / 2}Z`}
            style={{ fill: p.accent }}
          />
          <Text
            className="stam-export__title"
            x={cx}
            y={y0 + 31}
            font={{ ...titleFont, size: 24 }}
            fill={p.onAccent}
          >
            {fitted(title, { ...titleFont, size: 24 }, ribbonW - 60)}
          </Text>
          <Text
            className="stam-export__subtitle"
            x={cx}
            y={y0 + h + 36}
            font={{ ...template.fonts.years, size: 24 }}
            fill={p.accent}
          >
            {subtitle}
          </Text>
        </>
      );
    }
    case "shajara": {
      const band = 10;
      return (
        <>
          {ground}
          <defs>
            <pattern id="stam-girih" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect width="10" height="10" style={{ fill: p.accent }} />
              <path
                d="M5 .7L6.2 3.8L9.3 5L6.2 6.2L5 9.3L3.8 6.2L.7 5L3.8 3.8Z"
                style={{ fill: "none", stroke: p.soft, strokeWidth: 0.6 }}
              />
            </pattern>
          </defs>
          <path
            d={`M6 6H${W - 6}V${H - 6}H6Z M${6 + band} ${6 + band}V${H - 6 - band}H${W - 6 - band}V${6 + band}Z`}
            fillRule="evenodd"
            style={{ fill: "url(#stam-girih)" }}
          />
          <rect
            x={6 + band + 3}
            y={6 + band + 3}
            width={W - 2 * (9 + band)}
            height={H - 2 * (9 + band)}
            style={{ fill: "none", stroke: p.soft, strokeWidth: 1.4 }}
          />
          <Text
            className="stam-export__title"
            x={cx}
            y={tb.y + 62}
            font={{ ...titleFont, size: 34 }}
            fill={p.accent}
          >
            شجرۂ نسب
          </Text>
          <Text
            className="stam-export__subtitle"
            x={cx}
            y={tb.y + 100}
            font={{ ...template.fonts.name, size: 18, italic: true }}
            fill={p.soft}
            spacing={1}
          >
            {fitted(title, { ...template.fonts.name, size: 18, italic: true }, tb.width)}
          </Text>
        </>
      );
    }
    case "swiss": {
      const f: Font = { ...template.fonts.name, size: 22, weight: 700 };
      const small: Font = { ...template.fonts.name, size: 13, weight: 400 };
      const startX = rtl ? W - MARGIN : MARGIN;
      return (
        <>
          {ground}
          <Text
            className="stam-export__title"
            x={startX}
            y={tb.y + 34}
            font={f}
            fill={p.ink}
            anchor="start"
          >
            {fitted(title, f, tb.width)}
          </Text>
          <Text
            className="stam-export__subtitle"
            x={startX}
            y={tb.y + 56}
            font={small}
            fill={p.muted}
            anchor="start"
          >
            {subtitle}
          </Text>
          <line
            x1={MARGIN}
            x2={W - MARGIN}
            y1={tb.y + tb.height - 24}
            y2={tb.y + tb.height - 24}
            style={{ stroke: p.ink, strokeWidth: 0.9 }}
          />
          <line
            x1={MARGIN}
            x2={W - MARGIN}
            y1={geo.legend.y + 6}
            y2={geo.legend.y + 6}
            style={{ stroke: p.ink, strokeWidth: 0.9 }}
          />
        </>
      );
    }
  }
}

/** Botanical: a trunk and roots under the eldest couple, with where the family began. */
function Trunk({
  geo,
  layout,
  palette: p,
  template,
  origin,
}: {
  geo: FrameGeometry;
  layout: LayoutResult;
  palette: Palette;
  template: Template;
  origin: string;
}) {
  if (template.id !== "botanical" || layout.nodes.length === 0) return null;
  const eldest = Math.min(...layout.nodes.map((n) => n.generation));
  const row = layout.nodes.filter((n) => n.generation === eldest);
  const left = Math.min(...row.map((n) => n.x));
  const right = Math.max(...row.map((n) => n.x + (n.width ?? layout.metrics.cardW)));
  const x = (left + right) / 2 + geo.dx;
  const top = row[0]!.y + geo.dy + unionYOf(layout.metrics);
  const bottom = geo.stage.y + geo.stage.height - 8;
  const spread = 70;
  return (
    <g
      className="stam-export__trunk"
      style={{ fill: "none", stroke: p.line, strokeLinecap: "round" }}
    >
      <path
        d={`M${x - 26} ${top + 36}C${x - 28} ${bottom - 60} ${x - 40} ${bottom - 30} ${x - spread} ${bottom - 8}M${x} ${top}V${bottom}M${x + 26} ${top + 36}C${x + 28} ${bottom - 60} ${x + 40} ${bottom - 30} ${x + spread} ${bottom - 8}`}
        style={{ strokeWidth: 14 }}
      />
      <path
        d={`M${x - spread} ${bottom - 8}q-30 8 -62 4M${x + spread} ${bottom - 8}q32 8 64 2M${x} ${bottom}q-14 10 -36 12M${x} ${bottom}q16 10 38 10`}
        style={{ strokeWidth: 4 }}
      />
      {origin && (
        <g>
          <rect
            x={x - textWidth(origin, { ...template.fonts.years, size: 15 }) / 2 - 16}
            y={bottom - 64}
            width={textWidth(origin, { ...template.fonts.years, size: 15 }) + 32}
            height={28}
            rx={14}
            style={{ fill: p.line, stroke: "none" }}
          />
          <Text
            x={x}
            y={bottom - 45}
            font={{ ...template.fonts.years, size: 15, italic: false, weight: 600 }}
            fill={p.ground}
            spacing={1}
          >
            {origin}
          </Text>
        </g>
      )}
    </g>
  );
}

/** Where the family began: the eldest dated birth's place and year ("Lahore · 1921"). */
export function originOf(doc: TreeDocument, layout: LayoutResult): string {
  let best: { year: number; place?: string } | null = null;
  for (const n of layout.nodes) {
    const birth = doc.persons[n.personId]?.birth;
    const year = birth?.date?.year;
    if (year === undefined) continue;
    if (!best || year < best.year) best = { year, place: birth?.place };
  }
  if (!best) return "";
  return best.place ? `${best.place.split(",")[0]!.trim()} · ${best.year}` : String(best.year);
}

export type FrameProps = {
  geo: FrameGeometry;
  layout: LayoutResult;
  doc: TreeDocument;
  template: Template;
  palette: Palette;
  title: string;
  subtitle: string;
  t: TFunction;
  rtl: boolean;
  madeWith: boolean;
};

/** Everything under the tree: page, title block, trunk and numerals. */
export function FrameUnder(props: FrameProps) {
  const { doc, layout } = props;
  const earliest = layout.nodes.reduce<number | null>((min, n) => {
    const y = doc.persons[n.personId]?.birth?.date?.year;
    return y === undefined ? min : min === null ? y : Math.min(min, y);
  }, null);
  const people = new Set(layout.nodes.map((n) => n.personId)).size;
  return (
    <g className="stam-export__frame">
      <Page {...props} stats={{ generations: layout.generationCount, people, earliest }} />
      <Trunk {...props} origin={originOf(doc, layout)} />
      <Numerals {...props} />
    </g>
  );
}

/** The legend band, drawn over the page. */
export function FrameOver(props: FrameProps) {
  return (
    <Legend
      geo={props.geo}
      template={props.template}
      palette={props.palette}
      use={legendUse(props.doc, props.layout)}
      t={props.t}
      rtl={props.rtl}
      madeWith={props.madeWith}
    />
  );
}

/** Width the title block needs, so a long family name widens the page instead of overflowing. */
export function titleWidthFor(template: Template, title: string): number {
  const f = template.fonts.title;
  const size = template.id === "gallery" ? 76 : template.id === "botanical" ? 40 : 34;
  return textWidth(title, { ...f, size }) * (template.id === "gallery" ? 1.7 : 1.3);
}
