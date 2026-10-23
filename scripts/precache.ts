// The app shell the service worker precaches (see src/sw.ts): the page under its route and every
// file it loads, statically or through `import()`, with the fonts its stylesheets name. The
// version is a hash of all of their contents, so any change to the shell is a new version.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Local, root-relative URLs only: never a `https://` canonical link or a `data:` URL. */
const LOCAL = String.raw`\/(?!\/)[^"'()\s]+`;
const IN_HTML = new RegExp(String.raw`<(?:script|link)\b[^>]*?\b(?:src|href)="(${LOCAL})"`, "g");
const IN_JS = new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*)"(${LOCAL}\.(?:js|css))"`, "g");
const IN_CSS = new RegExp(String.raw`url\(\s*["']?(${LOCAL})["']?\s*\)`, "g");

export async function appShell(
  dist: string,
  page: string,
  route: string,
): Promise<{ files: string[]; version: string }> {
  const html = await readFile(join(dist, page), "utf8");
  const hasher = new Bun.CryptoHasher("sha256").update(html);
  const queue = [...html.matchAll(IN_HTML)].map((m) => m[1]!);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const bytes = await readFile(join(dist, url));
    hasher.update(url).update(bytes);
    const pattern = url.endsWith(".js") ? IN_JS : url.endsWith(".css") ? IN_CSS : null;
    if (!pattern) continue;
    for (const m of new TextDecoder().decode(bytes).matchAll(pattern)) queue.push(m[1]!);
  }
  return {
    files: [route, ...seen].toSorted(),
    version: hasher.digest("hex").slice(0, 12),
  };
}

/** Files /app needs offline that are easy to miss: the classic boot script and every font. */
const MUST_PRECACHE = /^(?:app-boot\.[^/]+\.js|(?:fonts\/)?[^/]+\.woff2)$/;

/**
 * What the shell lacks among the boot script and fonts in `distFiles` (paths relative to dist).
 * The build fails on any: offline, a missing font would fall back silently, a missing boot
 * script would fail the page.
 */
export function shellGaps(shell: readonly string[], distFiles: readonly string[]): string[] {
  const have = new Set(shell);
  return distFiles
    .filter((f) => MUST_PRECACHE.test(f))
    .map((f) => `/${f}`)
    .filter((url) => !have.has(url))
    .toSorted();
}
