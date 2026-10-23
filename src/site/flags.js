// Runs before first paint (a blocking script, because the CSP forbids inline ones). Styles that
// hide things until motion reveals them are gated on html.motion, so without JavaScript or under
// reduced motion everything stays visible.
var root = document.documentElement;
root.classList.add("js");
// The theme chosen in the app's settings (cached by src/ui/settings/settings.ts): the public pages
// have light and dark only. Only a theme the user picked counts (themeChosen), not the app's
// default. No choice, no attribute: site.css follows prefers-color-scheme.
try {
  var chosen = JSON.parse(localStorage.getItem("stam:settings") || "null");
  if (chosen && chosen.themeChosen === true && typeof chosen.theme === "string") {
    root.setAttribute("data-theme", chosen.theme === "dark" ? "dark" : "light");
  }
} catch {
  // Storage refused or the cache is broken: follow the system.
}
// "Reduce motion" chosen in the app's settings (cached by src/ui/settings/motion.ts) wins over the
// OS: "reduce" stills the page, "full" animates it anyway. No choice: the OS decides.
var motion = null;
try {
  motion = localStorage.getItem("stam:motion");
} catch {
  // Storage refused: follow the system.
}
if (motion === "reduce" || motion === "full") root.setAttribute("data-motion", motion);
else motion = null;
if (
  motion === "full" ||
  (motion !== "reduce" && !matchMedia("(prefers-reduced-motion: reduce)").matches)
) {
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
