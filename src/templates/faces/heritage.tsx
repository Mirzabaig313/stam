import type { FaceDrawing, FaceInput } from "../types";
import {
  edgeOf,
  edgeWidthOf,
  fillOf,
  insetOf,
  notchedPath,
  outlineDash,
  PhotoSlot,
  radiusOf,
  sized,
  standardLines,
  TextBlock,
} from "./parts";

/**
 * Heritage manuscript: a notched cartouche in ink with a gold inner frame, the portrait in a gold
 * oval and the names in a book serif. A deceased person's cartouche is a shade darker and its
 * inner frame is drawn in ink.
 */
export function heritageFace(input: FaceInput): FaceDrawing {
  const { W, H, s, ts, palette: p, fonts } = input;
  // The card's own corner radius softens the cartouche: it sets how deep the corners are cut.
  const notch = Math.max(0, radiusOf(input, 9 * s));
  const edge = edgeWidthOf(input, 1.3 * s);
  const shift = insetOf(input);
  const outline = notchedPath(0, 0, W, H, notch);
  const inset = 5 * s;

  const shape = (
    <>
      <path
        className="stam-face__outline"
        d={outline}
        style={{
          fill: fillOf(input, p),
          stroke: input.placeholder ? p.muted : edgeOf(input, p.ink),
          strokeWidth: edge,
          strokeDasharray: outlineDash(input, edge),
        }}
      />
      {!input.placeholder && (
        <path
          d={notchedPath(inset, inset, W - 2 * inset, H - 2 * inset, notch - inset / 2)}
          style={{
            fill: "none",
            stroke: input.deceased ? p.ink : p.accent,
            strokeWidth: (input.deceased ? 1 : 0.8) * s,
          }}
        />
      )}
      <PhotoSlot
        input={input}
        cx={42 * s + shift}
        cy={H / 2}
        r={25 * s}
        shape="oval"
        ring={p.accent}
        ringWidth={2 * s}
        fill={p.ground}
        initialsFont={sized({ ...fonts.name, size: 21, weight: 600, italic: true }, s)}
        initialsFill={p.accent}
      />
    </>
  );

  const start = 76 * s + shift;
  const centre = (start + W - 10 * s - shift) / 2;
  const maxWidth = W - start - 14 * s - shift;
  const lines = standardLines(input, {
    name: sized(fonts.name, ts),
    native: sized(fonts.native, ts),
    years: sized(fonts.years, ts),
    nameFill: p.ink,
    nativeFill: p.muted,
    yearsFill: p.muted,
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
    corner: { x: W - 20 * s, y: H - 18 * s },
  };
}
