// The signature: scrolling through the chapters moves one number, the story position, and
// every visual that carries the idea (cards, connectors, camera, ruler, caption) is derived
// from it. The position eases toward the scroll target on the ticker, so even a fast flick
// lands the way the editor re-flows: slide, then lock.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { chapters } from "@/site/content";
import { FRAMES } from "@/site/data";
import { type Blend, CARD_W, frameAt, padded, settle } from "@/site/sample/frames";

import { clamp01, isMobile } from "./env";
import { bindLiveTree, type Camera, draw, fit, type LiveTreeView, measure } from "./liveTree";

/** The people each chapter adds on its newest row, as a span of layout x (card edges). */
const ADDED = FRAMES.map((frame, i) => {
  const before = new Set(i > 0 ? FRAMES[i - 1]!.cards.map((c) => c.key) : []);
  const added = frame.cards.filter((c) => !before.has(c.key));
  const newest = Math.max(...added.map((c) => c.row));
  const xs = added.filter((c) => c.row === newest).map((c) => c.x);
  return { min: Math.min(...xs), max: Math.max(...xs) + CARD_W };
});

/**
 * The phone camera. It frames the tree as it stands, as large as the screen allows; when a row
 * grows wider than the phone it zooms out only as far as the chapter's newest row needs, and
 * pans to keep those people whole. Returns the tree's height on screen too, so the caption can
 * sit right under the last row.
 */
function phoneCamera(
  live: LiveTreeView,
  blend: Blend,
  position: number,
  room: number,
): Camera & { height: number } {
  const { w } = live.size;
  const b = padded(blend.bounds, 16);
  const i = Math.floor(position);
  const t = settle(position - i);
  const from = ADDED[i]!;
  const to = ADDED[i + 1] ?? from;
  const min = from.min + (to.min - from.min) * t;
  const max = from.max + (to.max - from.max) * t;
  const whole = Math.min(1.1, w / b.width, (room * 0.8) / b.height);
  const newest = Math.min(0.74, Math.max(0.4, (w - 28) / (max - min)));
  const s = Math.max(whole, newest);
  const height = b.height * s;
  if (b.width * s <= w) return { s, tx: (w - b.width * s) / 2 - b.x * s, ty: -b.y * s, height };
  const edge = 14;
  let tx = w / 2 - ((min + max) / 2) * s;
  // Keep the newest row whole, then never show past the tree's own edges.
  tx = Math.min(tx, edge - min * s);
  tx = Math.max(tx, w - edge - max * s);
  tx = Math.min(-b.x * s, Math.max(w - (b.x + b.width) * s, tx));
  return { s, tx, ty: -b.y * s, height };
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
    if (!isMobile()) {
      if (caption) caption.style.translate = "";
      draw(live, blend, fit(live, blend.bounds, 1.6));
      return;
    }
    // Phones: the tree and its caption are one block, centred in the screen. The caption
    // follows the last row up and down (a transform, so nothing re-lays out).
    const gap = 28;
    const captionH = caption?.offsetHeight ?? 0;
    const room = live.size.h + captionH;
    const cam = phoneCamera(live, blend, current, live.size.h - gap);
    const top = Math.max(0, (room - (cam.height + gap + captionH)) / 2);
    draw(live, blend, { s: cam.s, tx: cam.tx, ty: cam.ty + top });
    if (caption) {
      caption.style.translate = `0 ${(top + cam.height + gap - live.size.h).toFixed(1)}px`;
    }
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
