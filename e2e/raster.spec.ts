import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(new URL("./fixtures/raster-entry.ts", import.meta.url));

// A hand-written drawing: 200 x 100 CSS px.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
  '<rect x="10" y="10" width="80" height="40" fill="#c33"/><text x="20" y="80" font-size="14">Stam</text></svg>';

let bundle = "";
test.beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), "stam-raster-"));
  execFileSync(
    "bun",
    ["build", entry, "--outdir", out, "--target", "browser", "--format", "iife"],
    { cwd: root },
  );
  bundle = readFileSync(join(out, "raster-entry.js"), "utf8");
});

type Out = { sig: number[]; width: number; height: number; type: string; scale: number };

async function run(page: Page, format: "png" | "jpeg", scale: number): Promise<Out> {
  // A CSP-free page on the test origin: the app's own CSP forbids injected inline scripts.
  await page.route("**/raster-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>raster</title>" }),
  );
  await page.goto("/raster-fixture");
  await page.addScriptTag({ content: bundle });
  return page.evaluate(
    async ({ svg, fmt, factor }): Promise<Out> => {
      const w = window as unknown as {
        stamRasterize: (
          r: { svg: string; width: number; height: number },
          o: { format: string; scale: number; background: string; ground: string },
        ) => Promise<{ blob: Blob; scale: number }>;
      };
      const r = await w.stamRasterize(
        { svg, width: 200, height: 100 },
        { format: fmt, scale: factor, background: "transparent", ground: "#ffffff" },
      );
      const bmp = await createImageBitmap(r.blob);
      const sig = Array.from(new Uint8Array(await r.blob.slice(0, 8).arrayBuffer()));
      return { sig, width: bmp.width, height: bmp.height, type: r.blob.type, scale: r.scale };
    },
    { svg: SVG, fmt: format, factor: scale },
  );
}

test("exports a PNG with the right signature and dimensions", async ({ page }) => {
  const o = await run(page, "png", 2);
  expect(o.sig).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(o.type).toBe("image/png");
  expect([o.width, o.height]).toEqual([400, 200]);
  expect(o.scale).toBe(2);
});

test("exports a JPEG with the right signature and dimensions", async ({ page }) => {
  const o = await run(page, "jpeg", 3);
  expect(o.sig.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
  expect(o.type).toBe("image/jpeg");
  expect([o.width, o.height]).toEqual([600, 300]);
});
