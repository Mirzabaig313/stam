// `bun run scripts/bundle-budget.ts`: the first load of /app (app.html, its stylesheets, its
// scripts and everything they import statically) must stay within 250 KB gzip, and the export
// libraries (jsPDF, svg2pdf.js, fontkit, the embedded font base64) must only arrive through
// `import()`. scripts/build.ts runs this after every build. Font files are not counted: they
// are already compressed and load only when text is drawn with them.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const BUDGET_BYTES = 250 * 1024;

/** Text that only the lazily loaded export code contains. */
const HEAVY: [marker: string, what: string][] = [
  ["jsPDF", "jsPDF"],
  ["svg2pdf", "svg2pdf.js"],
  ['"gvar"', "fontkit"],
  ["d09GMg", "embedded font base64"],
];

export type LoadedFile = { name: string; bytes: Uint8Array<ArrayBuffer>; gzip: number };

const local = (url: string) => url.replace(/^\//, "");

/** app.html and every file it pulls in before any dynamic `import()` runs. */
export async function firstLoad(
  dist: string,
  page: string,
): Promise<{ files: LoadedFile[]; gzip: number }> {
  const html = await readFile(join(dist, page), "utf8");
  const queue = [
    ...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="(\/[^"]+\.(?:js|css))"/g),
  ].map((m) => local(m[1]!));
  const seen = new Map<string, LoadedFile>();
  const add = (name: string, bytes: Uint8Array<ArrayBuffer>) =>
    seen.set(name, { name, bytes, gzip: Bun.gzipSync(bytes).length });
  add(page, new TextEncoder().encode(html));
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    const bytes = new Uint8Array(await readFile(join(dist, name)));
    add(name, bytes);
    if (!name.endsWith(".js")) continue;
    const text = new TextDecoder().decode(bytes);
    // Static imports only: `import{a}from"/x.js"` and `import"/x.js"`, never `import("/x.js")`.
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*)"(\/[^"]+\.js)"/g)) {
      queue.push(local(m[1]!));
    }
  }
  const files = [...seen.values()];
  return { files, gzip: files.reduce((n, f) => n + f.gzip, 0) };
}

export async function checkBudget(
  dist: string,
  page: string,
  budget = BUDGET_BYTES,
): Promise<{ gzip: number; files: LoadedFile[]; problems: string[] }> {
  const { files, gzip } = await firstLoad(dist, page);
  const problems: string[] = [];
  if (gzip > budget)
    problems.push(`${page} first load is ${gzip} B gzip, over the ${budget} B budget`);
  for (const file of files) {
    const text = new TextDecoder().decode(file.bytes);
    for (const [marker, what] of HEAVY) {
      if (text.includes(marker)) problems.push(`${file.name} loads up front but has ${what}`);
    }
  }
  return { gzip, files, problems };
}

if (import.meta.main) {
  const dist = join(import.meta.dir, "..", "dist");
  const { gzip, files, problems } = await checkBudget(dist, "app.html");
  for (const f of files.toSorted((a, b) => b.gzip - a.gzip)) {
    console.log(`  ${(f.gzip / 1024).toFixed(1).padStart(7)} KB  ${f.name}`);
  }
  console.log(
    `/app first load: ${(gzip / 1024).toFixed(1)} KB gzip (budget ${BUDGET_BYTES / 1024} KB)`,
  );
  for (const problem of problems) console.error(`Bundle budget: ${problem}`);
  if (problems.length > 0) process.exit(1);
}
