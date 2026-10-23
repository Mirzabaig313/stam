// fontkit is pinned to an exact version in package.json (no caret): this module reaches into its
// underscored internals (variation processor, transformed glyphs), which a minor release may
// change. Re-check them, and the tests in tests/export/pdf/fonts.test.ts, before bumping it.
// fontkit keeps what this module needs in underscored internals.
/* oxlint-disable no-underscore-dangle */
import type * as Fontkit from "fontkit";

import { type FontFace, inRange } from "./fontFaces";

export type FontkitModule = typeof Fontkit;

/** The parts of a fontkit font this module uses. */
export type KitFont = {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  hasGlyphForCodePoint(codePoint: number): boolean;
  layout(text: string): {
    glyphs: { path: { commands: { command: string; args: number[] }[] } }[];
    positions: { xAdvance: number; xOffset: number; yOffset: number }[];
  };
};

type RawFont = KitFont & {
  constructor: new (stream: unknown, coords: number[]) => RawFont;
  stream: { constructor: new (bytes: Uint8Array) => unknown };
  fvar?: { axis: { axisTag: string; minValue: number; defaultValue: number; maxValue: number }[] };
  _variationProcessor: { transformPoints(gid: number, points: unknown[]): void } | null;
  getGlyph(id: number, codePoints?: number[]): RawGlyph;
  _transformedGlyphs?: unknown[];
};

type Point = { x: number; y: number; copy(): Point };
type DecodedGlyph = {
  points?: Point[];
  components?: { dx: number; dy: number }[];
  phantomPoints?: unknown[];
};
type RawGlyph = { _decode(): DecodedGlyph | null };

/**
 * A variable-font instance from a WOFF2 file.
 *
 * fontkit 2.0.4 can't do this itself: `getVariation` re-reads a WOFF2 as plain TrueType and
 * crashes, and WOFF2 glyphs skip the gvar step. So this builds the font with variation
 * coordinates and applies gvar to each glyph's pre-decoded points, as fontkit does for TTF.
 * Advance widths already vary through HVAR. Checked against Archivo's static 700 instance.
 */
function woff2Instance(base: RawFont, bytes: Uint8Array, coords: number[]): RawFont {
  const DecodeStream = base.stream.constructor;
  const font = new base.constructor(new DecodeStream(bytes), coords);
  // fontkit decodes the whole WOFF2 glyf table on first use, and its composite decoder crashes
  // when variations are on. Decode it once on the plain base font and share the result (the
  // decoded glyphs are copied below, never changed).
  base.getGlyph(0);
  font._transformedGlyphs = base._transformedGlyphs;
  // fontkit's Point class (transformPoints copies points with it); taken from any outline.
  const PointClass = (base._transformedGlyphs as DecodedGlyph[] | undefined)?.find(
    (g) => g?.points?.length,
  )?.points?.[0]?.constructor as
    (new (onCurve: boolean, endContour: boolean, x: number, y: number) => Point) | undefined;
  const getGlyph = font.getGlyph.bind(font);
  const patched = new WeakSet<RawGlyph>();
  font.getGlyph = (id, codePoints) => {
    const glyph = getGlyph(id, codePoints);
    if (patched.has(glyph)) return glyph;
    patched.add(glyph);
    const decode = glyph._decode.bind(glyph);
    let memo: DecodedGlyph | null | undefined;
    glyph._decode = () => {
      if (memo !== undefined) return memo;
      const raw = decode();
      if (!raw || !font._variationProcessor || !PointClass) return (memo = raw);
      if (!raw.points?.length && !raw.components?.length) return (memo = raw);
      const varied: DecodedGlyph = {
        ...raw,
        points: raw.points?.map((p) => p.copy()),
        components: raw.components?.map((c) => ({ ...c })),
      };
      const make = (end: boolean, x = 0, y = 0) => new PointClass(!end, end, x, y);
      const points: { x: number; y: number }[] = varied.points
        ? varied.points.slice()
        : (varied.components ?? []).map((c) => make(true, c.dx, c.dy));
      // gvar deltas also cover four phantom points (metrics); HVAR handles those here.
      for (let i = 0; i < 4; i++) points.push(make(true));
      font._variationProcessor.transformPoints(id, points);
      varied.phantomPoints = points.slice(-4);
      if (!varied.points) {
        varied.components?.forEach((c, i) => {
          c.dx = points[i]!.x;
          c.dy = points[i]!.y;
        });
      }
      return (memo = varied);
    };
    return glyph;
  };
  return font;
}

type AnchorFn = (
  markRecord: { markAnchor?: unknown } | null,
  baseAnchor: unknown,
  i: number,
) => void;
type GposProcessor = { applyAnchor: AnchorFn; skipsNullAnchors?: true };

/**
 * fontkit 2.0.4 crashes on a NULL anchor in a mark-attachment lookup ("Cannot destructure
 * 'xCoordinate'"). Noto Nastaliq Urdu has them (ڑ in جوڑنے). OpenType says a NULL anchor means the
 * mark doesn't attach to that glyph, so it is skipped and the mark keeps its own position.
 * fontkit's GPOS processor is one class, so patching its prototype once covers every font.
 */
function skipNullAnchors(font: RawFont): void {
  const engine = (font as unknown as { _layoutEngine?: { engine?: { GPOSProcessor?: object } } })
    ._layoutEngine?.engine;
  const gpos = engine?.GPOSProcessor;
  if (!gpos) return;
  const proto = Object.getPrototypeOf(gpos) as GposProcessor;
  if (proto.skipsNullAnchors || typeof proto.applyAnchor !== "function") return;
  const applyAnchor = proto.applyAnchor;
  proto.applyAnchor = function (this: GposProcessor, markRecord, baseAnchor, i) {
    if (!baseAnchor || !markRecord?.markAnchor) return;
    applyAnchor.call(this, markRecord, baseAnchor, i);
  };
  proto.skipsNullAnchors = true;
}

type LoadedFace = FontFace & { base: RawFont; isWoff2: boolean; instances: Map<number, KitFont> };

export type FontSet = {
  /** The face to draw a code point with: the wanted families first, then any face that has it. */
  faceFor(families: string[], weight: number, style: string, codePoint: number): number | null;
  /** The font for a face at a weight (an instance of a variable face). */
  font(face: number, weight: number): KitFont;
};

export function createFontSet(kit: FontkitModule, faces: FontFace[]): FontSet {
  const loaded: LoadedFace[] = [];
  for (const face of faces) {
    try {
      const base = kit.create(face.bytes as unknown as Buffer) as unknown as RawFont;
      if (!("layout" in base)) continue; // a collection, not a font
      const isWoff2 = (base as unknown as { type?: string }).type === "WOFF2";
      skipNullAnchors(base);
      loaded.push({ ...face, base, isWoff2, instances: new Map() });
    } catch {
      // A face fontkit can't read is skipped; its text falls back to another face.
    }
  }

  const distance = (face: LoadedFace, weight: number, style: string) => {
    const [lo, hi] = face.weight;
    const w = weight < lo ? lo - weight : weight > hi ? weight - hi : 0;
    return w + (face.style === style ? 0 : 1000);
  };

  const best = (candidates: LoadedFace[], weight: number, style: string, codePoint: number) => {
    let pick: LoadedFace | null = null;
    for (const face of candidates) {
      if (!inRange(face.ranges, codePoint) || !face.base.hasGlyphForCodePoint(codePoint)) continue;
      if (!pick || distance(face, weight, style) < distance(pick, weight, style)) pick = face;
    }
    return pick;
  };

  return {
    faceFor(families, weight, style, codePoint) {
      for (const family of families) {
        const lower = family.toLowerCase();
        const face = best(
          loaded.filter((f) => f.family.toLowerCase() === lower),
          weight,
          style,
          codePoint,
        );
        if (face) return loaded.indexOf(face);
      }
      const any = best(loaded, weight, style, codePoint);
      return any ? loaded.indexOf(any) : null;
    },

    font(index, weight) {
      const face = loaded[index]!;
      const axes = face.base.fvar?.axis;
      const wght = axes?.find((a) => a.axisTag.trim() === "wght");
      if (!axes || !wght) return face.base;
      const value = Math.max(wght.minValue, Math.min(wght.maxValue, weight));
      let font = face.instances.get(value);
      if (!font) {
        const coords = axes.map((a) => (a === wght ? value : a.defaultValue));
        font = face.isWoff2
          ? woff2Instance(face.base, face.bytes, coords)
          : (face.base as unknown as { getVariation(s: object): KitFont }).getVariation({
              wght: value,
            });
        face.instances.set(value, font);
      }
      return font;
    },
  };
}
