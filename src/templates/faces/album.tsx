import type { FaceDrawing, FaceInput } from "../types";
import {
  edgeOf,
  edgeWidthOf,
  fillOf,
  insetOf,
  mirrorTransform,
  outlineDash,
  PhotoSlot,
  r2,
  radiusOf,
  rectPath,
  sized,
  standardLines,
  TextBlock,
} from "./parts";

/** Tilts in degrees, picked by the name's hue: prints set on the page by hand, never past 1.5°. */
const TILTS = [-1.2, 0.8, -0.6, 1.2, -1, 0.6] as const;

/**
 * Warm album: each person is a photo print on a linen page, with small paper corners, a soft
 * shadow and the years in a handwritten hand. A deceased person's print is sepia with a small
 * mourning ribbon across its top inline-end corner.
 */
export function albumFace(input: FaceInput): FaceDrawing {
  const { W, H, s, ts, palette: p, fonts } = input;
  const edge = edgeWidthOf(input, 1.2 * s);
  const corner = 9 * s;
  const ribbon = input.deceased && !input.placeholder;
  const radius = radiusOf(input, 2 * s);
  const inset = insetOf(input);
  const outline = rectPath(0, 0, W, H, radius);
  const dash = outlineDash(input, edge);

  const shape = (
    <>
      {!input.placeholder && (
        <path d={rectPath(0, 3 * s, W, H, radius)} style={{ fill: p.ink, fillOpacity: 0.12 }} />
      )}
      <path
        className="stam-face__outline"
        d={outline}
        style={{
          fill: fillOf(input, p),
          stroke: input.placeholder ? p.muted : edgeOf(input, p.edge),
          strokeWidth: edge,
          strokeDasharray: dash,
        }}
      />
      {!input.placeholder && (
        <g style={{ fill: p.ink, fillOpacity: 0.72 }}>
          <path d={`M0 0h${r2(corner)}L0 ${r2(corner)}z`} />
          <path d={`M${r2(W)} 0v${r2(corner)}L${r2(W - corner)} 0z`} />
          <path d={`M${r2(W)} ${r2(H)}h${r2(-corner)}L${r2(W)} ${r2(H - corner)}z`} />
          <path d={`M0 ${r2(H)}v${r2(-corner)}L${r2(corner)} ${r2(H)}z`} />
        </g>
      )}
      {ribbon && (
        <path
          className="stam-face__ribbon"
          transform={mirrorTransform(input)}
          d={`M${r2(W - 22 * s)} 0h${r2(8 * s)}L${r2(W)} ${r2(14 * s)}v${r2(8 * s)}z`}
          style={{ fill: p.memorial }}
        />
      )}
      <PhotoSlot
        input={input}
        cx={42 * s + inset}
        cy={H / 2}
        r={30 * s}
        shape={input.photoUrl ? "square" : "circle"}
        ring={p.card}
        ringWidth={3 * s}
        initialsFont={sized({ ...fonts.name, size: 20, weight: 800 }, s)}
        initialsFill={p.ink}
      />
    </>
  );

  const x = 84 * s + inset;
  const maxWidth = W - x - (ribbon ? 22 * s : 10 * s) - inset;
  const lines = standardLines(input, {
    name: sized(fonts.name, ts),
    native: sized(fonts.native, ts),
    years: sized(fonts.years, ts),
    nameFill: p.ink,
    nativeFill: p.muted,
    yearsFill: p.accent,
    leading: 1.2,
  });
  const last = lines.at(-1);
  if (last && lines.length > 1) last.maxWidth = maxWidth - input.cornerReserve;
  const block = TextBlock({ input, lines, x, top: 0, height: H, maxWidth, anchor: "start" });
  return {
    shape,
    texts: block.node,
    outline,
    tilt: input.placeholder ? 0 : TILTS[input.hue % TILTS.length],
    textX: x,
    lastLineY: block.lastLineY,
    corner: { x: W - 18 * s, y: H - 16 * s },
  };
}
