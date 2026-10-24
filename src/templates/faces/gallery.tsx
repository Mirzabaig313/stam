import { MEDALLION_R, MEDALLION_Y } from "../medallion";
import type { FaceDrawing, FaceInput } from "../types";
import {
  edgeOf,
  edgeWidthOf,
  genderMark,
  insetOf,
  physical,
  r2,
  radiusOf,
  rectPath,
  sized,
  standardLines,
  TextBlock,
} from "./parts";

/**
 * Modern gallery: a round medallion above the name, crisp type, no box. The eldest generation's
 * medallions are in the accent; a deceased person's is hollow; a photo fills it.
 */
export function galleryFace(input: FaceInput): FaceDrawing {
  const { W, H, s, ts, palette: p, fonts } = input;
  const sx = physical(input);
  const cx = r2(sx(W / 2));
  const cy = r2(MEDALLION_Y * s);
  const r = MEDALLION_R * s;
  const colour = input.eldest ? p.accent : p.ink;
  const outline = rectPath(0, 0, W, H, radiusOf(input, 10 * s));
  const inset = insetOf(input);
  const initials = sized({ ...fonts.name, size: 26, weight: 800 }, s);
  const clipId = `${input.uid}-photo`;

  let medallion;
  if (input.placeholder) {
    medallion = (
      <>
        <circle
          cx={cx}
          cy={cy}
          r={r2(r)}
          style={{
            fill: p.ground,
            stroke: p.muted,
            strokeWidth: 2.6 * s,
            strokeDasharray: `${r2(6 * s)} ${r2(6 * s)}`,
          }}
        />
        <text
          className="stam-card__initials"
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={initials.family}
          fontSize={initials.size}
          fontWeight={700}
          style={{ fill: p.muted }}
        >
          ?
        </text>
      </>
    );
  } else if (input.photoUrl) {
    medallion = (
      <>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r2(r)} />
        </clipPath>
        <image
          href={input.photoUrl}
          x={r2(cx - r)}
          y={r2(cy - r)}
          width={r2(2 * r)}
          height={r2(2 * r)}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      </>
    );
  } else {
    const hollow = input.deceased;
    medallion = (
      <>
        <circle
          cx={cx}
          cy={cy}
          r={r2(hollow ? r - 2 * s : r)}
          style={hollow ? { fill: p.ground, stroke: colour, strokeWidth: 4 * s } : { fill: colour }}
        />
        <text
          className="stam-card__initials"
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={initials.family}
          fontSize={initials.size}
          fontWeight={initials.weight}
          style={{ fill: hollow ? colour : p.onAccent }}
        >
          {input.initials}
        </text>
      </>
    );
  }

  const shape = (
    <>
      {/* No box unless the card has its own fill or border: a transparent face keeps the whole
          card clickable. */}
      <path
        className="stam-face__outline"
        d={outline}
        style={{
          fill: input.style?.fill ?? p.ground,
          fillOpacity: input.style?.fill ? 1 : 0,
          stroke: input.style?.border ? edgeOf(input, p.edge) : "none",
          strokeWidth: edgeWidthOf(input, 0),
        }}
      />
      <g className="stam-card__avatar">{medallion}</g>
      {!input.placeholder && (
        <circle
          className="stam-card__key"
          cx={cx}
          cy={cy}
          r={r2(r + 3 * s)}
          style={{
            fill: "none",
            stroke: input.isStatic ? genderMark(input) : `var(--_mark, ${genderMark(input)})`,
            strokeWidth: 2 * s,
          }}
        />
      )}
    </>
  );

  const top = (MEDALLION_Y + MEDALLION_R + 6) * s;
  const lines = standardLines(input, {
    name: sized(fonts.name, ts),
    native: sized(fonts.native, ts),
    years: sized(fonts.years, ts),
    nameFill: p.ink,
    nativeFill: p.muted,
    yearsFill: p.muted,
    leading: 1.18,
  });
  const maxWidth = W - 12 * s - 2 * inset;
  const last = lines.at(-1);
  if (last && lines.length > 1) last.maxWidth = maxWidth - 2 * input.cornerReserve;
  const block = TextBlock({
    input,
    lines,
    x: W / 2,
    top,
    height: H - top - 6 * s,
    maxWidth,
    anchor: "middle",
  });
  return {
    shape,
    texts: block.node,
    outline,
    textX: W / 2 - maxWidth / 2,
    lastLineY: block.lastLineY,
    corner: { x: W - 18 * s, y: H - 16 * s },
  };
}
