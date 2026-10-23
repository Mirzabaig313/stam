// Prerenders the public pages into static HTML after `scripts/build.ts` has bundled them.
// Input: dist/index.html, the bundled shell (hashed script and stylesheet tags, empty #site).
// Output: dist/index.html, dist/privacy.html (Cloudflare Pages serves it at /privacy) and
// dist/404.html (served for every unknown path), each with its own head and full markup.
// The client bundle hydrates the markup and adds motion.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

process.env.NODE_ENV = "production";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

const [{ prerender }, { createElement }, { SitePage }, { headFor }] = await Promise.all([
  import("react-dom/static"),
  import("react"),
  import("../src/site/pages"),
  import("../src/site/head"),
]);
type PageName = Parameters<typeof SitePage>[0]["page"];

const shell = await readFile(join(dist, "index.html"), "utf8");
if (!shell.includes("<!-- site:head -->") || !shell.includes('<div id="site"></div>')) {
  console.error("Prerender failed: dist/index.html is missing the site:head or #site markers.");
  process.exit(1);
}

// A blocking script that flags html.js/.motion before first paint (no inline scripts: CSP).
const flags = await Bun.file(join(root, "src/site/flags.js")).text();
const flagsName = `site-flags.${new Bun.CryptoHasher("sha1").update(flags).digest("hex").slice(0, 8)}.js`;
await writeFile(join(dist, flagsName), flags);

// Preload the latin cut of Archivo: it carries the hero headline, the largest text on screen.
// The build names extracted fonts by content hash, so hash the source file the same way.
const latin = await Bun.file(
  join(root, "node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2"),
).bytes();
const latinName = `${new Bun.CryptoHasher("sha1").update(latin).digest("hex").slice(0, 10)}.woff2`;
const fonts = await readdir(join(dist, "fonts")).catch(() => [] as string[]);
const fontPreload = fonts.includes(latinName)
  ? `<link rel="preload" href="/fonts/${latinName}" as="font" type="font/woff2" crossorigin />`
  : "";
if (!fontPreload)
  console.warn("Prerender: latin Archivo font not found in dist/fonts; no preload.");

async function render(page: PageName): Promise<string> {
  const { prelude } = await prerender(createElement(SitePage, { page }));
  return new Response(prelude).text();
}

const PAGES: { page: PageName; file: string }[] = [
  { page: "home", file: "index.html" },
  { page: "privacy", file: "privacy.html" },
  { page: "notFound", file: "404.html" },
];

for (const { page, file } of PAGES) {
  const markup = await render(page);
  const head = [
    headFor(page),
    fontPreload,
    `<script src="/${flagsName}"></script>`,
    // Cross-document page transitions; the animations live in site.css.
    "<style>@view-transition{navigation:auto}</style>",
  ]
    .filter(Boolean)
    .join("\n    ");
  const html = shell
    .replace('<html lang="en">', `<html lang="en" data-page="${page}">`)
    .replace("<!-- site:head -->", head)
    .replace('<div id="site"></div>', `<div id="site">${markup}</div>`);
  await writeFile(join(dist, file), html);
  console.log(`Prerendered ${file} (${(html.length / 1024).toFixed(1)} KB)`);
}
