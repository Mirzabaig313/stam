import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
});

const errors = result.logs.filter((log) => log.level === "error");
for (const log of result.logs) console.error(String(log));
if (!result.success || errors.length > 0) {
  console.error(`Build failed with ${errors.length} error(s).`);
  process.exit(1);
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

// Hosting files (_redirects, _headers, ...) are copied verbatim next to the build output.
for (const name of await readdir(publicDir)) {
  await cp(join(publicDir, name), join(outdir, name), { recursive: true });
}

console.log(`Built ${result.outputs.length} files into dist/`);

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
