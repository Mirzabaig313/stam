// Browser entry for the public pages. Production pages arrive prerendered and are hydrated;
// the dev server sends an empty shell, so the page is rendered here instead.
import "@fontsource-variable/archivo/wdth.css";
import "./site.css";

import { StrictMode, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { PAGE_META } from "./head";
import { startMotion } from "./motion";
import { prefersReducedMotion } from "./motion/env";
import { type PageName, SitePage } from "./pages";
import { storedTheme } from "./theme";

function pageFromPath(path: string): PageName {
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/") return "home";
  if (clean === "/privacy") return "privacy";
  return "notFound";
}

function Boot({ page }: { page: PageName }) {
  useEffect(() => startMotion(), []);
  return <SitePage page={page} />;
}

const root = document.documentElement;
const page = (root.dataset.page as PageName | undefined) ?? pageFromPath(location.pathname);
const el = document.getElementById("site")!;
const app = (
  <StrictMode>
    <Boot page={page} />
  </StrictMode>
);

if (el.firstElementChild) {
  hydrateRoot(el, app);
} else {
  // Dev: no prerendered markup and no flags script, so set both up before the first render.
  root.classList.add("js");
  try {
    const chosen = JSON.parse(localStorage.getItem("stam:settings") ?? "null") as {
      theme?: unknown;
    } | null;
    const siteTheme = storedTheme();
    if (siteTheme) root.setAttribute("data-theme", siteTheme);
    else if (typeof chosen?.theme === "string") {
      root.setAttribute("data-theme", chosen.theme === "dark" ? "dark" : "light");
    }
  } catch {
    // no cached theme: follow the system
  }
  try {
    const motion = localStorage.getItem("stam:motion");
    if (motion === "reduce" || motion === "full") root.setAttribute("data-motion", motion);
  } catch {
    // no cached choice: follow the system
  }
  if (!prefersReducedMotion()) root.classList.add("motion");
  document.title = PAGE_META[page].title;
  createRoot(el).render(app);
}
