import { type CardMetrics, COUPLE_GAP, GAP, MIN_ROW_GAP } from "@/core/layout/constants";

import type { Look, Spacing, TemplateId } from "./look";

/** A template's card at 100 %: its size and the space between its rows. */
export type BaseMetrics = {
  cardW: number;
  cardH: number;
  rowGap: number;
  /** Couple lines below the card top, when not at half its height. */
  unionY?: number;
};

/**
 * Card sizes at 100 %. Names fill the cards: about 21 px type on a 230 px card, so a printed tree
 * reads at arm's length. Gallery stands its medallion above the name, so its card is tall and narrow.
 */
export const BASE_METRICS: Record<TemplateId, BaseMetrics> = {
  album: { cardW: 230, cardH: 104, rowGap: 68 },
  heritage: { cardW: 230, cardH: 112, rowGap: 64 },
  botanical: { cardW: 230, cardH: 100, rowGap: 76 },
  gallery: { cardW: 210, cardH: 164, rowGap: 60, unionY: 44 },
  shajara: { cardW: 230, cardH: 128, rowGap: 76 },
  swiss: { cardW: 230, cardH: 96, rowGap: 64 },
};

export const SPACING_FACTOR: Record<Spacing, number> = { tight: 0.75, normal: 1, airy: 1.4 };

/** How a card's box answers the text size: text mostly needs height, a little width. */
const TEXT_WIDTH_SHARE = 0.4;
const TEXT_HEIGHT_SHARE = 0.6;

/** Scales for drawing a card face: `card` for everything, `text` on top of it for type. */
export type FaceScale = { card: number; text: number };

export function faceScale(look: Look): FaceScale {
  return { card: look.cardSize / 100, text: look.textSize / 100 };
}

/** The layout metrics for a look: the template's card, sized, with its gaps spaced. */
export function metricsFor(look: Look): CardMetrics {
  const base = BASE_METRICS[look.template];
  const { card: s, text: t } = faceScale(look);
  const f = SPACING_FACTOR[look.spacing];
  const cardW = Math.round(base.cardW * s * (1 - TEXT_WIDTH_SHARE + TEXT_WIDTH_SHARE * t));
  const cardH = Math.round(base.cardH * s * (1 - TEXT_HEIGHT_SHARE + TEXT_HEIGHT_SHARE * t));
  const rowGap = Math.max(MIN_ROW_GAP, Math.round(base.rowGap * s * f));
  const metrics: CardMetrics = {
    cardW,
    cardH,
    coupleGap: Math.round(COUPLE_GAP * s * f),
    gap: Math.round(GAP * s * f),
    rowH: cardH + rowGap,
  };
  if (base.unionY !== undefined) metrics.unionY = Math.round(base.unionY * s);
  return metrics;
}
