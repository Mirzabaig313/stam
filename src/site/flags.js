// Runs before first paint (a blocking script, because the CSP forbids inline ones). Styles that
// hide things until motion reveals them are gated on html.motion, so without JavaScript or under
// reduced motion everything stays visible.
var root = document.documentElement;
root.classList.add("js");
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  root.classList.add("motion");
  // Arriving from another page of the site: its rows covered the screen as it left, so this page
  // starts covered and its rows wipe away one by one (site.css, "page transitions").
  try {
    var left = Number(sessionStorage.getItem("stam:curtain"));
    sessionStorage.removeItem("stam:curtain");
    if (left && Date.now() - left < 4000) root.classList.add("vt-enter");
  } catch {
    // Storage refused: open without the curtain.
  }
}
