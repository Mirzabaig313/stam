import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appShell, shellGaps } from "../../scripts/precache";

let dist = "";

const files: Record<string, string> = {
  "app.html":
    '<link rel="icon" href="/favicon-1a2b.svg"><link rel="stylesheet" href="/a.css">' +
    '<script type="module" src="/entry.js"></script><link rel="modulepreload" href="/shared.js">' +
    '<link rel="canonical" href="https://stam.example/app">',
  "a.css": "@font-face{src:url(/fonts/f1.woff2)}body{background:url(/fonts/f2.woff2)}",
  "entry.js": 'import{x}from"/shared.js";const p=()=>import("/pdf.js");x(p);',
  "shared.js": "export const x=1;",
  "pdf.js": 'import"/pdf-deps.js";export const y=1;',
  "pdf-deps.js": "export const z=1;",
  "favicon-1a2b.svg": "<svg/>",
  "fonts/f1.woff2": "1",
  "fonts/f2.woff2": "2",
  // The landing page's own files stay out of the shell.
  "index.html": '<script type="module" src="/landing.js"></script>',
  "landing.js": "export {};",
};

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), "stam-precache-"));
  await mkdir(join(dist, "fonts"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dist, name), text);
});
afterAll(() => rm(dist, { recursive: true, force: true }));

describe("appShell", () => {
  test("lists the page under its route and everything it loads, lazy chunks and fonts too", async () => {
    const shell = await appShell(dist, "app.html", "/app");
    expect(shell.files).toEqual([
      "/a.css",
      "/app",
      "/entry.js",
      "/favicon-1a2b.svg",
      "/fonts/f1.woff2",
      "/fonts/f2.woff2",
      "/pdf-deps.js",
      "/pdf.js",
      "/shared.js",
    ]);
  });

  test("the version follows the files' contents", async () => {
    const before = await appShell(dist, "app.html", "/app");
    expect(before.version).toMatch(/^[0-9a-f]{12}$/);
    expect((await appShell(dist, "app.html", "/app")).version).toBe(before.version);
    await writeFile(join(dist, "shared.js"), "export const x=2;");
    expect((await appShell(dist, "app.html", "/app")).version).not.toBe(before.version);
  });
});

describe("shellGaps (the build fails on any)", () => {
  const listing = [
    "app.html",
    "app-boot.1a2b3c4d.js",
    "chunk-a.js",
    "fonts/archivo.woff2",
    "fonts/naskh.woff2",
    // Too big to inline: Bun emits Nastaliq at the root, not under /fonts.
    "noto-nastaliq-urdu-arabic-wght-normal-x1.woff2",
    "site-flags.9f9f9f9f.js",
  ];

  test("the boot script and every font, under /fonts or at the root, must be in the shell", () => {
    expect(shellGaps(["/app", "/chunk-a.js"], listing)).toEqual([
      "/app-boot.1a2b3c4d.js",
      "/fonts/archivo.woff2",
      "/fonts/naskh.woff2",
      "/noto-nastaliq-urdu-arabic-wght-normal-x1.woff2",
    ]);
  });

  test("nothing missing: no gaps (the landing's own flags script is not the app's)", () => {
    const all = [
      "/app",
      "/app-boot.1a2b3c4d.js",
      "/fonts/archivo.woff2",
      "/fonts/naskh.woff2",
      "/noto-nastaliq-urdu-arabic-wght-normal-x1.woff2",
    ];
    expect(shellGaps(all, listing)).toEqual([]);
  });

  test("a classic boot script in app.html's head is followed like any other", async () => {
    await writeFile(join(dist, "app-boot.5e5e5e5e.js"), "document.documentElement;");
    await writeFile(
      join(dist, "boot.html"),
      '<head><script src="/app-boot.5e5e5e5e.js"></script></head><link rel="stylesheet" href="/a.css">',
    );
    const shell = await appShell(dist, "boot.html", "/app");
    expect(shell.files).toContain("/app-boot.5e5e5e5e.js");
  });
});
