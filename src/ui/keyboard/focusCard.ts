/** The canvas card (its role=button group) of a layout node, when it is rendered. */
export function cardElement(nodeId: string): HTMLElement | null {
  const id = nodeId.replace(/["\\]/g, "\\$&");
  return document.querySelector<HTMLElement>(`[data-node-id="${id}"] > .stam-card`);
}

/** Focuses a node's card. False when the card is not rendered (culled off screen). */
export function focusCard(nodeId: string): boolean {
  const card = cardElement(nodeId);
  if (!card) return false;
  card.focus();
  return true;
}

/**
 * The layout node the keyboard is on: a focused card, or a card's quick-add handles (which carry
 * `data-handles-for`). Null when the focus is elsewhere.
 */
export function nodeIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const card = target.closest("[data-node-id]");
  if (card) return card.getAttribute("data-node-id");
  return target.closest("[data-handles-for]")?.getAttribute("data-handles-for") ?? null;
}
