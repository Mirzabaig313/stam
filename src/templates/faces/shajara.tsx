import type { FaceDrawing, FaceInput } from "../types";
import {
  edgeOf,
  edgeWidthOf,
  insetOf,
  type Line,
  outlineDash,
  PhotoSlot,
  r2,
  sized,
  styled,
  TextBlock,
  yearsLine,
} from "./parts";

/** The word that marks the departed in a shajara, in place of "†". */
export const MARHUM = "مرحوم";

/** A mihrab arch: a pointed top rising `rise` above the card box, straight sides, flat base. */
export function archPath(W: number, H: number, rise: number, s: number): string {
  const cx = W / 2;
  const shoulder = 22 * s;
  return (
    `M0 ${r2(H)}V${r2(shoulder)}Q0 ${r2(8 * s)} ${r2(20 * s)} ${r2(5 * s)}` +
    `Q${r2(cx - 22 * s)} ${r2(2 * s)} ${r2(cx)} ${r2(-rise)}` +
    `Q${r2(cx + 22 * s)} ${r2(2 * s)} ${r2(W - 20 * s)} ${r2(5 * s)}` +
    `Q${r2(W)} ${r2(8 * s)} ${r2(W)} ${r2(shoulder)}V${r2(H)}Z`
  );
}

/**
 * Shajara: the traditional family register. Mihrab-arched cards on lapis and gold, the name in
 * Nastaliq first and in Latin letters below, and مرحوم after the years of those who have died.
 */
export function shajaraFace(input: FaceInput): FaceDrawing {
  const { W, H, s, ts, palette: p, fonts } = input;
  const edge = edgeWidthOf(input, 1.8 * s);
  const inset = insetOf(input);
  const outline = archPath(W, H, 16 * s, s);

  const shape = (
    <>
      <path
        className="stam-face__outline"
        d={outline}
        style={{
          // A shajara marks the departed in words, so their card keeps the same fill.
          fill: input.placeholder ? p.ground : (input.style?.fill ?? p.card),
          stroke: input.placeholder ? p.muted : edgeOf(input, p.accent),
          strokeWidth: edge,
          strokeDasharray: outlineDash(input, edge),
        }}
      />
      {!input.placeholder && (
        <path
          d={`M${r2(6 * s)} ${r2(H - 6 * s)}H${r2(W - 6 * s)}`}
          style={{ stroke: p.soft, strokeWidth: 1.4 * s }}
        />
      )}
      <PhotoSlot
        // The register is Urdu first: the slot shows the native name's first letter.
        input={input.nativeName ? { ...input, initials: Array.from(input.nativeName)[0]! } : input}
        cx={38 * s + inset}
        cy={H / 2 + 6 * s}
        r={25 * s}
        ring={p.soft}
        ringWidth={2.2 * s}
        fill={p.ground}
        initialsFont={sized({ ...fonts.native, size: 22 }, s)}
        initialsFill={p.soft}
      />
    </>
  );

  // The card's own name style dresses the register's first line (and its Latin line, smaller).
  const nameStyle = input.style?.lines?.name;
  const nast = styled(sized(fonts.native, ts), nameStyle);
  const latin = styled(sized(fonts.name, ts), {
    preset: nameStyle?.preset,
    align: nameStyle?.align,
  });
  const small = styled(sized(fonts.years, ts), input.style?.lines?.years);
  const lines: Line[] = [];
  const urdu = input.placeholder ? "نامعلوم" : input.nativeName;
  if (urdu) {
    lines.push({
      text: urdu,
      font: nast.font,
      fill: input.placeholder ? p.muted : (nast.colour ?? p.ink),
      className: input.placeholder
        ? "stam-card__name stam-card__name--placeholder"
        : "stam-card__native",
      // Nastaliq stacks high and deep: 1.7 × its size, or the letters clip.
      lineHeight: nast.font.size * 1.7,
      key: "name",
      ...nast.line,
    });
  }
  // Under a Nastaliq name the Latin one is small and muted; without one it is the name line.
  const own = styled(sized(fonts.name, ts), nameStyle);
  lines.push(
    urdu
      ? {
          text: input.name,
          font: { ...latin.font, size: r2(latin.font.size * 0.72) },
          fill: p.muted,
          className: "stam-card__name",
          lineHeight: latin.font.size * 0.95,
          ...latin.line,
        }
      : {
          text: input.name,
          font: own.font,
          fill: own.colour ?? p.ink,
          className: "stam-card__name",
          lineHeight: own.font.size * 1.3,
          key: "name",
          ...own.line,
        },
  );
  const last = yearsLine(input);
  const years =
    input.deceased && !input.placeholder && !input.linked
      ? // The canvas's life line ends in the age ("· 73 yrs"); مرحوم takes its place.
        [input.years.replaceAll("†", "").split(" · ")[0]!.trim(), MARHUM]
          .filter(Boolean)
          .join("  ·  ")
      : last?.chip
        ? ""
        : (last?.text ?? "");
  if (years) {
    lines.push({
      text: years,
      font: small.font,
      fill: small.colour ?? p.soft,
      className: "stam-card__years",
      lineHeight: small.font.size * 1.35,
      key: "years",
      ...small.line,
    });
  }

  const start = 66 * s + inset;
  const centre = (start + W - 8 * s - inset) / 2;
  const maxWidth = W - start - 14 * s - inset;
  const lastLine = lines.at(-1);
  if (lastLine && lines.length > 1) lastLine.maxWidth = maxWidth - 2 * input.cornerReserve;
  const block = TextBlock({
    input,
    lines,
    x: centre,
    top: 4 * s,
    height: H - 10 * s,
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
