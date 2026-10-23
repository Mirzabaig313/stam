// Static server for dist/ that emulates Cloudflare Pages `_redirects` (status 200 rewrites),
// `_headers`, extensionless `.html` pages (/privacy serves privacy.html) and the 404 page
// (404.html with status 404), so Playwright tests see the same routing as production.
import { stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const port = Number(process.env.PORT ?? 4400);

type Rewrite = { matches: (path: string) => boolean; to: string };
type HeaderRule = { matches: (path: string) => boolean; headers: [string, string][] };

/** `*` matches any run of characters, as in Cloudflare's patterns. */
function globToMatcher(pattern: string): (path: string) => boolean {
  const source = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`^${source.join(".*")}$`);
  return (path) => regex.test(path);
}

async function readOptional(name: string): Promise<string> {
  const file = Bun.file(join(dist, name));
  return (await file.exists()) ? file.text() : "";
}

function parseRedirects(text: string): Rewrite[] {
  const rules: Rewrite[] = [];
  for (const line of text.split("\n")) {
    const [from, to, status] = line.trim().split(/\s+/);
    if (!from || from.startsWith("#") || !to) continue;
    if (status !== "200") throw new Error(`serve-dist only emulates 200 rewrites: ${line}`);
    rules.push({ matches: globToMatcher(from), to });
  }
  return rules;
}

function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = { matches: globToMatcher(line.trim()), headers: [] };
      rules.push(current);
      continue;
    }
    const colon = line.indexOf(":");
    if (!current || colon < 0) throw new Error(`Unparseable _headers line: ${line}`);
    current.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

const redirects = parseRedirects(await readOptional("_redirects"));
const headerRules = parseHeaders(await readOptional("_headers"));

function withHeaders(path: string, response: Response): Response {
  for (const rule of headerRules) {
    if (!rule.matches(path)) continue;
    for (const [name, value] of rule.headers) response.headers.append(name, value);
  }
  return response;
}

/** Resolves a URL path to a file inside dist/, or undefined if it escapes or does not exist. */
async function findFile(path: string): Promise<ReturnType<typeof Bun.file> | undefined> {
  const relative = normalize(decodeURIComponent(path)).replace(/^[/\\]+/, "");
  const candidates = path.endsWith("/")
    ? [join(dist, relative, "index.html")]
    : [join(dist, relative), join(dist, `${relative}.html`), join(dist, relative, "index.html")];
  for (const candidate of candidates) {
    if (candidate !== dist && !candidate.startsWith(dist + sep)) continue;
    const file = Bun.file(candidate);
    if ((await file.exists()) && (await stat(candidate)).isFile()) return file;
  }
  return undefined;
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const rewrite = redirects.find((rule) => rule.matches(path));
    const file = await findFile(rewrite ? rewrite.to : path);
    if (!file) {
      const notFound = Bun.file(join(dist, "404.html"));
      const body = (await notFound.exists()) ? notFound : "Not found";
      return withHeaders(path, new Response(body, { status: 404 }));
    }
    return withHeaders(path, new Response(file));
  },
});

console.log(`Serving dist/ at ${server.url}`);
