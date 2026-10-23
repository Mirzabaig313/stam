// Browser entry for the public pages. Production pages arrive prerendered and are hydrated;
// the dev server sends an empty shell, so the page is rendered here instead.
import "@fontsource-variable/archivo/wdth.css";
import "./site.css";

import { StrictMode, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { PAGE_META } from "./head";
import { startMotion } from "./motion";
import { type PageName, SitePage } from "./pages";

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
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) root.classList.add("motion");
  document.title = PAGE_META[page].title;
  createRoot(el).render(app);
}
