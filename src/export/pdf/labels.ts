import type { jsPDF } from "jspdf";

import {
  EXPORT_FONT_FAMILY,
  fontFaceCss,
  hasUrduLetters,
  NASTALIQ_FAMILY,
  scriptFontsFor,
} from "../render/fonts";
import { type FontFace, inRange, parseFontFaces } from "./fontFaces";
import type { FontSet } from "./fonts";
import { outlineText, type TextStyle } from "./textToPaths";

// The tiled PDF's own words (the assembly guide, tile labels, neighbour names) are drawn as
// outlines in the export's fonts, like the tree itself: jsPDF's Helvetica has no latin-ext and no
// Arabic script, and couldn't shape Urdu or Arabic if it had.

/** The jsPDF path calls a label needs. */
export type PathSink = Pick<jsPDF, "moveTo" | "lineTo" | "curveTo" | "close" | "fill">;

export type LabelOptions = {
  sizePt: number;
  weight?: number;
  /** Where x is, on the page: the label's left edge, centre or right edge. */
  align?: "left" | "center" | "right";
  /** `alphabetic`: y is the baseline; `top`: the text hangs below y. */
  baseline?: "alphabetic" | "top";
  /** 90 turns the label a quarter counterclockwise, to read bottom to top. */
  angle?: 0 | 90;
};

const PT_TO_MM = 25.4 / 72;
const ALEF = 0x0627;
const RTL_FIRST = /^[^\p{L}]*[֐-ࣿיִ-﷿ﹰ-ﻼ]/u;

/**
 * The faces labels draw with: the export SVG's own (Archivo always), plus the Noto fonts the label
 * text needs that the SVG doesn't embed, as when the interface is in Urdu and the names are not.
 */
export function labelFaces(svgFaces: FontFace[], texts: string[]): FontFace[] {
  // A family has its Arabic-script face when one of its faces covers alef.
  const embedded = (family: string) =>
    svgFaces.some(
      (f) => f.family.toLowerCase() === family.toLowerCase() && inRange(f.ranges, ALEF),
    );
  const missing = scriptFontsFor(texts).filter((f) => !embedded(f.family));
  return missing.length === 0 ? svgFaces : [...svgFaces, ...parseFontFaces(fontFaceCss(missing))];
}

/** Whether text reads right to left: its first letter is in a right-to-left script. */
export function isRtlText(text: string): boolean {
  return RTL_FIRST.test(text);
}

type Point = [number, number];

/** Draws `text` at (x, y) in mm and fills it in the current fill colour. */
export function drawLabel(
  pdf: PathSink,
  fonts: FontSet,
  text: string,
  x: number,
  y: number,
  o: LabelOptions,
): { drawn: boolean; unsupported: string[] } {
  const rtl = isRtlText(text);
  const align = o.align ?? "left";
  // outlineText anchors logically (start is the right edge in right-to-left text).
  const anchor = align === "center" ? "middle" : (align === "left") !== rtl ? "start" : "end";
  const style: TextStyle = {
    size: o.sizePt * PT_TO_MM,
    weight: o.weight ?? 400,
    style: "normal",
    families: hasUrduLetters(text) ? [NASTALIQ_FAMILY, EXPORT_FONT_FAMILY] : [EXPORT_FONT_FAMILY],
    letterSpacing: 0,
    anchor,
    baseline: o.baseline === "top" ? "hanging" : "auto",
    rtl,
  };
  const d: string[] = [];
  const result = outlineText(text, x, y, style, fonts, d);
  if (!result.drawn) return result;

  const turn = ([px, py]: Point): Point =>
    o.angle === 90 ? [x + (py - y), y - (px - x)] : [px, py];
  let start: Point = [x, y];
  let pen: Point = [x, y];
  for (const command of d) {
    const op = command[0];
    const n = command.slice(1).trim().split(/\s+/).filter(Boolean).map(Number);
    if (op === "M") {
      pen = start = [n[0]!, n[1]!];
      pdf.moveTo(...turn(pen));
    } else if (op === "L") {
      pen = [n[0]!, n[1]!];
      pdf.lineTo(...turn(pen));
    } else if (op === "Q") {
      // A quadratic curve as the cubic PDF draws: control points 2/3 of the way to the handle.
      const q: Point = [n[0]!, n[1]!];
      const end: Point = [n[2]!, n[3]!];
      const c1: Point = [pen[0] + (2 / 3) * (q[0] - pen[0]), pen[1] + (2 / 3) * (q[1] - pen[1])];
      const c2: Point = [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])];
      pdf.curveTo(...turn(c1), ...turn(c2), ...turn(end));
      pen = end;
    } else if (op === "C") {
      const end: Point = [n[4]!, n[5]!];
      pdf.curveTo(...turn([n[0]!, n[1]!]), ...turn([n[2]!, n[3]!]), ...turn(end));
      pen = end;
    } else {
      pdf.close();
      pen = start;
    }
  }
  pdf.fill();
  return result;
}
