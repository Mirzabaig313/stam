import { i18n } from "@/i18n";

import type { ExportPerson, RenderedSvg } from "../types";
import { sha256Base64 } from "./sha256";
import { type ViewerData, viewerSource } from "./viewer";

export type HtmlMeta = { title: string; generatedAt: string; lang: string; dir: "ltr" | "rtl" };
export type Translate = (key: string, options?: Record<string, unknown>) => string;

const defaultT: Translate = (key, options) => i18n.t(key, options ?? {}) as string;

/** Escapes text for an HTML text node or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON that is safe inside `<script type="application/json">`: `<`, `>` and `&` become
 * `<`-style escapes, so no "</script>" or "<!--" can appear, and the line separators
 * that older parsers choke on are escaped too.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/** Keeps only the fields the viewer reads, all as strings. */
function cleanPerson(p: ExportPerson): ExportPerson {
  const person: ExportPerson = {
    id: String(p.id),
    name: String(p.name),
    lifespan: String(p.lifespan ?? ""),
    details: (p.details ?? []).map((d) => ({ label: String(d.label), value: String(d.value) })),
  };
  if (p.nativeName) person.nativeName = String(p.nativeName);
  return person;
}

/** The SVG goes in as markup, so it must be the renderer's output: no prolog, no scripts. */
function inlineSvg(svg: string): string {
  const body = svg.replace(/^﻿?\s*<\?xml[^>]*\?>\s*/i, "").replace(/^\s*<!DOCTYPE[^>]*>\s*/i, "");
  if (/<script\b/i.test(body)) throw new Error("toHtml: the SVG must not contain a <script>");
  return body;
}

function pluralLabels(lang: string, t: Translate): Record<string, string> {
  let categories: string[] = ["one", "other"];
  try {
    categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  } catch {
    /* unknown locale: keep English categories */
  }
  const other = t("export.html.matches_other", { n: "{n}" });
  const labels: Record<string, string> = { other };
  for (const category of categories) {
    labels[category] = t(`export.html.matches_${category}`, { n: "{n}", defaultValue: other });
  }
  return labels;
}

// #world is placed physically (top/left): the viewer's pan/zoom maths is in screen axes.
const CSS = `
:root{--ground:#f4f5f2;--paper:#fff;--ink:#111311;--muted:#5a615b;--line:rgba(17,19,17,.14);
--accent:#2b47f5;--ease:cubic-bezier(.16,1,.3,1);color-scheme:light}
*{box-sizing:border-box}
html,body{block-size:100%;margin:0}
body{display:grid;grid-template-rows:auto 1fr auto;background:var(--ground);color:var(--ink);
font:15px/1.4 "Archivo Variable",system-ui,sans-serif;overflow:hidden}
bdi,.name{unicode-bidi:isolate}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 16px;
border-block-end:1px solid var(--line);background:var(--ground);position:relative;z-index:2}
h1{font-size:17px;font-weight:650;margin:0;margin-inline-end:auto;overflow-wrap:anywhere}
.find{position:relative;flex:1 1 220px;max-inline-size:340px}
.find input{inline-size:100%;font:inherit;padding:7px 10px;border:1px solid var(--line);
border-radius:6px;background:var(--paper);color:inherit}
.status{margin:0;min-inline-size:6ch;color:var(--muted);font-size:13px}
.results{position:absolute;inset-inline:0;inset-block-start:calc(100% + 4px);margin:0;padding:4px;
list-style:none;background:var(--paper);border:1px solid var(--line);border-radius:6px;
max-block-size:50vh;overflow:auto;box-shadow:0 8px 24px rgba(17,19,17,.12)}
.results button{display:flex;justify-content:space-between;gap:12px;inline-size:100%;
text-align:start;font:inherit;padding:6px 8px;border:0;border-radius:4px;background:none;
color:inherit;cursor:pointer}
.results button:hover,.results button:focus-visible{background:var(--ground)}
.life{color:var(--muted);font-size:13px;white-space:nowrap}
.tools{display:flex;gap:4px}
.tools button,.close{font:inherit;min-inline-size:36px;block-size:36px;padding:0 10px;
border:1px solid var(--line);border-radius:6px;background:var(--paper);color:inherit;cursor:pointer}
.tools button:hover,.close:hover{border-color:var(--ink)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#stage{position:relative;overflow:hidden;touch-action:none;cursor:grab;user-select:none;
-webkit-user-select:none}
#stage.is-dragging{cursor:grabbing}
#world{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
#world.glide{transition:transform .35s var(--ease)}
#world>svg{display:block}
[data-person-id]{cursor:pointer;transition:opacity .2s}
#stage.is-searching [data-person-id]:not(.is-match){opacity:.22}
[data-person-id].is-match{filter:drop-shadow(0 0 3px rgba(43,71,245,.55))}
[data-person-id].is-current,[data-person-id].is-selected{filter:drop-shadow(0 0 2px var(--accent))
drop-shadow(0 0 6px rgba(43,71,245,.6))}
[data-person-id]:focus{outline:none}
[data-person-id]:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.panel{position:fixed;inset-block-start:64px;max-block-size:calc(100% - 80px);inset-inline-end:16px;inline-size:min(340px,calc(100% - 32px));
overflow:auto;padding:16px 18px;background:var(--paper);border:1px solid var(--line);border-radius:8px;
box-shadow:0 12px 32px rgba(17,19,17,.16);z-index:3}
.panel[hidden],[hidden]{display:none}
.panel h2{font-size:20px;font-weight:650;margin:0 0 4px;padding-inline-end:44px;overflow-wrap:anywhere}
.panel h2:focus{outline:none}
.close{position:absolute;inset-block-start:12px;inset-inline-end:12px}
.native{margin:0 0 4px;font-size:17px;unicode-bidi:isolate}
.panel .lifespan{margin:0 0 12px;color:var(--muted)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}
dt{color:var(--muted)}
dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
footer{padding:6px 16px;font-size:12px;color:var(--muted);border-block-start:1px solid var(--line)}
.vh{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (max-width:600px){.panel{inset-block-start:auto;inset-block-end:16px;inset-inline:16px;inline-size:auto;max-block-size:60%}}
@media (prefers-reduced-motion:reduce){#world.glide,[data-person-id]{transition:none}}
@media print{.bar,.panel,footer{display:none}body{display:block;overflow:visible}
#stage{overflow:visible}#world{position:static;transform:none!important}}
`
  .trim()
  .replace(/\n/g, "");

/**
 * One self-contained, offline HTML file: the tree SVG plus an inline viewer with zoom, pan,
 * search and click-for-details. People travel as escaped JSON and are rendered with
 * `textContent`; a Content-Security-Policy allows only the viewer's own script (by hash) and
 * forbids every network request.
 */
export function toHtml(
  r: RenderedSvg,
  people: ExportPerson[],
  meta: HtmlMeta,
  t: Translate = defaultT,
): string {
  const lang = LANG.test(meta.lang) ? meta.lang : "en";
  const dir = meta.dir === "rtl" ? "rtl" : "ltr";
  const script = viewerSource();
  if (/<\/script/i.test(script)) throw new Error("toHtml: viewer source would close its tag");
  const data: ViewerData = {
    lang,
    people: people.map(cleanPerson),
    matches: pluralLabels(lang, t),
    noMatches: t("export.html.noMatches"),
  };
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${sha256Base64(script)}'`,
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const e = escapeHtml;
  const width = Math.max(1, Math.round(r.width));
  const height = Math.max(1, Math.round(r.height));

  return `<!doctype html>
<html lang="${e(lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="Stam">
<title>${e(meta.title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="bar">
<h1><bdi>${e(meta.title)}</bdi></h1>
<div class="find" role="search">
<label class="vh" for="q">${e(t("export.html.searchLabel"))}</label>
<input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="${e(t("export.html.searchPlaceholder"))}" aria-describedby="status" aria-controls="results">
<ul id="results" class="results" aria-label="${e(t("export.html.results"))}" hidden></ul>
</div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<div class="tools" role="group" aria-label="${e(t("export.html.tools"))}">
<button type="button" data-action="zoom-out" aria-label="${e(t("export.html.zoomOut"))}" title="${e(t("export.html.zoomOut"))}">−</button>
<button type="button" data-action="zoom-in" aria-label="${e(t("export.html.zoomIn"))}" title="${e(t("export.html.zoomIn"))}">+</button>
<button type="button" data-action="fit">${e(t("export.html.fit"))}</button>
</div>
</header>
<main id="stage" tabindex="0" aria-label="${e(t("export.html.treeLabel"))}">
<div id="world" data-width="${width}" data-height="${height}" style="inline-size:${width}px;block-size:${height}px">${inlineSvg(r.svg)}</div>
</main>
<aside id="panel" class="panel" aria-labelledby="panel-name" hidden>
<button type="button" class="close" data-action="close" aria-label="${e(t("export.html.close"))}">×</button>
<h2 id="panel-name" class="name" tabindex="-1"></h2>
<p id="panel-native" class="native" hidden></p>
<p id="panel-life" class="lifespan" hidden></p>
<dl id="panel-details" aria-label="${e(t("export.html.details"))}" hidden></dl>
</aside>
<footer>${e(t("export.html.generated", { date: meta.generatedAt }))}</footer>
<script type="application/json" id="stam-data">${jsonForScript(data)}</script>
<script>${script}</script>
</body>
</html>
`;
}
