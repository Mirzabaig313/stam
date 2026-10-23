// Applies a blended engine frame to the LiveTree markup: card transforms, connector paths,
// and a camera that fits the tree into its view. Pure DOM writes; called from the ticker.

import { edgeClass, edgePath } from "@/site/components/Tree";
import { type Blend, type Box, padded, rowCentre } from "@/site/sample/frames";

import { clamp01 } from "./env";

export type Camera = { s: number; tx: number; ty: number };

export type LiveTreeView = {
  root: HTMLElement;
  view: HTMLElement;
  world: HTMLElement;
  cards: Map<string, HTMLElement>;
  edges: Map<string, SVGPathElement>;
  marks: HTMLElement[];
  size: { w: number; h: number };
};

export function bindLiveTree(root: HTMLElement): LiveTreeView {
  const view = root.querySelector<HTMLElement>("[data-view]")!;
  const world = root.querySelector<HTMLElement>("[data-world]")!;
  const cards = new Map(
    [...root.querySelectorAll<HTMLElement>("[data-card]")].map((el) => [el.dataset.card!, el]),
  );
  const edges = new Map(
    [...root.querySelectorAll<SVGPathElement>("[data-edge]")].map((el) => [el.dataset.edge!, el]),
  );
  const marks = [...root.querySelectorAll<HTMLElement>(".live__ruler [data-row]")];
  const live: LiveTreeView = { root, view, world, cards, edges, marks, size: { w: 0, h: 0 } };
  measure(live);
  return live;
}

export function measure(live: LiveTreeView) {
  const r = live.view.getBoundingClientRect();
  live.size = { w: r.width, h: r.height };
}

/** Fits `bounds` into the view, centred, never larger than `maxScale`. */
export function fit(live: LiveTreeView, bounds: Box, maxScale: number, pad = 32): Camera {
  const b = padded(bounds, pad);
  const { w, h } = live.size;
  const s = Math.min(w / b.width, h / b.height, maxScale);
  return { s, tx: (w - b.width * s) / 2 - b.x * s, ty: (h - b.height * s) / 2 - b.y * s };
}

/** Writes one frame. `lift` marks a card as picked up (drag demo). */
export function draw(live: LiveTreeView, blend: Blend, camera: Camera, lift?: string) {
  const { s, tx, ty } = camera;
  live.world.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;
  // Level of detail, as in the editor: full cards, then names only, then initials.
  live.root.classList.toggle("lod-low", s < 0.5);
  live.root.classList.toggle("lod-mid", s >= 0.5 && s < 0.74);
  live.root.style.setProperty("--s", s.toFixed(3));

  const seen = new Set<string>();
  for (const card of blend.cards) {
    const el = live.cards.get(card.key);
    if (!el) continue;
    seen.add(card.key);
    el.style.transform = `translate3d(${card.x}px, ${card.y}px, 0)`;
    el.style.opacity = String(card.opacity);
    el.style.visibility = card.opacity > 0 ? "visible" : "hidden";
    el.classList.toggle("is-lifted", card.key === lift);
  }
  for (const [key, el] of live.cards) {
    if (!seen.has(key)) {
      el.style.opacity = "0";
      el.style.visibility = "hidden";
    }
  }

  const drawn = new Set<string>();
  for (const edge of blend.edges) {
    const el = live.edges.get(edge.id);
    if (!el) continue;
    drawn.add(edge.id);
    el.setAttribute("d", edgePath(edge.points, edge.kind, edge.status));
    const cls = edgeClass(edge);
    if (el.getAttribute("class") !== cls) el.setAttribute("class", cls);
    const solid = cls === "edge";
    if (edge.draw < 1 && solid) {
      // The connector draws itself along its route once the cards have locked.
      el.setAttribute("pathLength", "1");
      el.style.strokeDasharray = `${edge.draw} 1`;
      el.style.opacity = edge.draw > 0 ? "1" : "0";
    } else {
      el.removeAttribute("pathLength");
      el.style.strokeDasharray = "";
      el.style.opacity = String(edge.draw);
    }
  }
  for (const [id, el] of live.edges) {
    if (!drawn.has(id)) el.style.opacity = "0";
  }

  live.marks.forEach((mark, row) => {
    const y = ty + rowCentre(row) * s;
    mark.style.transform = `translate3d(0, ${y}px, 0) translateY(-50%)`;
    mark.style.opacity = String(clamp01(blend.rows - row));
  });
}
