// Renders the stress family and the 40-person family in every template, light and print, as
// framed poster SVGs into .shots/templates/, plus an index.html to look at them side by side.
// With a Chromium on the machine it also writes a PNG of the index (Playwright's cached one).
//
//   bun run scripts/render-templates.ts
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { layoutFamily } from "@/core/layout/family";
import { growUpward } from "@/core/layout/flip";
import { renderTreeSvg } from "@/export/render/renderTreeSvg";
import type { ExportOptions } from "@/export/types";
import { i18n } from "@/i18n";
import { loadAllFaces, TEMPLATES } from "@/templates";
import { DEFAULT_LOOK, type Look, TEMPLATE_IDS } from "@/templates/look";
import { metricsFor } from "@/templates/metrics";
import { bigFamily, stressFamily } from "@/templates/samples";

await loadAllFaces();
const out = join(import.meta.dir, "..", ".shots", "templates");
await mkdir(out, { recursive: true });

const OPTS: ExportOptions = {
  scope: "whole",
  theme: "light",
  includeDates: true,
  includePhotos: false,
  showRuler: false,
  privacy: false,
  background: "solid",
  frame: true,
};

const files: string[] = [];
for (const [label, make] of [
  ["stress", stressFamily],
  ["big", bigFamily],
] as const) {
  for (const id of TEMPLATE_IDS) {
    const doc = make();
    const look: Look = { ...DEFAULT_LOOK, template: id };
    const raw = layoutFamily(doc, { rootId: doc.rootPersonId!, metrics: metricsFor(look) });
    const layout = TEMPLATES[id].growth === "up" ? growUpward(raw) : raw;
    const dir = TEMPLATES[id].preferredDirection ?? "ltr";
    const { svg } = renderTreeSvg(
      { doc, layout, viewRootId: null, selectedId: null, photos: {}, look },
      { ...OPTS, look, privacy: label === "stress" },
      i18n.t.bind(i18n),
      { dir },
    );
    const name = `${label}-${id}.svg`;
    await writeFile(join(out, name), svg);
    files.push(name);
  }
}

const html = `<!doctype html><meta charset="utf-8"><title>Stam templates</title>
<style>body{margin:24px;font:14px system-ui;background:#ddd}h2{margin:28px 0 8px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
img{width:100%;height:auto;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.15)}</style>
${["stress", "big"]
  .map(
    (label) =>
      `<h2>${label}</h2><div class="grid">${files
        .filter((f) => f.startsWith(label))
        .map((f) => `<figure><img src="${f}"><figcaption>${f}</figcaption></figure>`)
        .join("")}</div>`,
  )
  .join("")}`;
await writeFile(join(out, "index.html"), html);
console.log(`Wrote ${files.length} SVGs and index.html to ${out}`);

// A PNG of the index, when Playwright's headless Chromium is in its cache.
const cache = join(homedir(), "Library", "Caches", "ms-playwright");
const shell = await readdir(cache)
  .then((names) => names.find((n) => n.startsWith("chromium_headless_shell")))
  .catch(() => undefined);
if (shell) {
  const glob = new Bun.Glob("**/chrome-headless-shell");
  for await (const bin of glob.scan({ cwd: join(cache, shell), absolute: true })) {
    const png = join(out, "index.png");
    Bun.spawnSync([
      bin,
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1600,4200",
      "--virtual-time-budget=6000",
      `--screenshot=${png}`,
      `file://${join(out, "index.html")}`,
    ]);
    console.log(`Screenshot: ${png}`);
    break;
  }
}
