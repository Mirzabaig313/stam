// Runs before first paint (a blocking script: the CSP forbids inline ones, and scripts/build.ts
// puts it at the top of app.html's head). It applies the settings cached by
// src/ui/settings/settings.ts, so a dark or Arabic interface never flashes light or English while
// the app's module and IndexedDB load. Only known values are applied.
(function () {
  var root = document.documentElement;
  try {
    var s = JSON.parse(localStorage.getItem("stam:settings") || "null");
    if (s && typeof s === "object") {
      if (["light", "dark", "classic", "print"].indexOf(s.theme) >= 0) {
        root.setAttribute("data-theme", s.theme);
      }
      if (["gender", "branch", "generation"].indexOf(s.colorMode) >= 0) {
        root.setAttribute("data-color-mode", s.colorMode);
      }
      if (["en", "ur", "ar"].indexOf(s.language) >= 0) {
        root.lang = s.language;
        root.dir = s.language === "en" ? "ltr" : "rtl";
      }
    }
    var motion = localStorage.getItem("stam:motion");
    if (motion === "reduce" || motion === "full") root.setAttribute("data-motion", motion);
  } catch {
    // Storage refused or the cache is broken: the defaults stand, and the app reads the repo.
  }
})();
