import type { LayoutResult } from "@/core/layout/types";
import { childrenOf, partnersOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

/** Card hues for the branch and generation colour modes (`--hue-0` … `--hue-5` in tokens.css). */
export const HUE_COUNT = 6;

const wrap = (n: number) => ((n % HUE_COUNT) + HUE_COUNT) % HUE_COUNT;

/** The hue of a generation row; rows past the sixth start again. */
export function generationHue(generation: number): number {
  return wrap(generation);
}

/**
 * Branch colour mode: each child of the layout's root starts a branch (in sibling order, across
 * the root's unions), every descendant inherits it, and partners take the branch of the person they
 * married. Someone reachable through two branches (cousins who married) keeps the first. The root
 * and the root's partners have no branch. Only people drawn in `layout` are listed.
 */
export function branchOf(doc: TreeDocument, layout: LayoutResult): Record<string, number> {
  const shown = new Set(layout.nodes.map((n) => n.personId));
  const top = layout.nodes.reduce<(typeof layout.nodes)[number] | undefined>(
    (best, n) =>
      n.kind === "blood" && (best === undefined || n.generation < best.generation) ? n : best,
    undefined,
  );
  if (!top) return {};
  const rootId = top.personId;

  const branch = new Map<string, number>();
  const queue: string[] = [];
  childrenOf(doc, rootId).forEach((child, i) => {
    if (child === rootId || branch.has(child)) return;
    branch.set(child, wrap(i));
    queue.push(child);
  });
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const hue = branch.get(id)!;
    for (const child of childrenOf(doc, id)) {
      if (child === rootId || branch.has(child)) continue;
      branch.set(child, hue);
      queue.push(child);
    }
  }

  const out: Record<string, number> = {};
  for (const [id, hue] of branch) if (shown.has(id)) out[id] = hue;
  // Partners: drawn beside the blood person, so they wear that person's branch.
  for (const id of shown) {
    if (id === rootId || out[id] !== undefined) continue;
    const partner = partnersOf(doc, id).find((p) => branch.has(p));
    if (partner !== undefined) out[id] = branch.get(partner)!;
  }
  return out;
}
