import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { pdfFixtureSvg } from "../tests/fixtures/pdfSvg";

/**
 * Runs the PDF exporter in a real browser on the hand-written fixture SVG. The export dialog
 * doesn't exist yet in this lane, so the module is bundled on its own and loaded into a blank
 * page. Set PDF_OUT=<dir> to keep the PDFs for a visual check.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const workDir = `${root}test-results/pdf-bundle`;
let bundle = "";

test.beforeAll(() => {
  mkdirSync(workDir, { recursive: true });
  const entry = `${workDir}/entry.ts`;
  writeFileSync(
    entry,
    `import * as pdf from "${root}src/export/pdf/index.ts";\n(window as any).stamPdf = pdf;\n`,
  );
  execFileSync(
    "bun",
    ["build", entry, "--target=browser", "--format=iife", `--outfile=${workDir}/pdf.js`],
    { cwd: root, stdio: "pipe" },
  );
  bundle = readFileSync(`${workDir}/pdf.js`, "utf8");
});

async function loadExporter(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("about:blank");
  await page.addScriptTag({ content: bundle });
  return errors;
}

async function exportPdf(page: Page, kind: "poster" | "tiled", options: object): Promise<Buffer> {
  const fixture = pdfFixtureSvg();
  const base64 = await page.evaluate(
    async (args) => {
      const pdf = (window as unknown as { stamPdf: Record<string, Function> }).stamPdf;
      const make = args.kind === "poster" ? pdf.toPosterPdf : pdf.toTiledPdf;
      const blob: Blob = await make!(args.fixture, args.options);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { kind, fixture, options },
  );
  const bytes = Buffer.from(base64, "base64");
  if (process.env.PDF_OUT) {
    mkdirSync(process.env.PDF_OUT, { recursive: true });
    writeFileSync(`${process.env.PDF_OUT}/${kind}-${test.info().project.name}.pdf`, bytes);
  }
  return bytes;
}

test("poster PDF: one vector page, no errors", async ({ page }) => {
  const errors = await loadExporter(page);
  const bytes = await exportPdf(page, "poster", { page: "A3", orientation: "auto", marginMm: 12 });
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
  expect(errors).toEqual([]);
});

test("tiled PDF: assembly guide plus one page per tile", async ({ page }) => {
  const errors = await loadExporter(page);
  const options = { page: "A4", scale: 2.5, overlapMm: 10 };
  const fixture = pdfFixtureSvg();
  const expected = await page.evaluate(
    (args) =>
      (
        window as unknown as {
          stamPdf: { tileLayout: (w: number, h: number, o: object) => { pageCount: number } };
        }
      ).stamPdf.tileLayout(args.fixture.width, args.fixture.height, args.options).pageCount,
    { fixture, options },
  );
  expect(expected).toBeGreaterThan(2);
  const bytes = await exportPdf(page, "tiled", options);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  // Count pages twice: with pdf-lib, and by the raw /Type /Page objects.
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(expected);
  expect(bytes.toString("latin1").match(/\/Type \/Page\b(?!s)/g)).toHaveLength(expected);
  expect(errors).toEqual([]);
});
