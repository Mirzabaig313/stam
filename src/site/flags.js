// Runs before first paint (a blocking script, because the CSP forbids inline ones). Styles that
// hide things until motion reveals them are gated on html.motion, so without JavaScript or under
// reduced motion everything stays visible.
document.documentElement.classList.add("js");
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.documentElement.classList.add("motion");
}
