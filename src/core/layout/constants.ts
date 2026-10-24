// Family-view geometry, in px.

export const CARD_W = 180;
export const CARD_H = 72;
/** Between the cards of one couple block. */
export const COUPLE_GAP = 32;
/** Minimum space between neighbouring subtrees on the same row. */
export const GAP = 40;
/** Distance from one generation row's top to the next. */
export const ROW_H = 136;

/**
 * The card size and spacing a layout is built with. A tree's template and size controls pick them
 * (`src/templates/metrics.ts`); every layout carries the metrics it was built with, so whatever
 * draws it reads card sizes from the layout and never from the constants above.
 */
export type CardMetrics = {
  cardW: number;
  cardH: number;
  coupleGap: number;
  gap: number;
  /** Row top to row top; at least `cardH + MIN_ROW_GAP`. */
  rowH: number;
  /** Height of couple lines below the card top; half the card when left out. */
  unionY?: number;
};

/** Where couple lines cross between two cards. */
export const unionYOf = (m: CardMetrics) => m.unionY ?? m.cardH / 2;

/** A card's own size, in layout px. */
export type CardSize = { w: number; h: number };

/** A person's card size when it was resized on its own; undefined for the template's card. */
export type SizeOf = (personId: string) => CardSize | undefined;

/** Every card's size: its own, or the metrics' card. */
export function sizerFor(m: CardMetrics, sizes?: SizeOf): (personId: string) => CardSize {
  const card: CardSize = { w: m.cardW, h: m.cardH };
  return sizes ? (personId) => sizes(personId) ?? card : () => card;
}

/** The smallest space between two rows: room for sibling bars and over-brackets. */
export const MIN_ROW_GAP = 48;

export const DEFAULT_METRICS: CardMetrics = {
  cardW: CARD_W,
  cardH: CARD_H,
  coupleGap: COUPLE_GAP,
  gap: GAP,
  rowH: ROW_H,
};
