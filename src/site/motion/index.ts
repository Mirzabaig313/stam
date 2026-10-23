// Client motion for the public pages. Everything runs on gsap.ticker; nothing here runs under
// reduced motion except state that keeps the page usable.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { startDrag } from "./drag";
import { isTouch, prefersReducedMotion } from "./env";
import { initScroll, onScroll } from "./scroll";
import { startStage } from "./stage";

gsap.registerPlugin(ScrollTrigger);

/** The header slides away while reading down and returns on the way up. */
function headerStepsAside(stepAside = true) {
  const header = document.querySelector<HTMLElement>("[data-header]");
  if (!header) return;
  let last = 0;
  onScroll((y) => {
    if (Math.abs(y - last) < 6) return;
    const away = stepAside && y > 160 && y > last && !header.contains(document.activeElement);
    document.documentElement.classList.toggle("header-away", away);
    document.documentElement.classList.toggle("header-solid", y > 24);
    last = y;
  });
}

/**
 * The hero tree leans a few pixels toward the pointer. With the pointer still, it holds still:
 * the intro and the looping drag demo carry the life (DESIGN.md, "Idle"). Off screen and under
 * reduced motion it does nothing.
 */
function heroLean() {
  const figure = document.querySelector<HTMLElement>("[data-hero-tree]");
  const lean = figure?.querySelector<HTMLElement>("[data-lean]");
  if (!figure || !lean) return;
  const aim = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };
  if (!isTouch()) {
    addEventListener(
      "pointermove",
      (e: PointerEvent) => {
        aim.x = e.clientX / innerWidth - 0.5;
        aim.y = e.clientY / innerHeight - 0.5;
      },
      { passive: true },
    );
  }
  const tick = () => {
    const k = 1 - Math.pow(0.94, gsap.ticker.deltaRatio());
    now.x += (aim.x - now.x) * k;
    now.y += (aim.y - now.y) * k;
    const x = now.x * 14;
    const y = now.y * 6;
    lean.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
  };
  ScrollTrigger.create({
    trigger: figure,
    start: "top bottom",
    end: "bottom top",
    onToggle: (self) => (self.isActive ? gsap.ticker.add(tick) : gsap.ticker.remove(tick)),
  });
}

/**
 * Leaving a page: the content slides sideways and fades (the rows move off the register), then
 * the browser navigates; the view transition in site.css brings the next page in from the other
 * side while the header stays put.
 */
function pageLeave() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const link = (e.target as Element | null)?.closest("a");
    if (!link || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname) return;
    e.preventDefault();
    document.documentElement.classList.add("is-leaving");
    setTimeout(() => location.assign(url.href), 360);
  });
  // Back/forward from the cache must not show a page that already left.
  addEventListener("pageshow", (e: PageTransitionEvent) => {
    if (e.persisted) document.documentElement.classList.remove("is-leaving");
  });
}

let started = false;

export function startMotion() {
  if (started) return;
  started = true;
  const root = document.documentElement;
  root.classList.add("js", "is-booted");
  if (prefersReducedMotion()) {
    // No smooth scroll, no scrubbing, no idle: only the header's hairline follows the scroll.
    root.classList.remove("motion");
    headerStepsAside(false);
    return;
  }
  root.classList.add("motion");
  initScroll();
  headerStepsAside();
  pageLeave();
  heroLean();
  startStage();
  startDrag();
  // Fonts change line heights; measure the triggers again once they are in.
  void document.fonts?.ready.then(() => ScrollTrigger.refresh());
  requestAnimationFrame(() => ScrollTrigger.refresh());
}
