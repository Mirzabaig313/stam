// Client motion for the public pages. Everything runs on gsap.ticker; nothing here runs under
// reduced motion except state that keeps the page usable.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { startDrag } from "./drag";
import { isMobile, prefersReducedMotion } from "./env";
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
 * Leaving a page: five rows of ink slide across the screen one after another and lock, then the
 * browser navigates. The next page opens covered (flags.js) and its rows slide off the same way,
 * row by row, while the header stays put. "Settle into rows" at page size.
 */
const LEAVE_MS = 540;

function pageLeave() {
  const root = document.documentElement;
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const link = (e.target as Element | null)?.closest("a");
    if (!link || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname) return;
    e.preventDefault();
    root.classList.remove("vt-enter");
    root.classList.add("is-leaving");
    try {
      sessionStorage.setItem("stam:curtain", String(Date.now()));
    } catch {
      // Storage refused: the next page simply opens without its curtain.
    }
    setTimeout(() => location.assign(url.href), LEAVE_MS);
  });
  // Back/forward from the cache: the page left covered, so it comes back the way a new one does.
  addEventListener("pageshow", (e: PageTransitionEvent) => {
    if (!e.persisted || !root.classList.contains("is-leaving")) return;
    root.classList.remove("is-leaving", "vt-enter");
    void root.offsetWidth;
    root.classList.add("vt-enter");
  });
}

/**
 * Phones read the chapters as five stacked frames. Each frame's new people slide in sideways
 * and lock onto their rows when it comes into view, then the new connectors draw (site.css).
 */
function chapterFrames() {
  if (!isMobile()) return;
  document.documentElement.classList.add("frames-reveal");
  for (const chapter of document.querySelectorAll<HTMLElement>("[data-chapter]")) {
    ScrollTrigger.create({
      trigger: chapter,
      start: "top 72%",
      once: true,
      onEnter: () => chapter.classList.add("is-in"),
    });
  }
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
  if (isMobile()) chapterFrames();
  else startStage();
  startDrag();
  // Fonts change line heights; measure the triggers again once they are in.
  void document.fonts?.ready.then(() => ScrollTrigger.refresh());
  requestAnimationFrame(() => ScrollTrigger.refresh());
}
