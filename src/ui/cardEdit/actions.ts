import { createStore } from "zustand/vanilla";

import type { LayoutResult } from "@/core/layout/types";
import { childrenOf, partnersOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import {
  type CardStyle,
  type CardStyles,
  type LineKey,
  mergeCardStyle,
  SIZE_PERCENT,
  withCardStyle,
} from "@/templates/cardStyle";

/** What the card toolbars are editing: a line of the selected card, and the copied style. */
export type CardEditState = {
  /** The selected card's line under the text toolbar; null for the card toolbar. */
  line: { personId: string; key: LineKey } | null;
  /** "Copy style" keeps it here for "Paste style". */
  clipboard: CardStyle | null;
};

export const cardEdit = createStore<CardEditState>(() => ({ line: null, clipboard: null }));

/** A percent of the template card, kept inside the resize limits. */
export const clampPercent = (v: number) =>
  Math.round(Math.min(SIZE_PERCENT.max, Math.max(SIZE_PERCENT.min, v)));

/** One person's style with `patch` merged in. */
export function patched(styles: CardStyles, personId: string, patch: CardStyle): CardStyles {
  return withCardStyle(styles, personId, mergeCardStyle(styles[personId], patch));
}

/** One person's style with some fields taken out (back to the template's). */
export function without(
  styles: CardStyles,
  personId: string,
  fields: readonly (keyof CardStyle)[],
): CardStyles {
  const style = { ...styles[personId] };
  for (const field of fields) delete style[field];
  return withCardStyle(styles, personId, Object.keys(style).length > 0 ? style : undefined);
}

/** The person, everyone descended from them, and all their partners: the branch they head. */
export function branchOf(doc: TreeDocument, personId: string): string[] {
  const seen = new Set([personId]);
  const queue = [personId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const partner of partnersOf(doc, id)) seen.add(partner);
    for (const child of childrenOf(doc, id)) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return [...seen];
}

/** Everyone drawn on the person's row of the layout. */
export function generationOf(layout: LayoutResult, personId: string): string[] {
  const row = layout.nodes.find((n) => n.personId === personId)?.generation;
  return [...new Set(layout.nodes.filter((n) => n.generation === row).map((n) => n.personId))];
}

/**
 * `style` given to each of `people`, replacing what they had. A size is left out: copying a look
 * across a branch should not make every card the same size as the one it came from.
 */
export function applyTo(
  styles: CardStyles,
  people: readonly string[],
  style: CardStyle | undefined,
) {
  let next = styles;
  for (const id of people) {
    const keep = next[id]?.size;
    const given = style ? { ...style } : undefined;
    if (given) delete given.size;
    const merged = given || keep ? { ...given, ...(keep ? { size: keep } : {}) } : undefined;
    next = withCardStyle(next, id, merged && Object.keys(merged).length > 0 ? merged : undefined);
  }
  return next;
}
