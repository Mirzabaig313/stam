import type { FontSet, KitFont } from "./fonts";

/**
 * Turns every `<text>` in an SVG into a `<path>` drawn with the fonts embedded in the SVG.
 *
 * svg2pdf can only draw text with jsPDF's fonts: the 14 standard ones (no latin-ext, no Arabic)
 * or TrueType files, and the export embeds variable WOFF2. Outlines keep the poster identical to
 * the screen, including the Archivo weights, and fontkit shapes Arabic script (joining forms,
 * right-to-left), which jsPDF's text engine can't do for Naskh or Nastaliq.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Attributes carried from the `<text>` to its `<path>` so CSS rules and clipping still match. */
const CARRIED = ["id", "class", "transform", "opacity", "clip-path", "mask", "aria-hidden"];

/** How a run of text is drawn: CSS-like, in the units of the drawing it lands in. */
export type TextStyle = {
  size: number;
  weight: number;
  style: string;
  families: string[];
  letterSpacing: number;
  anchor: string;
  baseline: string;
  rtl: boolean;
};

export type TextToPathsResult = {
  /** `<text>` elements replaced by paths. */
  converted: number;
  /** Characters no embedded font can draw; they are left out. */
  unsupported: string[];
};

function attrUp(el: Element, name: string): string | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const value = node.getAttribute(name);
    if (value) return value;
  }
  return null;
}

function computed(el: Element): CSSStyleDeclaration | null {
  try {
    return el.ownerDocument.defaultView?.getComputedStyle(el) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether computed style folds in presentation attributes (`font-weight="800"`), as browsers do.
 * Test DOMs such as happy-dom don't, and there the attributes are read directly instead.
 */
let attributesInComputedStyle = true;

function detectAttributeStyle(root: Element): void {
  const probe = root.ownerDocument.createElementNS(SVG_NS, "text");
  probe.setAttribute("font-weight", "777");
  root.append(probe);
  attributesInComputedStyle = computed(probe)?.getPropertyValue("font-weight").trim() === "777";
  probe.remove();
}

/** A CSS property as the browser resolves it, attributes included. */
function prop(el: Element, cs: CSSStyleDeclaration | null, name: string): string | null {
  const value = cs?.getPropertyValue(name).trim();
  if (attributesInComputedStyle) return value || attrUp(el, name);
  return attrUp(el, name) ?? (value || null);
}

function px(value: string | null, fontSize: number, fallback: number): number {
  if (!value || value === "normal") return fallback;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.trim().endsWith("em") ? n * fontSize : n;
}

function weightOf(value: string | null): number {
  if (!value || value === "normal") return 400;
  if (value === "bold" || value === "bolder") return 700;
  if (value === "lighter") return 300;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 400;
}

function styleOf(el: Element): TextStyle {
  const cs = computed(el);
  const size = px(prop(el, cs, "font-size"), 16, 16);
  const families = (prop(el, cs, "font-family") ?? "sans-serif")
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  return {
    size,
    weight: weightOf(prop(el, cs, "font-weight")),
    style: (prop(el, cs, "font-style") ?? "normal").toLowerCase(),
    families,
    letterSpacing: px(prop(el, cs, "letter-spacing"), size, 0),
    anchor: (el.getAttribute("text-anchor") ?? prop(el, cs, "text-anchor") ?? "start").trim(),
    baseline: (
      el.getAttribute("dominant-baseline") ??
      prop(el, cs, "dominant-baseline") ??
      "auto"
    ).trim(),
    rtl: (el.getAttribute("direction") ?? prop(el, cs, "direction")) === "rtl",
  };
}

// Strong right-to-left: Hebrew, Arabic, Syriac, Thaana, NKo... and the Arabic presentation forms.
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/u;
const LTR = /[\p{L}\p{N}]/u;
// Invisible bidi controls (marks, embeddings, isolates such as the cards' LRI…PDI around years).
// They have no glyph; the runs' own directions already put the text in order.
const BIDI_CONTROL = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

type Run = { face: number; text: string; rtl: boolean | null };

/** Splits text into runs drawn by one face, each with its direction (null = neutral). */
function itemize(text: string, style: TextStyle, fonts: FontSet, unsupported: string[]): Run[] {
  const runs: Run[] = [];
  for (const char of text) {
    if (BIDI_CONTROL.test(char)) continue;
    const cp = char.codePointAt(0)!;
    const dir = RTL.test(char) ? true : LTR.test(char) ? false : null;
    const last = runs.at(-1);
    // Neutrals (spaces, punctuation) stay in the current run when its face can draw them.
    if (last && dir === null && fonts.font(last.face, style.weight).hasGlyphForCodePoint(cp)) {
      last.text += char;
      continue;
    }
    const face = fonts.faceFor(style.families, style.weight, style.style, cp);
    if (face === null) {
      if (char.trim()) unsupported.push(char);
      continue;
    }
    if (last && last.face === face && (dir === null || last.rtl === null || last.rtl === dir)) {
      last.text += char;
      if (last.rtl === null) last.rtl = dir;
    } else {
      runs.push({ face, text: char, rtl: dir });
    }
  }
  return runs;
}

/** Unicode bidi rule L2 over whole runs: reverse every stretch at each level, highest first. */
function visualOrder(runs: Run[], baseRtl: boolean): Run[] {
  let previous = baseRtl;
  const levels = runs.map((run) => {
    const rtl = run.rtl ?? previous;
    previous = rtl;
    return baseRtl ? (rtl ? 1 : 2) : rtl ? 1 : 0;
  });
  const order = runs.map((_, i) => i);
  const max = Math.max(0, ...levels);
  for (let level = max; level >= 1; level--) {
    for (let i = 0; i < order.length;) {
      if (levels[order[i]!]! < level) {
        i++;
        continue;
      }
      let j = i;
      while (j < order.length && levels[order[j]!]! >= level) j++;
      order.splice(i, j - i, ...order.slice(i, j).toReversed());
      i = j;
    }
  }
  return order.map((i) => runs[i]!);
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

type Placed = { font: KitFont; run: Run; width: number; layout: ReturnType<KitFont["layout"]> };

/**
 * Appends the outlines of `text`, anchored at (x, y), to `out` as SVG path commands (M, L, Q, C
 * and Z, absolute). Shaped by fontkit, so Arabic script joins; bidi runs are put in visual order.
 */
export function outlineText(
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  fonts: FontSet,
  out: string[],
): { drawn: boolean; unsupported: string[] } {
  const unsupported: string[] = [];
  const runs = visualOrder(itemize(text, style, fonts, unsupported), style.rtl);
  if (runs.length === 0) return { drawn: false, unsupported };
  const placed: Placed[] = runs.map((run) => {
    const font = fonts.font(run.face, style.weight);
    const layout = font.layout(run.text);
    const scale = style.size / font.unitsPerEm;
    // Browsers don't space out cursive (joined) scripts.
    const spacing = run.rtl ? 0 : style.letterSpacing;
    const advance = layout.positions.reduce((sum, p) => sum + p.xAdvance * scale + spacing, 0);
    return { font, run, width: advance, layout };
  });
  const total = placed.reduce((sum, p) => sum + p.width, 0);
  const anchor = style.rtl
    ? (({ start: "end", end: "start" } as Record<string, string>)[style.anchor] ?? style.anchor)
    : style.anchor;
  let pen = anchor === "middle" ? x - total / 2 : anchor === "end" ? x - total : x;

  const first = placed[0]!.font;
  const em = style.size / first.unitsPerEm;
  let baseY = y;
  if (style.baseline === "central" || style.baseline === "middle") {
    baseY += ((first.ascent + first.descent) / 2) * em;
  } else if (style.baseline === "hanging" || style.baseline === "text-before-edge") {
    baseY += first.ascent * em;
  } else if (style.baseline === "text-after-edge" || style.baseline === "ideographic") {
    baseY += first.descent * em;
  }

  for (const { font, run, layout } of placed) {
    const scale = style.size / font.unitsPerEm;
    const spacing = run.rtl ? 0 : style.letterSpacing;
    layout.glyphs.forEach((glyph, i) => {
      const pos = layout.positions[i]!;
      const ox = pen + pos.xOffset * scale;
      const oy = baseY - pos.yOffset * scale;
      for (const { command, args } of glyph.path.commands) {
        const pts: string[] = [];
        for (let k = 0; k + 1 < args.length; k += 2) {
          pts.push(fmt(ox + args[k]! * scale), fmt(oy - args[k + 1]! * scale));
        }
        const letter =
          { moveTo: "M", lineTo: "L", quadraticCurveTo: "Q", bezierCurveTo: "C" }[command] ?? "Z";
        out.push(letter + pts.join(" "));
      }
      pen += pos.xAdvance * scale + spacing;
    });
  }
  return { drawn: true, unsupported };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function num(value: string | null, fallback: number): number {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
}

export function textToPaths(root: Element, fonts: FontSet): TextToPathsResult {
  const result: TextToPathsResult = { converted: 0, unsupported: [] };
  detectAttributeStyle(root);
  for (const text of root.querySelectorAll("text")) {
    const style = styleOf(text);
    const x = num(text.getAttribute("x"), 0);
    const y = num(text.getAttribute("y"), 0);
    // Each positioned <tspan> is its own chunk; anything else follows on the text's position.
    const chunks: { x: number; y: number; text: string; style: TextStyle }[] = [];
    let plain = "";
    for (const node of text.childNodes) {
      if (node.nodeType === 1 && (node as Element).localName === "tspan") {
        const span = node as Element;
        if (span.hasAttribute("x") || span.hasAttribute("y")) {
          chunks.push({
            x: num(span.getAttribute("x"), x),
            y: num(span.getAttribute("y"), y),
            text: collapse(span.textContent ?? ""),
            style: styleOf(span),
          });
          continue;
        }
      }
      plain += node.textContent ?? "";
    }
    if (collapse(plain)) chunks.unshift({ x, y, text: collapse(plain), style });

    const d: string[] = [];
    let drawn = false;
    for (const chunk of chunks) {
      const r = outlineText(chunk.text, chunk.x, chunk.y, chunk.style, fonts, d);
      drawn ||= r.drawn;
      result.unsupported.push(...r.unsupported);
    }
    if (!drawn) continue; // nothing we can draw: leave it to svg2pdf

    const path = text.ownerDocument.createElementNS(SVG_NS, "path");
    for (const name of CARRIED) {
      const value = text.getAttribute(name);
      if (value !== null) path.setAttribute(name, value);
    }
    const cs = computed(text);
    for (const name of ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity"]) {
      const value = cs?.getPropertyValue(name).trim() || text.getAttribute(name);
      if (value) path.setAttribute(name, value);
    }
    // svg2pdf resolves fonts even for paths; a CSS weight like 600 has no standard-font match
    // and makes it warn on every card.
    path.setAttribute("style", "font-weight:normal;font-style:normal");
    path.setAttribute("d", d.join(""));
    text.replaceWith(path);
    result.converted++;
  }
  return result;
}
