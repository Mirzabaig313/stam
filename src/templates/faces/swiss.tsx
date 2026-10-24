import type { FaceDrawing, FaceInput } from "../types";
import {
  edgeOf,
  edgeWidthOf,
  fillOf,
  genderMark,
  insetOf,
  outlineDash,
  physical,
  r2,
  radiusOf,
  rectPath,
  sized,
  standardLines,
  TextBlock,
} from "./parts";

/**
 * Swiss minimal: a hairline box, a plain grey frame for the photo, black type and "†" for those who
 * have died. Nothing else, so it stays clear at hundreds of people.
 */
export function swissFace(input: FaceInput): FaceDrawing {
  const { W, H, s, ts, palette: p, fonts } = input;
  const sx = physical(input);
  const edge = edgeWidthOf(input, 1.25 * s);
  const outline = rectPath(0, 0, W, H, radiusOf(input, 0));
  const frameW = 50 * s;
  const frameH = Math.min(64 * s, H - 20 * s);
  const fx = 12 * s + insetOf(input);
  const fy = (H - frameH) / 2;
  const clipId = `${input.uid}-photo`;
  const frameX = r2(input.dir === "rtl" ? W - fx - frameW : fx);
  const initials = sized({ ...fonts.name, size: 17, weight: 600 }, s);

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
      <g className="stam-card__avatar">
        <rect
          x={frameX}
          y={r2(fy)}
          width={r2(frameW)}
          height={r2(frameH)}
          style={{ fill: p.soft }}
        />
        {input.photoUrl && !input.placeholder ? (
          <>
            <clipPath id={clipId}>
              <rect x={frameX} y={r2(fy)} width={r2(frameW)} height={r2(frameH)} />
            </clipPath>
            <image
              href={input.photoUrl}
              x={frameX}
              y={r2(fy)}
              width={r2(frameW)}
              height={r2(frameH)}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clipId})`}
            />
          </>
        ) : (
          <text
            className="stam-card__initials"
            x={r2(sx(fx + frameW / 2))}
            y={r2(H / 2)}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={initials.family}
            fontSize={initials.size}
            fontWeight={initials.weight}
            style={{ fill: p.muted }}
          >
            {input.placeholder ? "?" : input.initials}
          </text>
        )}
        <rect
          className="stam-card__key"
          x={frameX}
          y={r2(fy)}
          width={r2(frameW)}
          height={r2(frameH)}
          style={{
            fill: "none",
            stroke: input.placeholder
              ? "none"
              : input.isStatic
                ? genderMark(input)
                : `var(--_mark, ${genderMark(input)})`,
            strokeWidth: 2 * s,
          }}
        />
      </g>
    </>
  );

  const x = fx + frameW + 14 * s;
  const maxWidth = W - x - 10 * s - insetOf(input);
  const lines = standardLines(
    { ...input, name: input.deceased && !input.placeholder ? `${input.name} †` : input.name },
    {
      name: sized(fonts.name, ts),
      native: sized(fonts.native, ts),
      years: sized(fonts.years, ts),
      nameFill: p.ink,
      nativeFill: p.muted,
      yearsFill: p.ink,
      leading: 1.22,
    },
  );
  const last = lines.at(-1);
  if (last && lines.length > 1) last.maxWidth = maxWidth - input.cornerReserve;
  const block = TextBlock({ input, lines, x, top: 0, height: H, maxWidth, anchor: "start" });
  return {
    shape,
    texts: block.node,
    outline,
    textX: x,
    lastLineY: block.lastLineY,
    corner: { x: W - 16 * s, y: H - 14 * s },
  };
}
