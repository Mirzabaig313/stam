// Every export format from the real editor, against the production build under the real CSP
// (scripts/serve-dist.ts applies public/_headers). Set SHOTS_DIR to keep screenshots of the
// dialog and of a rendered PNG.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, type Locator, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { tileLayout } from "../src/export/pdf/geometry";
import { famRemarriage, person, union } from "../tests/fixtures/families";
import { allCards, card } from "./helpers";

const NAMES = ["Zohra Raza", "Ali Raza", "Hina Raza", "Mehr Raza", "Bilal Raza", "Noor Raza"];
const LIVING_BIRTH = "1977"; // Bilal, living
const DECEASED_BIRTH = "1921"; // Zohra, deceased: privacy keeps her dates

/** famRemarriage under a deceased grandmother, with a living person's birth year. */
function remarriageFile() {
  const tree = famRemarriage();
  tree.id = "e2e-fam-remarriage";
  tree.name = "Raza family";
  tree.persons.a1 = { ...tree.persons.a1!, birth: { date: { year: 1977 } } };
  tree.persons.gran = person("gran", "Zohra", "Raza", "female", {
    isLiving: false,
    birth: { date: { year: 1921 } },
    death: { date: { year: 2001 } },
  });
  tree.unions.ug = union("ug", ["gran"], ["ali"]);
  tree.unionOrder.gran = ["ug"];
  tree.rootPersonId = "gran";
  const file = { format: "stam", schemaVersion: 1, exportedAt: new Date().toISOString(), tree };
  return {
    name: "raza.stam.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  };
}

async function openTree(page: Page): Promise<void> {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(remarriageFile());
  await expect(allCards(page)).toHaveCount(7);
  await expect(card(page, "Ali Raza")).toBeVisible();
}

function exportDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Export" });
}

async function openExport(page: Page): Promise<Locator> {
  await page.keyboard.press("ControlOrMeta+e");
  const dialog = exportDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens Export, picks the format, lets `configure` set options, and saves the download. */
async function exportAs(
  page: Page,
  format: RegExp,
  configure: (dialog: Locator) => Promise<void> = async () => {},
): Promise<{ path: string; name: string }> {
  const dialog = await openExport(page);
  await dialog.getByRole("radio", { name: format }).check();
  await configure(dialog);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Export", exact: true }).click(),
  ]);
  const name = download.suggestedFilename();
  const path = test.info().outputPath(`${Date.now()}-${name}`);
  await download.saveAs(path);
  await expect(dialog).toBeHidden();
  return { path, name };
}

const privacy = (on: boolean) => async (dialog: Locator) =>
  dialog.getByRole("checkbox", { name: /Privacy mode/ }).setChecked(on);

function svgSize(svg: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  return {
    width: Number(/\bwidth="([\d.]+)"/.exec(root)![1]),
    height: Number(/\bheight="([\d.]+)"/.exec(root)![1]),
  };
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): { width: number; height: number } {
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  let i = 2;
  while (i < bytes.length) {
    const marker = bytes[i + 1]!;
    const length = bytes.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error("no JPEG frame header");
}

/**
 * Draws the downloaded PNG, the same SVG rasterised on a page with no CSP, and that SVG with its
 * embedded fonts removed (the fallback a blocked font would give), and counts differing pixels.
 */
async function fontEvidence(page: Page, png: Buffer, svg: string) {
  const probe = await page.context().newPage(); // about:blank: no CSP
  try {
    return await probe.evaluate(
      async ({ pngB64, text, scale }) => {
        // The helpers run in the browser: page.evaluate sends this body as source.
        // oxlint-disable-next-line unicorn/consistent-function-scoping
        const load = (src: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.addEventListener("load", () => resolve(img));
            img.addEventListener("error", () =>
              reject(new Error(`could not load ${src.slice(0, 30)}`)),
            );
            img.src = src;
          });
        const fromSvg = async (source: string) => {
          const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
          try {
            return await load(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        };
        const shot = await load(`data:image/png;base64,${pngB64}`);
        const w = shot.naturalWidth;
        const h = shot.naturalHeight;
        const pixels = (img: HTMLImageElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#f4f5f2";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          return ctx.getImageData(0, 0, w, h).data;
        };
        // oxlint-disable-next-line unicorn/consistent-function-scoping
        const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
          let n = 0;
          for (let i = 0; i < a.length; i += 4) {
            const d = Math.max(
              Math.abs(a[i]! - b[i]!),
              Math.abs(a[i + 1]! - b[i + 1]!),
              Math.abs(a[i + 2]! - b[i + 2]!),
            );
            if (d > 48) n++;
          }
          return n;
        };
        const downloaded = pixels(shot);
        const reference = pixels(await fromSvg(text));
        const fallback = pixels(await fromSvg(text.replace(/@font-face\s*\{[^}]*\}/g, "")));
        return {
          total: w * h,
          scale,
          vsReference: differing(downloaded, reference),
          vsFallback: differing(downloaded, fallback),
          referenceVsFallback: differing(reference, fallback),
        };
      },
      { pngB64: png.toString("base64"), text: svg, scale: 2 },
    );
  } finally {
    await probe.close();
  }
}

const shotsDir = process.env.SHOTS_DIR;

test.beforeEach(async ({ page }) => {
  await openTree(page);
});

test("every format exports from the editor under the production CSP", async ({ page }, info) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });

  // The dialog, for the record.
  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    await openExport(page);
    await page.screenshot({ path: join(shotsDir, `export-dialog-${info.project.name}.png`) });
    await page.keyboard.press("Escape");
    await expect(exportDialog(page)).toBeHidden();
  }

  // SVG: parses, holds every name, and the living person's birth year (privacy is off).
  const svgFile = await exportAs(page, /^SVG image/);
  expect(svgFile.name).toMatch(/^raza-family-\d{4}-\d{2}-\d{2}\.svg$/);
  const svg = readFileSync(svgFile.path, "utf8");
  const parsed = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      ok: !doc.querySelector("parsererror") && doc.documentElement.localName === "svg",
      text: doc.documentElement.textContent ?? "",
    };
  }, svg);
  expect(parsed.ok).toBe(true);
  for (const name of NAMES) expect(parsed.text).toContain(name);
  expect(svg).toContain(LIVING_BIRTH);
  const size = svgSize(svg);

  // PNG at 2×, privacy off so it matches the SVG above; drawn with Archivo, not a fallback.
  const pngFile = await exportAs(page, /^PNG image/, privacy(false));
  const png = readFileSync(pngFile.path);
  expect(pngSize(png)).toEqual({
    width: Math.floor(size.width * 2),
    height: Math.floor(size.height * 2),
  });
  const fonts = await fontEvidence(page, png, svg);
  info.annotations.push({ type: "font pixels", description: JSON.stringify(fonts) });
  // The reference and the fallback really differ, so the comparison means something...
  expect(fonts.referenceVsFallback).toBeGreaterThan(200);
  // ...and the app's PNG is the reference (Archivo), not the fallback.
  expect(fonts.vsReference).toBeLessThan(fonts.referenceVsFallback / 10);
  expect(fonts.vsFallback).toBeGreaterThan(fonts.referenceVsFallback / 2);
  if (shotsDir) copyFileSync(pngFile.path, join(shotsDir, `export-${info.project.name}.png`));

  // JPEG at the default 2×.
  const jpegFile = await exportAs(page, /^JPEG image/);
  expect(jpegFile.name).toMatch(/\.jpe?g$/);
  expect(jpegSize(readFileSync(jpegFile.path))).toEqual({
    width: Math.floor(size.width * 2),
    height: Math.floor(size.height * 2),
  });

  // PDF poster on A3: one page.
  const posterFile = await exportAs(page, /^PDF poster/, async (dialog) => {
    await expect(dialog.getByLabel("Page size")).toHaveValue("A3");
  });
  const poster = readFileSync(posterFile.path);
  expect(poster.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect((await PDFDocument.load(poster)).getPageCount()).toBe(1);

  // PDF tiled on A4 at 100%: the guide page plus one page per tile.
  const tiledFile = await exportAs(page, /^PDF, tiled/, async (dialog) => {
    await expect(dialog.getByLabel("Paper")).toHaveValue("A4");
  });
  const tiled = readFileSync(tiledFile.path);
  expect(tiled.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const expectedPages = tileLayout(size.width, size.height, {
    page: "A4",
    scale: 1,
    overlapMm: 10,
  }).pageCount;
  expect((await PDFDocument.load(tiled)).getPageCount()).toBe(expectedPages);

  // HTML (privacy on by default): opens from disk and search finds a person.
  const htmlFile = await exportAs(page, /^Web page/);
  const html = readFileSync(htmlFile.path, "utf8");
  expect(html).not.toContain(LIVING_BIRTH);
  expect(html).toContain(DECEASED_BIRTH);
  const viewer = await page.context().newPage();
  const viewerErrors: string[] = [];
  viewer.on("pageerror", (e) => viewerErrors.push(e.message));
  await viewer.goto(pathToFileURL(htmlFile.path).href);
  await viewer.getByRole("searchbox", { name: "Search by name" }).fill("bilal");
  await expect(viewer.getByRole("status")).toHaveText("1 match");
  await expect(viewer.locator('[data-person-id="a1"]')).toBeVisible();
  expect(viewerErrors).toEqual([]);
  await viewer.close();

  // JSON backup: imports again as a second tree with the same people.
  const jsonFile = await exportAs(page, /^Backup/);
  expect(JSON.parse(readFileSync(jsonFile.path, "utf8")).format).toBe("stam");
  await page.getByRole("link", { name: "My trees" }).click();
  await page.locator('input[type="file"]').setInputFiles(jsonFile.path);
  await expect(allCards(page)).toHaveCount(7);
  await expect(card(page, "Bilal Raza")).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("privacy mode drops a living person's birth year from the SVG and the HTML", async ({
  page,
}) => {
  const svg = readFileSync((await exportAs(page, /^SVG image/, privacy(true))).path, "utf8");
  expect(svg).not.toContain(LIVING_BIRTH);
  expect(svg).toContain(DECEASED_BIRTH);
  expect(svg).toContain("Bilal Raza");
  const html = readFileSync((await exportAs(page, /^Web page/, privacy(true))).path, "utf8");
  expect(html).not.toContain(LIVING_BIRTH);
  expect(html).toContain("Bilal Raza");
});

test("the branch scope draws only the selected person's family line down", async ({ page }) => {
  await card(page, "Ali Raza").click();
  const svg = readFileSync(
    (
      await exportAs(page, /^SVG image/, async (dialog) => {
        await dialog.getByRole("radio", { name: "The selected person and descendants" }).check();
      })
    ).path,
    "utf8",
  );
  const ids = new Set([...svg.matchAll(/data-person-id="([^"]+)"/g)].map((m) => m[1]));
  expect(ids.has("gran")).toBe(false); // Ali's mother is above the branch
  for (const id of ["ali", "a1", "a2", "a3"]) expect(ids.has(id)).toBe(true);
  expect(svg).not.toContain("Zohra");
});

test("the visible scope crops to what is on screen", async ({ page }) => {
  // Zoom in so only part of the tree is on screen, then export that part.
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(400);
  const onScreen = await page.evaluate(() => {
    const slot = document.querySelector('[data-slot="canvas"]')!.getBoundingClientRect();
    return [...document.querySelectorAll<SVGGElement>(".stam-card")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.right > slot.left && r.left < slot.right && r.bottom > slot.top && r.top < slot.bottom
        );
      })
      .map((el) => el.closest("[data-node-id]")!.getAttribute("data-node-id"));
  });
  expect(onScreen.length).toBeGreaterThan(0);
  expect(onScreen.length).toBeLessThan(7);
  const svg = readFileSync(
    (
      await exportAs(page, /^SVG image/, async (dialog) => {
        await dialog.getByRole("radio", { name: "What is on screen now" }).check();
      })
    ).path,
    "utf8",
  );
  const ids = [...svg.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]);
  expect(ids.toSorted()).toEqual(onScreen.toSorted());
});
