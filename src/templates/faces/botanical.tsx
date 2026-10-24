import type { FaceDrawing, FaceInput } from "../types";
import {
  edgeOf,
  edgeWidthOf,
  fillOf,
  insetOf,
  outlineDash,
  PhotoSlot,
  r2,
  sized,
  standardLines,
  TextBlock,
} from "./parts";

/**
 * A leaf with a flat middle: its tips reach `tip` past the card box on both sides (still inside
 * the couple gap), so the text sits on the flat part and never crowds a point.
 */
export function leafPath(W: number, H: number, tip: number): string {
  const cy = H / 2;
  const bulge = H * 0.1;
  return (
    `M${r2(-tip)} ${r2(cy)}` +
    `C${r2(-tip * 0.3)} ${r2(-bulge * 0.6)} ${r2(W * 0.14)} ${r2(-bulge)} ${r2(W / 2)} ${r2(-bulge)}` +
    `C${r2(W * 0.86)} ${r2(-bulge)} ${r2(W + tip * 0.3)} ${r2(-bulge * 0.6)} ${r2(W + tip)} ${r2(cy)}` +
    `C${r2(W + tip * 0.3)} ${r2(H + bulge * 0.6)} ${r2(W * 0.86)} ${r2(H + bulge)} ${r2(W / 2)} ${r2(H + bulge)}` +
    `C${r2(W * 0.14)} ${r2(H + bulge)} ${r2(-tip * 0.3)} ${r2(H + bulge * 0.6)} ${r2(-tip)} ${r2(cy)}Z`
  );
}

/**
 * Botanical tree: each person is a leaf. Living blood relatives are green, people who married in
 * a lighter green, and the departed an autumn leaf.
 */
export function botanicalFace(input: FaceInput): FaceDrawing {
  const { W, H, s, ts, palette: p, fonts } = input;
  const edge = edgeWidthOf(input, 2 * s);
  const inset = insetOf(input);
  const outline = leafPath(W, H, 11 * s);
  const stroke = edgeOf(
    input,
    input.placeholder ? p.muted : input.deceased ? p.memorial : input.marriedIn ? p.soft : p.accent,
  );

  const shape = (
    <>
      <path
        className="stam-face__outline"
        d={outline}
        style={{
          fill: fillOf(input, p),
          stroke,
          strokeWidth: edge,
          strokeDasharray: outlineDash(input, edge),
        }}
      />
      <path
        d={`M${r2(-5 * s)} ${r2(H / 2)}H${r2(W + 5 * s)}`}
        style={{ stroke, strokeWidth: 0.8 * s, strokeOpacity: 0.22 }}
      />
      <PhotoSlot
        input={input}
        cx={32 * s + inset}
        cy={H / 2}
        r={25 * s}
        ring={stroke}
        ringWidth={2.2 * s}
        fill={p.card}
        initialsFont={sized({ ...fonts.name, size: 18, weight: 600 }, s)}
        initialsFill={stroke}
      />
    </>
  );

  const start = 64 * s + inset;
  const centre = (start + W - 8 * s - inset) / 2;
  const maxWidth = W - start - 14 * s - inset;
  const lines = standardLines(input, {
    name: sized(fonts.name, ts),
    native: sized(fonts.native, ts),
    years: sized(fonts.years, ts),
    nameFill: p.ink,
    nativeFill: p.muted,
    yearsFill: input.deceased ? p.memorial : p.muted,
    leading: 1.2,
  });
  const last = lines.at(-1);
  if (last && lines.length > 1) last.maxWidth = maxWidth - 2 * input.cornerReserve;
  const block = TextBlock({
    input,
    lines,
    x: centre,
    top: 0,
    height: H,
    maxWidth,
    anchor: "middle",
  });
  return {
    shape,
    texts: block.node,
    outline,
    textX: start,
    lastLineY: block.lastLineY,
    corner: { x: W - 26 * s, y: H - 14 * s },
  };
}
