import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { injectHeadScript } from "./headScript";
import { findLoweredLogical, logicalCssPlugin, restoreLogical } from "./logical-css";
import { appShell, shellGaps } from "./precache";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");
const publicDir = join(root, "public");

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/index.html"), join(root, "src/app.html")],
  outdir,
  minify: true,
  splitting: true,
  sourcemap: "linked",
  // app.html is served at nested paths such as /app/t/xyz, so asset URLs must be absolute.
  publicPath: "/",
  define: { "process.env.NODE_ENV": '"production"' },
  // Keeps inline insets logical instead of lowered to left/right by `:lang()` (logical-css.ts).
  plugins: [logicalCssPlugin],
});

const errors = result.logs.filter((log) => log.level === "error");
for (const log of result.logs) console.error(String(log));
if (!result.success || errors.length > 0) {
  console.error(`Build failed with ${errors.length} error(s).`);
  process.exit(1);
}

// Undo logicalCssPlugin's disguise, then refuse any CSS whose sides still depend on `:lang()`.
for (const output of result.outputs.filter((o) => o.path.endsWith(".css"))) {
  const css = restoreLogical(await readFile(output.path, "utf8"));
  const lowered = findLoweredLogical(css);
  if (lowered.length > 0) {
    console.error(
      `Build failed: ${output.path} has logical properties lowered to left/right by :lang(), ` +
        `which ignores dir. Use [dir="rtl"] or a property logical-css.ts protects.\n${lowered[0]}`,
    );
    process.exit(1);
  }
  await writeFile(output.path, css);
}

// Bun inlines CSS font files as data: URLs, but the CSP says `font-src 'self'`, which refuses
// them. Write each inlined font out as a file and point the stylesheet at it.
const fontDir = join(outdir, "fonts");
for (const output of result.outputs.filter((o) => o.path.endsWith(".css"))) {
  const css = await readFile(output.path, "utf8");
  const fonts = [...css.matchAll(/url\(data:font\/(woff2?);base64,([A-Za-z0-9+/=]+)\)/g)];
  if (fonts.length === 0) continue;
  await mkdir(fontDir, { recursive: true });
  let rewritten = css;
  for (const [whole, ext, data] of fonts) {
    const bytes = Buffer.from(data!, "base64");
    const name = `${new Bun.CryptoHasher("sha1").update(bytes).digest("hex").slice(0, 10)}.${ext}`;
    await writeFile(join(fontDir, name), bytes);
    rewritten = rewritten.replace(whole!, `url(/fonts/${name})`);
  }
  await writeFile(output.path, rewritten);
}

// The CSP refuses data: fonts, so a font left inline would silently not load in production.
for (const output of result.outputs.filter((o) => o.path.endsWith(".css"))) {
  if ((await readFile(output.path, "utf8")).includes("data:font")) {
    console.error(`Build failed: ${output.path} still has an inlined data:font URL.`);
    process.exit(1);
  }
}

// /app's blocking boot script: applies the cached theme, colour mode, language and motion before the
// first paint (src/app/boot.js). Bun would fold a classic <script> into the module, so it goes in here.
const boot = await readFile(join(root, "src/app/boot.js"), "utf8");
const bootName = `app-boot.${new Bun.CryptoHasher("sha1").update(boot).digest("hex").slice(0, 8)}.js`;
await writeFile(join(outdir, bootName), boot);
const appHtmlPath = join(outdir, "app.html");
await writeFile(appHtmlPath, injectHeadScript(await readFile(appHtmlPath, "utf8"), `/${bootName}`));

// Hosting files (_redirects, _headers, ...) are copied verbatim next to the build output.
for (const name of await readdir(publicDir)) {
  await cp(join(publicDir, name), join(outdir, name), { recursive: true });
}

console.log(`Built ${result.outputs.length} files into dist/`);

// The service worker (src/sw.ts) precaches /app's shell: the page and everything it loads. Built
// after the fonts are written out, so the stylesheets it hashes are the final ones.
const shell = await appShell(outdir, "app.html", "/app");
const gaps = shellGaps(shell.files, await readdir(outdir, { recursive: true }));
if (gaps.length > 0) {
  console.error(`Build failed: the service worker would not precache ${gaps.join(", ")}`);
  process.exit(1);
}
const sw = await Bun.build({
  entrypoints: [join(root, "src/sw.ts")],
  outdir,
  naming: "[name].[ext]",
  minify: true,
  target: "browser",
  define: {
    STAM_PRECACHE: JSON.stringify(shell.files),
    STAM_VERSION: JSON.stringify(shell.version),
  },
});
for (const log of sw.logs) console.error(String(log));
if (!sw.success) {
  console.error("Build failed: the service worker did not build.");
  process.exit(1);
}
console.log(`Service worker ${shell.version} precaches ${shell.files.length} files`);

// /app's first load stays within its gzip budget, with the export libraries left to import().
const budget = Bun.spawnSync(["bun", "run", join(root, "scripts/bundle-budget.ts")], {
  stdout: "inherit",
  stderr: "inherit",
});
if (budget.exitCode !== 0) {
  console.error("Build failed: the /app bundle budget is exceeded.");
  process.exit(1);
}

// The public pages (/, /privacy, 404) become static HTML; the client bundle hydrates them.
const prerender = Bun.spawnSync(["bun", "run", join(root, "scripts/prerender.ts")], {
  stdout: "inherit",
  stderr: "inherit",
});
if (prerender.exitCode !== 0) {
  console.error("Build failed: prerender did not finish.");
  process.exit(1);
}
