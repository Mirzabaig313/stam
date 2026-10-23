// The signature: scrolling through the chapters moves one number, the story position, and
// every visual that carries the idea (cards, connectors, camera, ruler, caption) is derived
// from it. The position eases toward the scroll target on the ticker, so even a fast flick
// lands the way the editor re-flows: slide, then lock.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { chapters } from "@/site/content";
import { FINAL, FRAMES } from "@/site/data";
import { type Blend, CARD_W, frameAt, padded, settle } from "@/site/sample/frames";

import { clamp01, isMobile } from "./env";
import { bindLiveTree, type Camera, draw, fit, type LiveTreeView, measure } from "./liveTree";

/** The finished tree, padded: phones keep its rows in fixed places from the first chapter. */
const WHOLE = padded(FINAL.bounds, 24);

/** The people each chapter adds on its newest row, as a span of layout x (card edges). */
const ADDED = FRAMES.map((frame, i) => {
  const before = new Set(i > 0 ? FRAMES[i - 1]!.cards.map((c) => c.key) : []);
  const added = frame.cards.filter((c) => !before.has(c.key));
  const newest = Math.max(...added.map((c) => c.row));
  const xs = added.filter((c) => c.row === newest).map((c) => c.x);
  return { min: Math.min(...xs), max: Math.max(...xs) + CARD_W };
});

/**
 * The phone camera. One scale for the whole story, so the four rows are ruled in their places
 * from the start and fill as you scroll, the way a register page does. Sideways it frames the
 * current tree when it fits, and otherwise pans to keep the chapter's new people in view.
 */
function phoneCamera(live: LiveTreeView, blend: Blend, position: number): Camera {
  const { w, h } = live.size;
  const s = Math.max(0.55, Math.min(0.74, h / WHOLE.height));
  const ty = (h - WHOLE.height * s) / 2 - WHOLE.y * s;
  const b = padded(blend.bounds, 16);
  if (b.width * s <= w) return { s, tx: (w - b.width * s) / 2 - b.x * s, ty };
  const i = Math.floor(position);
  const t = settle(position - i);
  const from = ADDED[i]!;
  const to = ADDED[i + 1] ?? from;
  const min = from.min + (to.min - from.min) * t;
  const max = from.max + (to.max - from.max) * t;
  const edge = 14;
  let tx = w / 2 - ((min + max) / 2) * s;
  // Keep the new people inside the frame, then never show past the tree's own edges.
  tx = Math.min(tx, edge - min * s);
  tx = Math.max(tx, w - edge - max * s);
  tx = Math.min(-b.x * s, Math.max(w - (b.x + b.width) * s, tx));
  return { s, tx, ty };
}

/** How far into a chapter (px) its frame is complete; past it the finished frame holds. */
const transitionDistance = (span: number) => Math.min(span * 0.6, innerHeight * 0.45);

const chapterProgress = (self: ScrollTrigger) => {
  const span = self.end - self.start;
  return (self.progress * span) / transitionDistance(span);
};

export function startStage(): (() => void) | undefined {
  const section = document.querySelector<HTMLElement>("[data-chapters]");
  const stage = section?.querySelector<HTMLElement>("[data-stage]");
  const list = section?.querySelector<HTMLElement>(".chapters__list");
  if (!section || !stage || !list) return;
  const live = bindLiveTree(stage.querySelector<HTMLElement>(".live")!);
  const caption = stage.querySelector<HTMLElement>("[data-stage-caption]");
  const items = [...list.querySelectorAll<HTMLElement>("[data-chapter]")];
  const count = items.length;

  let target = 0;
  let current = 0;
  let shownCaption = -1;
  let dirty = true;

  const render = () => {
    const blend = frameAt(FRAMES, current);
    draw(
      live,
      blend,
      isMobile() ? phoneCamera(live, blend, current) : fit(live, blend.bounds, 1.6),
    );
  };

  const line = "center";
  const setChapter = (k: number, local: number) => {
    target = k === 0 ? 0 : k - 1 + clamp01(local);
    if (k !== shownCaption && caption) {
      const set = (sel: string, text: string) => {
        const el = caption.querySelector<HTMLElement>(sel);
        if (el) el.textContent = text;
      };
      const forward = k > shownCaption;
      set("[data-caption-count]", String(k + 1));
      set("[data-caption-title]", chapters[k]!.title);
      set("[data-caption-text]", chapters[k]!.text);
      for (const step of caption.querySelectorAll<HTMLElement>("[data-caption-step]")) {
        step.classList.toggle("is-current", Number(step.dataset.captionStep) === k);
      }
      shownCaption = k;
      // The caption settles in sideways, like the cards: the numeral first, then the words,
      // from the side the story is moving toward.
      const from = forward ? 1 : -1;
      gsap.fromTo(
        caption.querySelector("[data-caption-count]"),
        { x: 64 * from, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.8, ease: "expo.out", overwrite: true },
      );
      gsap.fromTo(
        caption.querySelectorAll("[data-caption-title], [data-caption-text]"),
        { x: 28 * from, autoAlpha: 0 },
        {
          x: 0,
          autoAlpha: 1,
          duration: 0.7,
          delay: 0.06,
          ease: "expo.out",
          stagger: 0.05,
          overwrite: true,
        },
      );
      items.forEach((item, i) => item.classList.toggle("is-current", i === k));
    }
  };
  // One trigger per chapter: its own scroll distance drives its own transition.
  const triggers = items.map((item, k) =>
    ScrollTrigger.create({
      trigger: item,
      start: `top ${line}`,
      end: k === count - 1 ? `bottom bottom` : `bottom ${line}`,
      invalidateOnRefresh: true,
      onUpdate: (self) => setChapter(k, chapterProgress(self)),
      onToggle: (self) => {
        if (self.isActive) setChapter(k, chapterProgress(self));
        else if (k === 0 && self.direction < 0) setChapter(0, 0);
      },
    }),
  );

  const onRefresh = () => {
    measure(live);
    dirty = true;
  };
  ScrollTrigger.addEventListener("refresh", onRefresh);

  const tick = () => {
    const k = 1 - Math.pow(0.86, gsap.ticker.deltaRatio());
    const next = current + (target - current) * k;
    if (Math.abs(target - next) < 0.0005) {
      if (current === target && !dirty) return;
      current = target;
    } else {
      current = next;
    }
    dirty = false;
    render();
  };

  // Only run while the chapters are on screen.
  const visible = ScrollTrigger.create({
    trigger: section,
    start: "top bottom",
    end: "bottom top",
    onToggle: (self) => (self.isActive ? gsap.ticker.add(tick) : gsap.ticker.remove(tick)),
  });
  render();

  return () => {
    for (const t of triggers) t.kill();
    visible.kill();
    gsap.ticker.remove(tick);
    ScrollTrigger.removeEventListener("refresh", onRefresh);
  };
}
