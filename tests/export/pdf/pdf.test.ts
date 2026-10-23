import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";

import { PDFDocument, PDFRawStream } from "pdf-lib";

import { PAGE_SIZES_MM, tileLayout, toPosterPdf, toTiledPdf } from "@/export/pdf";

import { pdfFixtureSvg } from "../../fixtures/pdfSvg";

const fixture = pdfFixtureSvg();
const MM_TO_PT = 72 / 25.4;

async function open(blob: Blob): Promise<{ text: string; doc: PDFDocument }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { text: new TextDecoder("latin1").decode(bytes), doc: await PDFDocument.load(bytes) };
}

function pageContent(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  const raw = contents instanceof PDFRawStream ? contents : null;
  if (!raw) throw new Error("expected a single content stream");
  return inflateSync(raw.contents).toString("latin1");
}

describe("toPosterPdf", () => {
  test("is a one-page vector PDF of the chosen size with no fonts left to embed", async () => {
    const blob = await toPosterPdf(fixture, { page: "A3", orientation: "auto", marginMm: 12 });
    expect(blob.type).toBe("application/pdf");
    const { text, doc } = await open(blob);
    expect(text.startsWith("%PDF")).toBe(true);
    expect(doc.getPageCount()).toBe(1);
    // The fixture is wider than tall, so auto picks landscape A3.
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(PAGE_SIZES_MM.A3.h * MM_TO_PT, 0);
    expect(height).toBeCloseTo(PAGE_SIZES_MM.A3.w * MM_TO_PT, 0);
    // Every name became outlines, so the page draws no text (no BT ... ET blocks).
    const content = pageContent(doc, 0);
    expect(content).toContain(" re"); // the background and card rectangles
    expect(content).not.toMatch(/\bBT\b/);
  });

  test("never puts the embedded @font-face rules into the page (the app's CSP refuses data: fonts)", async () => {
    expect(fixture.svg).toContain("@font-face");
    const inserted: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            for (const style of node.querySelectorAll("style")) {
              inserted.push(style.textContent ?? "");
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      await toPosterPdf(fixture, { page: "A4", orientation: "auto", marginMm: 10 });
      await Promise.resolve();
    } finally {
      observer.disconnect();
    }
    expect(inserted.length).toBeGreaterThan(0);
    for (const css of inserted) expect(css).not.toContain("@font-face");
  });

  test("accepts a custom page size", async () => {
    const blob = await toPosterPdf(fixture, {
      page: { w: 500, h: 300 },
      orientation: "landscape",
      marginMm: 0,
    });
    const { doc } = await open(blob);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(500 * MM_TO_PT, 0);
  });

  test("rejects an SVG that does not parse", async () => {
    expect(
      toPosterPdf(
        { svg: "<svg", width: 10, height: 10 },
        {
          page: "A4",
          orientation: "auto",
          marginMm: 10,
        },
      ),
    ).rejects.toThrow();
  });
});

describe("toTiledPdf", () => {
  test("has the assembly guide plus one page per tile", async () => {
    const options = { page: "A4", scale: 2.5, overlapMm: 10 } as const;
    const layout = tileLayout(fixture.width, fixture.height, options);
    expect(layout.cols * layout.rows).toBeGreaterThan(1);
    const { text, doc } = await open(await toTiledPdf(fixture, options));
    expect(text.startsWith("%PDF")).toBe(true);
    expect(doc.getPageCount()).toBe(layout.pageCount);
  });
});

describe("the theme stylesheet during a PDF export", () => {
  test("is scoped under a wrapper class, so the editor's own cards and lines are never restyled", async () => {
    const inserted: { css: string; hostClass: string }[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            for (const style of node.querySelectorAll("style")) {
              inserted.push({ css: style.textContent ?? "", hostClass: node.className });
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      await toPosterPdf(fixture, { page: "A4", orientation: "auto", marginMm: 10 });
      await Promise.resolve();
    } finally {
      observer.disconnect();
    }
    expect(inserted.length).toBeGreaterThan(0);
    for (const { css, hostClass } of inserted) {
      expect(hostClass).toContain("stam-export");
      expect(css).toContain(".stam-export .card");
      for (const selector of css.replace(/\{[^}]*\}/g, "|").split("|")) {
        if (selector.trim()) expect(selector.trim()).toMatch(/^\.stam-export /);
      }
    }
  });
});
