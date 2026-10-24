import type { CardMetrics, SizeOf } from "@/core/layout/constants";

// One card's own look, on top of its template: its size, fill, border, corners, padding and the
// style of its name and years lines. Kept per tree on this device (repo `cardStyles:<treeId>`),
// changed from the card and text toolbars, applied on the canvas and in every export.

export const TEXT_PRESETS = ["h1", "h2", "h3", "body", "small"] as const;
export type TextPreset = (typeof TEXT_PRESETS)[number];

/** How much bigger or smaller than the template's own size each preset draws a line. */
export const PRESET_SCALE: Record<TextPreset, number> = {
  h1: 1.5,
  h2: 1.28,
  h3: 1.12,
  body: 1,
  small: 0.86,
};

export const ALIGNS = ["start", "center", "end"] as const;
export type Align = (typeof ALIGNS)[number];

export type LineStyle = {
  preset?: TextPreset;
  colour?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: Align;
};

export const LINES = ["name", "years"] as const;
export type LineKey = (typeof LINES)[number];

export type CardStyle = {
  /** Percent of the template's card at the look's size. */
  size?: { w: number; h: number };
  fill?: string;
  border?: { colour: string; width: number };
  /** Corner radius in px (shaped faces soften their shape with it). */
  radius?: number;
  /** Space between the card's edge and its photo and text, in px. */
  padding?: number;
  lines?: Partial<Record<LineKey, LineStyle>>;
};

/** Person id to that person's card style. */
export type CardStyles = Readonly<Record<string, CardStyle>>;

export const SIZE_PERCENT = { min: 60, max: 250 } as const;
export const RADIUS_PX = { min: 0, max: 48 } as const;
export const PADDING_PX = { min: 0, max: 32 } as const;
export const BORDER_PX = { min: 0, max: 4 } as const;

/** The repo setting a tree's card styles are stored under. */
export const cardStylesKey = (treeId: string) => `cardStyles:${treeId}`;

const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const colour = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim());
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

function lineStyle(raw: unknown): LineStyle | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: LineStyle = {};
  if (oneOf(TEXT_PRESETS, r.preset)) out.preset = r.preset;
  if (colour(r.colour)) out.colour = r.colour.toLowerCase();
  if (typeof r.bold === "boolean") out.bold = r.bold;
  if (typeof r.italic === "boolean") out.italic = r.italic;
  if (typeof r.underline === "boolean") out.underline = r.underline;
  if (oneOf(ALIGNS, r.align)) out.align = r.align;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A card style from anything stored: known fields with usable values only; undefined if empty. */
export function normalizeCardStyle(raw: unknown): CardStyle | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: CardStyle = {};
  const size = r.size as { w?: unknown; h?: unknown } | undefined;
  if (size && num(size.w) && num(size.h)) {
    out.size = {
      w: clamp(Math.round(size.w), SIZE_PERCENT),
      h: clamp(Math.round(size.h), SIZE_PERCENT),
    };
  }
  if (colour(r.fill)) out.fill = r.fill.toLowerCase();
  const border = r.border as { colour?: unknown; width?: unknown } | undefined;
  if (border && colour(border.colour) && num(border.width)) {
    out.border = { colour: border.colour.toLowerCase(), width: clamp(border.width, BORDER_PX) };
  }
  if (num(r.radius)) out.radius = clamp(r.radius, RADIUS_PX);
  if (num(r.padding)) out.padding = clamp(r.padding, PADDING_PX);
  if (typeof r.lines === "object" && r.lines !== null) {
    const lines: Partial<Record<LineKey, LineStyle>> = {};
    for (const key of LINES) {
      const style = lineStyle((r.lines as Record<string, unknown>)[key]);
      if (style) lines[key] = style;
    }
    if (Object.keys(lines).length > 0) out.lines = lines;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeCardStyles(raw: unknown): CardStyles {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, CardStyle> = {};
  for (const [id, value] of Object.entries(raw)) {
    const style = normalizeCardStyle(value);
    if (style) out[id] = style;
  }
  return out;
}

/** The card sizes the layout takes: each resized card's percent of the template card, in px. */
export function sizesFor(styles: CardStyles, metrics: CardMetrics): SizeOf | undefined {
  const resized = Object.entries(styles).filter(([, s]) => s.size);
  if (resized.length === 0) return undefined;
  const px = new Map(
    resized.map(([id, s]) => [
      id,
      {
        w: Math.round((metrics.cardW * s.size!.w) / 100),
        h: Math.round((metrics.cardH * s.size!.h) / 100),
      },
    ]),
  );
  return (personId) => px.get(personId);
}

/** `style` with `patch` merged in: line styles field by field; `undefined` values remove a field. */
export function mergeCardStyle(
  style: CardStyle | undefined,
  patch: CardStyle,
): CardStyle | undefined {
  const lines = { ...style?.lines };
  for (const key of LINES) {
    if (patch.lines && key in patch.lines) lines[key] = { ...lines[key], ...patch.lines[key] };
  }
  return normalizeCardStyle({ ...style, ...patch, lines });
}

/** The styles with one person's style replaced (undefined removes it). */
export function withCardStyle(
  styles: CardStyles,
  personId: string,
  style: CardStyle | undefined,
): CardStyles {
  const next = { ...styles };
  if (style) next[personId] = style;
  else delete next[personId];
  return next;
}
