// The public pages' own light/dark choice, made with the header's switch. It wins over the theme
// cached from the app's settings, which the app rewrites from IndexedDB on every load, so a choice
// stored there would not stick. flags.js reads the same key before first paint.
export const SITE_THEME_KEY = "stam:site-theme";

export type SiteTheme = "light" | "dark";

/** The site's grounds, for `<meta name="theme-color">` (site.css --ground). */
const GROUND: Record<SiteTheme, string> = { light: "#f4f5f2", dark: "#0f110f" };

/** The theme on screen: data-theme when set, else the system's. */
export function currentTheme(root: HTMLElement = document.documentElement): SiteTheme {
  const set = root.getAttribute("data-theme");
  if (set === "dark" || set === "light") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme stored by the switch, if any. */
export function storedTheme(): SiteTheme | undefined {
  try {
    const value = localStorage.getItem(SITE_THEME_KEY);
    return value === "dark" || value === "light" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Applies a theme to the page and remembers it for the next visit. */
export function chooseTheme(theme: SiteTheme, root: HTMLElement = document.documentElement): void {
  root.setAttribute("data-theme", theme);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = GROUND[theme];
  }
  try {
    localStorage.setItem(SITE_THEME_KEY, theme);
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
}
