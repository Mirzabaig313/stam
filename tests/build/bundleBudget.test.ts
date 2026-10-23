import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkBudget, firstLoad } from "../../scripts/bundle-budget";

let dist = "";

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), "stam-budget-"));
  const files: Record<string, string> = {
    "app.html":
      '<link rel="stylesheet" href="/a.css"><script type="module" src="/entry.js"></script>' +
      '<link rel="modulepreload" href="/shared.js">',
    "a.css": "body{color:red}",
    "entry.js": 'import{x}from"/shared.js";const p=()=>import("/pdf.js");x(p);',
    "shared.js": 'import{y}from"/deep.js";export const x=y;',
    "deep.js": "export const y=1;",
    "pdf.js": "export const jsPDF=1;" + "d09GMgABAAAA".repeat(10),
  };
  for (const [name, text] of Object.entries(files)) await writeFile(join(dist, name), text);
});
afterAll(() => rm(dist, { recursive: true, force: true }));

describe("firstLoad", () => {
  test("follows the page's scripts, styles and static imports, not dynamic import()", async () => {
    const load = await firstLoad(dist, "app.html");
    expect(load.files.map((f) => f.name).toSorted()).toEqual([
      "a.css",
      "app.html",
      "deep.js",
      "entry.js",
      "shared.js",
    ]);
    const sum = load.files.reduce((n, f) => n + f.gzip, 0);
    expect(load.gzip).toBe(sum);
    for (const f of load.files) expect(f.gzip).toBe(Bun.gzipSync(f.bytes).length);
  });
});

describe("checkBudget", () => {
  test("passes under the limit with no heavy library in the first load", async () => {
    const result = await checkBudget(dist, "app.html", 250 * 1024);
    expect(result.problems).toEqual([]);
  });

  test("fails over the limit", async () => {
    const result = await checkBudget(dist, "app.html", 10);
    expect(result.problems[0]).toMatch(/over the 10 B budget/);
  });

  test("fails when a heavy export library is loaded up front", async () => {
    await writeFile(join(dist, "deep.js"), 'export const y="d09GMgABAAAA";');
    const result = await checkBudget(dist, "app.html", 250 * 1024);
    expect(result.problems.join("\n")).toMatch(/deep\.js.*embedded font base64/);
  });

  test("fails when the Urdu or Arabic strings load up front (they load when chosen)", async () => {
    await writeFile(
      join(dist, "deep.js"),
      'export const y={_review:"Machine-assisted translation. Needs review by a native speaker."};',
    );
    const result = await checkBudget(dist, "app.html", 250 * 1024);
    expect(result.problems.join("\n")).toMatch(/deep\.js.*Urdu or Arabic strings/);
  });
});
