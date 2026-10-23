// Smooth scroll on one clock: Lenis is driven by gsap.ticker and ScrollTrigger reads Lenis.
// Under reduced motion the page keeps native scrolling and nothing here runs.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

import { prefersReducedMotion } from "./env";

gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;
const listeners = new Set<(y: number, velocity: number) => void>();

export function initScroll() {
  if (lenis || prefersReducedMotion()) return;
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1, touchMultiplier: 1.2, anchors: true });
  lenis.on("scroll", (l: Lenis) => {
    ScrollTrigger.update();
    for (const fn of listeners) fn(l.scroll, l.velocity);
  });
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/** Scroll position feed. Without Lenis it falls back to ScrollTrigger's own scroll events. */
export function onScroll(fn: (y: number, velocity: number) => void) {
  if (lenis) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  let last = scrollY;
  const st = ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate: () => {
      fn(scrollY, scrollY - last);
      last = scrollY;
    },
  });
  return () => st.kill();
}
