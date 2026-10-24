import type { ReactNode } from "react";

import { type Align, type LineKey, type LineStyle, PRESET_SCALE } from "../cardStyle";
import { fitLifeLine, fitText, type Font } from "../text";
import type { FaceInput, Palette } from "../types";

/** Rounds to 1/100 px, so paths stay short and stable. */
export const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/** Inline-start x to physical x: the card mirrors in RTL. */
export const physical = (input: FaceInput) => (x: number) =>
  input.dir === "rtl" ? input.W - x : x;

/** A font scaled for the card's text size. */
export const sized = (font: Font, ts: number): Font => ({ ...font, size: r2(font.size * ts) });

/** A rectangle as a path, with rounded corners. */
export function rectPath(x: number, y: number, w: number, h: number, r = 0): string {
  if (r <= 0) return `M${r2(x)} ${r2(y)}h${r2(w)}v${r2(h)}h${r2(-w)}z`;
  const k = Math.min(r, w / 2, h / 2);
  return (
    `M${r2(x + k)} ${r2(y)}H${r2(x + w - k)}Q${r2(x + w)} ${r2(y)} ${r2(x + w)} ${r2(y + k)}` +
    `V${r2(y + h - k)}Q${r2(x + w)} ${r2(y + h)} ${r2(x + w - k)} ${r2(y + h)}` +
    `H${r2(x + k)}Q${r2(x)} ${r2(y + h)} ${r2(x)} ${r2(y + h - k)}V${r2(y + k)}Q${r2(x)} ${r2(y)} ${r2(x + k)} ${r2(y)}Z`
  );
}

/** A rectangle with its four corners cut: the Heritage cartouche. */
export function notchedPath(x: number, y: number, w: number, h: number, c: number): string {
  return (
    `M${r2(x + c)} ${r2(y)}H${r2(x + w - c)}L${r2(x + w)} ${r2(y + c)}V${r2(y + h - c)}` +
    `L${r2(x + w - c)} ${r2(y + h)}H${r2(x + c)}L${r2(x)} ${r2(y + h - c)}V${r2(y + c)}Z`
  );
}

/** Mirrors an inline-start path in RTL (paths are drawn left to right). */
export const mirrorTransform = (input: FaceInput) =>
  input.dir === "rtl" ? `translate(${input.W} 0) scale(-1 1)` : undefined;

export type Line = {
  text: string;
  font: Font;
  fill: string;
  /** `stam-card__name`, `__native`, `__years`: what the text is. */
  className: string;
  /** Distance from this line's top to the next line's top. */
  lineHeight: number;
  /** Width the line may take; the block's own when left out. */
  maxWidth?: number;
  /** A life line ("1950 · 76 yrs") drops its age before it is cut with "…". */
  life?: boolean;
  /** Set on the card: where the line sits in the text area, and whether it is underlined. */
  align?: Align;
  underline?: boolean;
  /** Which of the card's lines this is, so a click on it can select it (`data-line`). */
  key?: LineKey;
};

/**
 * Lines of text, vertically centred in the box from `top`, `height` high. `x` is the inline-start
 * edge (anchor "start") or the centre ("middle"). Names are fitted with "…"; every line is a bidi
 * isolate, so a native-script name and a Latin one never reorder each other.
 */
export function TextBlock({
  input,
  lines,
  x,
  top,
  height,
  maxWidth,
  anchor,
}: {
  input: FaceInput;
  lines: Line[];
  x: number;
  top: number;
  height: number;
  maxWidth: number;
  anchor: "start" | "middle";
}): { node: ReactNode; lastLineY: number } {
  const sx = physical(input);
  const total = lines.reduce((sum, l) => sum + l.lineHeight, 0);
  let y = top + (height - total) / 2;
  let lastLineY = y;
  // The text area's inline edges: a line aligned on the card goes to its start, centre or end.
  const x0 = anchor === "middle" ? x - maxWidth / 2 : x;
  const x1 = x0 + maxWidth;
  const placed = (align: Align | undefined): [number, "start" | "middle" | "end"] => {
    if (align === "start") return [x0, "start"];
    if (align === "center") return [(x0 + x1) / 2, "middle"];
    if (align === "end") return [x1, "end"];
    return [x, anchor];
  };
  const node = lines.map((line, i) => {
    // The baseline sits about 0.72 of the way down a line of this height.
    const baseline = y + line.lineHeight * 0.72;
    y += line.lineHeight;
    lastLineY = baseline;
    const [lx, la] = placed(line.align);
    return (
      <text
        key={i}
        className={line.className}
        data-line={line.key}
        x={r2(sx(lx))}
        y={r2(baseline)}
        textAnchor={la === "start" ? undefined : la}
        fontFamily={line.font.family}
        fontSize={line.font.size}
        fontWeight={line.font.weight}
        fontStyle={line.font.italic ? "italic" : undefined}
        textDecoration={line.underline ? "underline" : undefined}
        unicodeBidi="isolate"
        style={{ fill: line.fill }}
      >
        {(line.life ? fitLifeLine : fitText)(line.text, line.maxWidth ?? maxWidth, line.font)}
      </text>
    );
  });
  return { node, lastLineY };
}

/** The name, native name and years lines every face shows, before its own styling. */
export function standardLines(
  input: FaceInput,
  styles: {
    name: Font;
    native: Font;
    years: Font;
    nameFill: string;
    nativeFill: string;
    yearsFill: string;
    /** Line heights as a multiple of each font's size. */
    leading?: number;
  },
): Line[] {
  const lead = styles.leading ?? 1.28;
  const name = styled(
    input.placeholder ? { ...styles.name, weight: 400, italic: true } : styles.name,
    input.style?.lines?.name,
  );
  const out: Line[] = [
    {
      text: input.name,
      font: name.font,
      fill: input.placeholder ? input.palette.muted : (name.colour ?? styles.nameFill),
      className: input.placeholder
        ? "stam-card__name stam-card__name--placeholder"
        : "stam-card__name",
      lineHeight: name.font.size * lead,
      key: "name",
      ...name.line,
    },
  ];
  if (input.nativeName && !input.placeholder) {
    // The native name follows the name line's size and alignment, smaller.
    const native = styled(styles.native, {
      preset: input.style?.lines?.name?.preset,
      align: input.style?.lines?.name?.align,
    });
    out.push({
      text: input.nativeName,
      font: native.font,
      fill: styles.nativeFill,
      className: "stam-card__native",
      lineHeight: native.font.size * lead * 1.1,
      ...native.line,
    });
  }
  const last = yearsLine(input);
  if (last) {
    const years = styled(
      last.chip ? { ...styles.years, italic: true } : styles.years,
      input.style?.lines?.years,
    );
    out.push({
      text: last.text,
      font: years.font,
      fill: last.chip ? input.palette.muted : (years.colour ?? styles.yearsFill),
      className: last.chip ? "stam-card__deceased" : "stam-card__years",
      lineHeight: years.font.size * lead,
      life: !last.chip,
      key: "years",
      ...years.line,
    });
  }
  return out;
}

/** A line's font, colour and placement with the card's own line style on top. */
export function styled(
  font: Font,
  style: LineStyle | undefined,
): { font: Font; colour?: string; line: Pick<Line, "align" | "underline"> } {
  if (!style) return { font, line: {} };
  const out: Font = { ...font };
  if (style.preset) out.size = r2(font.size * PRESET_SCALE[style.preset]);
  if (style.bold !== undefined) out.weight = style.bold ? Math.max(font.weight, 700) : 400;
  if (style.italic !== undefined) out.italic = style.italic;
  return {
    font: out,
    ...(style.colour ? { colour: style.colour } : {}),
    line: {
      ...(style.align ? { align: style.align } : {}),
      ...(style.underline ? { underline: true } : {}),
    },
  };
}

/** The years, or "Deceased" for a deceased person with none; nothing on a linked copy. */
export function yearsLine(input: FaceInput): { text: string; chip: boolean } | null {
  if (input.linked || input.placeholder) return null;
  if (input.years) return { text: input.years, chip: false };
  if (input.deceased && !input.isStatic) return { text: input.deceasedWord, chip: true };
  return null;
}

/**
 * The photo slot every template has: the photo when there is one, else initials on a soft hue,
 * "?" for an unknown person. On the canvas its ring is the colour key (gender, branch or
 * generation: canvas.css sets `--_mark` on the card); in exports it is the template's own.
 */
export function PhotoSlot({
  input,
  cx,
  cy,
  r,
  shape = "circle",
  ring,
  ringWidth,
  fill,
  initialsFont,
  initialsFill,
}: {
  input: FaceInput;
  cx: number;
  cy: number;
  r: number;
  shape?: "circle" | "oval" | "square";
  ring: string;
  ringWidth: number;
  fill?: string;
  initialsFont: Font;
  initialsFill: string;
}): ReactNode {
  const sx = physical(input);
  const x = r2(sx(cx));
  const ry = shape === "oval" ? r * 1.22 : r;
  const outline =
    shape === "square" ? (
      <rect x={r2(x - r)} y={r2(cy - r)} width={r2(2 * r)} height={r2(2 * r)} rx={r2(r * 0.08)} />
    ) : shape === "oval" ? (
      <ellipse cx={x} cy={r2(cy)} rx={r2(r)} ry={r2(ry)} />
    ) : (
      <circle cx={x} cy={r2(cy)} r={r2(r)} />
    );
  const clipId = `${input.uid}-photo`;
  const keyStyle = {
    fill: "none",
    stroke: input.placeholder
      ? ring
      : input.isStatic
        ? genderMark(input)
        : `var(--_mark, ${genderMark(input)})`,
    strokeWidth: ringWidth,
    strokeDasharray: input.placeholder ? `${r2(ringWidth * 2)} ${r2(ringWidth * 2)}` : undefined,
  };
  const well = fill ?? input.palette.hues[input.hue % 6]!;
  return (
    <g className="stam-card__avatar">
      {input.photoUrl && !input.placeholder ? (
        <>
          <clipPath id={clipId}>{outline}</clipPath>
          <image
            href={input.photoUrl}
            x={r2(x - r)}
            y={r2(cy - ry)}
            width={r2(2 * r)}
            height={r2(2 * ry)}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : (
        <>
          <g style={{ fill: input.placeholder ? input.palette.card : well }}>{outline}</g>
          <text
            className="stam-card__initials"
            x={x}
            y={r2(cy)}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={initialsFont.family}
            fontSize={initialsFont.size}
            fontWeight={initialsFont.weight}
            fontStyle={initialsFont.italic ? "italic" : undefined}
            style={{ fill: input.placeholder ? input.palette.muted : initialsFill }}
          >
            {input.placeholder ? "?" : input.initials}
          </text>
        </>
      )}
      <g className="stam-card__key" style={keyStyle}>
        {outline}
      </g>
    </g>
  );
}

/** The gender marker's colour in the template's palette. */
export const genderMark = (input: FaceInput) =>
  input.gender === "male" ? input.palette.male : input.palette.female;

/** Dashes for an unknown person's or a linked copy's outline. */
export function outlineDash(input: FaceInput, width: number): string | undefined {
  if (input.placeholder) return `${r2(width * 3)} ${r2(width * 2.5)}`;
  if (input.linked) return `${r2(width * 5)} ${r2(width * 3.5)}`;
  return undefined;
}

export const fillOf = (input: FaceInput, p: Palette) =>
  input.placeholder ? p.ground : (input.style?.fill ?? (input.deceased ? p.cardDeceased : p.card));

/** The card's edge colour and width: its own border, or the template's. */
export const edgeOf = (input: FaceInput, colour: string) => input.style?.border?.colour ?? colour;
export const edgeWidthOf = (input: FaceInput, width: number) =>
  input.style?.border ? input.style.border.width : width;

/** The card's corner radius (shaped faces read it as how soft their shape is). */
export const radiusOf = (input: FaceInput, radius: number) => input.style?.radius ?? radius;

/** The template's own padding, at 100 %. */
export const BASE_PADDING = 12;

/** How much further in than the template the card's own padding puts its photo and text. */
export const insetOf = (input: FaceInput) =>
  input.style?.padding === undefined ? 0 : input.style.padding - BASE_PADDING * input.s;
