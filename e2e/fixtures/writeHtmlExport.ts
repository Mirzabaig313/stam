/**
 * Writes an interactive HTML export of the fixture tree to the path in argv[2].
 *
 * The exporter is bundled and minified first, exactly as the production build ships it, so the
 * Playwright spec exercises the viewer source as it reads after minification.
 * Run with: bun e2e/fixtures/writeHtmlExport.ts <out.html>
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureMeta, fixturePeople, fixtureSvg } from "../../tests/fixtures/exportSvg";

const out = process.argv[2];
if (!out) throw new Error("usage: bun e2e/fixtures/writeHtmlExport.ts <out.html>");

const outdir = await mkdtemp(join(tmpdir(), "stam-html-export-"));
try {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "../../src/export/html/index.ts")],
    outdir,
    minify: true,
    target: "browser",
    format: "esm",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new AggregateError(result.logs, "bundling the exporter failed");
  const entry = result.outputs.find((o) => o.kind === "entry-point")!;
  const { toHtml } = (await import(entry.path)) as typeof import("../../src/export/html");
  await writeFile(out, toHtml(fixtureSvg, fixturePeople, fixtureMeta));
} finally {
  await rm(outdir, { recursive: true, force: true });
}
