import type { jsPDF } from "jspdf";

import { i18n } from "@/i18n";

import type { RenderedSvg } from "../types";
import { type FontFace, parseFontFaces, stripFontFaces } from "./fontFaces";
import { createFontSet, type FontSet } from "./fonts";
import {
  cellName,
  posterLayout,
  type PosterOptions,
  TILE_MARGIN_MM,
  type TiledOptions,
  type TileLayout,
  tileLayout,
} from "./geometry";
import { drawLabel, isRtlText, labelFaces, type LabelOptions } from "./labels";
import { scopeCss } from "./scopeCss";
import { textToPaths } from "./textToPaths";

export {
  PAGE_SIZES_MM,
  posterLayout,
  tileLayout,
  type PageName,
  type PageSpec,
  type PosterLayout,
  type PosterOptions,
  type TiledOptions,
  type TileLayout,
} from "./geometry";

/** Translates a key; defaults to the app's i18next instance. */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

const defaultT: Translate = (key, vars) => i18n.t(key, vars ?? {});

/** jsPDF and svg2pdf.js are large, so they load only when a PDF is made. */
async function loadPdfLibs() {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  return { jsPDF, svg2pdf };
}

const HOST_CLASS = "stam-export";

type Prepared = {
  svg: SVGSVGElement;
  /** The fonts the SVG embeds (Archivo, and Noto for Arabic-script names). */
  faces: FontFace[];
  dispose: () => void;
};

/**
 * Parses the export SVG into the live document (svg2pdf and computed styles need that) and turns
 * its text into outlines drawn with the fonts it embeds.
 */
async function prepareSvg(r: RenderedSvg): Promise<Prepared> {
  const parsed = new DOMParser().parseFromString(r.svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (parsed.querySelector("parsererror") || root.localName !== "svg") {
    throw new Error("The export SVG could not be read");
  }
  // Read the embedded faces and take them out while the SVG is still detached: in the page, the
  // app's CSP (`font-src 'self'`) would refuse the data: fonts, and fontkit reads them itself.
  // svg2pdf can't use them either, and parsing megabytes of base64 CSS per page is slow.
  const styles = [...root.querySelectorAll("style")];
  const faces = parseFontFaces(styles.map((s) => s.textContent ?? "").join("\n"));
  // The theme's rules (.stam-card__bg and so on) share class names with the editor's own cards,
  // so they are scoped under the host's class and cannot restyle the editor while this runs.
  for (const style of styles) {
    style.textContent = scopeCss(stripFontFaces(style.textContent ?? ""), `.${HOST_CLASS}`);
  }
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  const host = document.createElement("div");
  host.className = HOST_CLASS;
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none";
  host.append(svg);
  document.body.append(host);
  try {
    if (faces.length > 0) {
      const kit = await import("fontkit");
      textToPaths(svg, createFontSet(kit, faces));
    }
  } catch (error) {
    host.remove();
    throw error;
  }
  return { svg, faces, dispose: () => host.remove() };
}

function finish(pdf: jsPDF): Blob {
  pdf.setProperties({ creator: "Stam" });
  return pdf.output("blob");
}

/** One page, vector, the drawing scaled to fit inside the margins. */
export async function toPosterPdf(r: RenderedSvg, o: PosterOptions): Promise<Blob> {
  const layout = posterLayout(r.width, r.height, o);
  const [{ jsPDF, svg2pdf }, prepared] = await Promise.all([loadPdfLibs(), prepareSvg(r)]);
  try {
    const pdf = new jsPDF({
      unit: "mm",
      format: [layout.pageW, layout.pageH],
      orientation: layout.orientation,
      compress: true,
    });
    await svg2pdf(prepared.svg, pdf, {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    });
    return finish(pdf);
  } finally {
    prepared.dispose();
  }
}

const INK = 0;
const MARK_GAP = 2; // mm between the trim corner and its crop mark
const MARK_LEN = 6;

function cropMarks(pdf: jsPDF, l: TileLayout): void {
  const m = TILE_MARGIN_MM;
  const left = m;
  const top = m;
  const right = m + l.trimW;
  const bottom = m + l.trimH;
  pdf.setDrawColor(INK);
  pdf.setLineWidth(0.2);
  for (const x of [left, right]) {
    for (const y of [top, bottom]) {
      const out = y === top ? -1 : 1;
      const side = x === left ? -1 : 1;
      // A vertical mark above/below the corner and a horizontal one beside it.
      pdf.line(x, y + out * MARK_GAP, x, y + out * (MARK_GAP + MARK_LEN));
      pdf.line(x + side * MARK_GAP, y, x + side * (MARK_GAP + MARK_LEN), y);
    }
  }
}

/** Ticks in the margin where the neighbour's edge falls, with the neighbour's cell name. */
/** Draws a label in ink; see `drawLabel`. */
function label(
  pdf: jsPDF,
  fonts: FontSet,
  text: string,
  x: number,
  y: number,
  o: LabelOptions,
): void {
  pdf.setFillColor(INK, INK, INK);
  drawLabel(pdf, fonts, text, x, y, o);
}

function alignmentMarks(
  pdf: jsPDF,
  fonts: FontSet,
  l: TileLayout,
  row: number,
  col: number,
  overlapMm: number,
): void {
  const m = TILE_MARGIN_MM;
  const left = m;
  const top = m;
  const right = m + l.trimW;
  const bottom = m + l.trimH;
  const midX = m + l.trimW / 2;
  const midY = m + l.trimH / 2;
  const side: LabelOptions = { sizePt: 9, align: "center", angle: 90 };
  const edge: LabelOptions = { sizePt: 9, align: "center" };
  pdf.setLineWidth(0.2);
  const tickV = (x: number) => {
    pdf.line(x, top - MARK_GAP, x, top - MARK_GAP - 3);
    pdf.line(x, bottom + MARK_GAP, x, bottom + MARK_GAP + 3);
  };
  const tickH = (y: number) => {
    pdf.line(left - MARK_GAP, y, left - MARK_GAP - 3, y);
    pdf.line(right + MARK_GAP, y, right + MARK_GAP + 3, y);
  };
  if (col + 1 < l.cols) {
    tickV(right - overlapMm);
    label(pdf, fonts, cellName(row, col + 1), right + m / 2, midY, side);
  }
  if (col > 0) {
    tickV(left + overlapMm);
    label(pdf, fonts, cellName(row, col - 1), left - m / 2, midY, side);
  }
  if (row + 1 < l.rows) {
    tickH(bottom - overlapMm);
    label(pdf, fonts, cellName(row + 1, col), midX, bottom + m / 2 + 1.5, edge);
  }
  if (row > 0) {
    tickH(top + overlapMm);
    label(pdf, fonts, cellName(row - 1, col), midX, top - m / 2 + 1.5, edge);
  }
}

function tileDetail(l: TileLayout, row: number, col: number, page: number, t: Translate) {
  return `${t("export.pdf.tileLabel", { row: row + 1, col: col + 1 })} · ${t("export.pdf.pageOf", {
    page,
    total: l.pageCount,
  })}`;
}

function tileLabel(
  pdf: jsPDF,
  fonts: FontSet,
  l: TileLayout,
  row: number,
  col: number,
  page: number,
  t: Translate,
) {
  const m = TILE_MARGIN_MM;
  const x = m + MARK_GAP + MARK_LEN + 2;
  label(pdf, fonts, cellName(row, col), x, m - 3.5, { sizePt: 11, weight: 700 });
  label(pdf, fonts, tileDetail(l, row, col, page, t), x + 8, m - 3.5, { sizePt: 7 });
}

async function assemblyGuide(
  pdf: jsPDF,
  svg2pdf: Awaited<ReturnType<typeof loadPdfLibs>>["svg2pdf"],
  svg: SVGSVGElement,
  fonts: FontSet,
  l: TileLayout,
  t: Translate,
): Promise<void> {
  const m = 15;
  // Right-to-left headings start at the right margin.
  const heading = (text: string, y: number, o: LabelOptions) => {
    const rtl = isRtlText(text);
    label(pdf, fonts, text, rtl ? l.pageW - m : m, y, { ...o, align: rtl ? "right" : "left" });
  };
  heading(t("export.pdf.guideTitle"), m + 4, { sizePt: 16, weight: 700 });
  heading(t("export.pdf.guideInstruction"), m + 12, { sizePt: 11 });
  heading(
    t("export.pdf.guideSummary", { count: l.tiles.length, cols: l.cols, rows: l.rows }),
    m + 18,
    { sizePt: 11 },
  );

  // The whole drawing as a thumbnail, with each tile's window drawn over it.
  const top = m + 26;
  const boxW = l.pageW - 2 * m;
  const boxH = l.pageH - top - m;
  const lastTile = l.tiles.at(-1)!;
  const coverW = lastTile.sx + l.trimW;
  const coverH = lastTile.sy + l.trimH;
  const k = Math.min(boxW / coverW, boxH / coverH);
  const ox = m + (boxW - coverW * k) / 2;
  const oy = top + (boxH - coverH * k) / 2;
  await svg2pdf(svg, pdf, { x: ox, y: oy, width: l.contentW * k, height: l.contentH * k });
  pdf.setDrawColor(INK);
  pdf.setLineWidth(0.3);
  const sizePt = Math.max(6, Math.min(14, (Math.min(l.trimW, l.trimH) * k) / 4));
  for (const tile of l.tiles) {
    const x = ox + tile.sx * k;
    const y = oy + tile.sy * k;
    pdf.rect(x, y, l.trimW * k, l.trimH * k);
    label(pdf, fonts, cellName(tile.row, tile.col), x + 1.5, y + 1.5, { sizePt, baseline: "top" });
  }
}

/**
 * The drawing at a print scale over several pages of one size (FR-X5). Page 1 is an assembly
 * guide; every tile has crop marks, alignment ticks naming its neighbours and its cell label.
 */
export async function toTiledPdf(
  r: RenderedSvg,
  o: TiledOptions,
  t: Translate = defaultT,
): Promise<Blob> {
  const l = tileLayout(r.width, r.height, o);
  const [{ jsPDF, svg2pdf }, prepared] = await Promise.all([loadPdfLibs(), prepareSvg(r)]);
  try {
    const format: [number, number] = [l.pageW, l.pageH];
    const pdf = new jsPDF({ unit: "mm", format, orientation: l.orientation, compress: true });
    // The labels' words, for the fonts they need beyond the tree's (an Urdu guide, Latin names).
    const words = [
      t("export.pdf.guideTitle"),
      t("export.pdf.guideInstruction"),
      t("export.pdf.guideSummary", { count: l.tiles.length, cols: l.cols, rows: l.rows }),
      tileDetail(l, 0, 0, 2, t),
    ];
    const kit = await import("fontkit");
    const fonts = createFontSet(kit, labelFaces(prepared.faces, words));
    await assemblyGuide(pdf, svg2pdf, prepared.svg, fonts, l, t);
    let page = 1;
    for (const tile of l.tiles) {
      page++;
      pdf.addPage(format, l.orientation);
      pdf.saveGraphicsState();
      pdf.rect(TILE_MARGIN_MM, TILE_MARGIN_MM, l.trimW, l.trimH, null);
      pdf.clip();
      pdf.discardPath();
      await svg2pdf(prepared.svg, pdf, {
        x: TILE_MARGIN_MM - tile.sx,
        y: TILE_MARGIN_MM - tile.sy,
        width: l.contentW,
        height: l.contentH,
      });
      pdf.restoreGraphicsState();
      cropMarks(pdf, l);
      alignmentMarks(pdf, fonts, l, tile.row, tile.col, o.overlapMm);
      tileLabel(pdf, fonts, l, tile.row, tile.col, page, t);
    }
    return finish(pdf);
  } finally {
    prepared.dispose();
  }
}
