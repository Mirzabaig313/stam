// Media queries and the one easing family. Read at call time, never at import, so the modules
// are safe to import while prerendering.

/** The app's "Reduce motion" choice (<html data-motion>, set by flags.js) wins; otherwise the OS. */
export const prefersReducedMotion = () => {
  const chosen = document.documentElement.getAttribute("data-motion");
  if (chosen === "reduce") return true;
  if (chosen === "full") return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
};
export const isMobile = () => matchMedia("(max-width: 767px)").matches;

/** expo-out for everything that settles; expo-in-out only for page-sized moves. */
export const ease = { out: "expo.out", inOut: "expo.inOut", soft: "power3.out" } as const;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
