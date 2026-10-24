import { useSyncExternalStore } from "react";

import { site } from "@/site/content";
import { chooseTheme, currentTheme, type SiteTheme } from "@/site/theme";

/** Calls back when the theme on screen may have changed: data-theme or the system's scheme. */
function subscribe(onChange: () => void): () => void {
  const query = matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  return () => {
    query.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/**
 * Light and dark switch in the header. The prerendered page cannot know the theme, so CSS picks
 * the icon from the theme on screen and the label follows once hydrated.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    () => currentTheme(),
    () => "light" as SiteTheme,
  );

  const next: SiteTheme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? site.theme.toDark : site.theme.toLight;

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => chooseTheme(next)}
    >
      {/* Shown in light: the moon, the way to dark. */}
      <svg className="theme-toggle__moon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z" />
      </svg>
      {/* Shown in dark: the sun, the way to light. */}
      <svg className="theme-toggle__sun" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" />
      </svg>
    </button>
  );
}
