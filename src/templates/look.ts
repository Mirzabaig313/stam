// A tree's look: which template draws it and the three size controls. Saved per tree on this
// device (see `src/ui/store/editorStore.ts`), applied to the editor and to every export.

export const TEMPLATE_IDS = [
  "album",
  "heritage",
  "botanical",
  "gallery",
  "shajara",
  "swiss",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const SPACINGS = ["tight", "normal", "airy"] as const;
export type Spacing = (typeof SPACINGS)[number];

export type Look = {
  template: TemplateId;
  /** Percent: the whole card (box, photo, text) together. */
  cardSize: number;
  /** Percent: text only; the card grows to fit it. */
  textSize: number;
  spacing: Spacing;
};

export const CARD_SIZE = { min: 80, max: 140, step: 5 } as const;
export const TEXT_SIZE = { min: 85, max: 130, step: 5 } as const;

export const DEFAULT_LOOK: Look = {
  template: "album",
  cardSize: 100,
  textSize: 100,
  spacing: "normal",
};

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** A percent snapped to the control's steps and clamped to its range; the default when unusable. */
function percent(v: unknown, range: { min: number; max: number; step: number }): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 100;
  const snapped = Math.round(v / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, snapped));
}

/** A look from anything stored: known values only, the rest from `DEFAULT_LOOK`. */
export function normalizeLook(raw: unknown): Look {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_LOOK };
  const r = raw as Record<string, unknown>;
  return {
    template: isOneOf(TEMPLATE_IDS, r.template) ? r.template : DEFAULT_LOOK.template,
    cardSize: percent(r.cardSize, CARD_SIZE),
    textSize: percent(r.textSize, TEXT_SIZE),
    spacing: isOneOf(SPACINGS, r.spacing) ? r.spacing : DEFAULT_LOOK.spacing,
  };
}

/** The repo setting a tree's look is stored under. */
export const lookKey = (treeId: string) => `look:${treeId}`;
