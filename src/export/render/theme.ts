import type { ExportTheme } from "@/export/types";

import { EXPORT_FONT_FAMILY } from "./fonts";

/**
 * Token colours resolved to literals (the `light` set is tokens.css / canvas.css). Exports carry no
 * CSS variables, and translucent colours are written as colour + opacity instead of rgba(), which
 * PDF and some SVG renderers handle poorly.
 */
export type Palette = {
  ground: string;
  ink: string;
  muted: string;
  /** `--line` is ink at this opacity. */
  lineOpacity: number;
  /** Card fills; `none` in print. */
  card: string;
  deceased: string;
  /** Connector strength (R32: 3:1 against the ground). */
  edgeOpacity: number;
};

export const PALETTES: Record<ExportTheme, Palette> = {
  light: {
    ground: "#f4f5f2",
    ink: "#111311",
    muted: "#5a615b",
    lineOpacity: 0.14,
    card: "#ffffff",
    deceased: "#eceee9",
    edgeOpacity: 0.55,
  },
  // White ground, black ink, no fills.
  print: {
    ground: "#ffffff",
    ink: "#000000",
    muted: "#000000",
    lineOpacity: 0.35,
    card: "none",
    deceased: "none",
    edgeOpacity: 1,
  },
};

/** The stylesheet for an export: the canvas's card, connector and ruler rules, resolved. */
export function themeCss(theme: ExportTheme): string {
  const p = PALETTES[theme];
  const print = theme === "print";
  const line = `${p.ink};stroke-opacity:${p.lineOpacity}`;
  const rules: [string, string][] = [
    ["text", `font-family:"${EXPORT_FONT_FAMILY}",system-ui,sans-serif`],
    [
      ".stam-edges",
      `stroke:${p.ink};opacity:${p.edgeOpacity};stroke-linecap:butt;stroke-linejoin:miter`,
    ],
    [".stam-card__bg", `fill:${p.card};stroke:${p.ink};stroke-width:1`],
    [".stam-card--deceased .stam-card__bg", `fill:${p.deceased}`],
    [
      ".stam-card--placeholder .stam-card__bg",
      `fill:${print ? "none" : p.ground};stroke:${p.muted};stroke-dasharray:4 3`,
    ],
    [".stam-card--linked .stam-card__bg", "stroke-dasharray:6 4"],
    [
      ".stam-card__avatar-disc",
      print ? `fill:none;stroke:${line}` : `fill:${p.ink};fill-opacity:${p.lineOpacity}`,
    ],
    [
      ".stam-card--placeholder .stam-card__avatar-disc",
      `fill:none;stroke:${p.muted};stroke-opacity:1;stroke-dasharray:3 3`,
    ],
    [".stam-card__avatar-ring", `fill:none;stroke:${line}`],
    [".stam-card__initials", `fill:${p.ink};letter-spacing:0.02em`],
    [".stam-card__name", `fill:${p.ink}`],
    [".stam-card__name--placeholder", `fill:${p.muted};font-style:italic`],
    [".stam-card__native", `fill:${p.ink}`],
    [".stam-card__years", `fill:${p.muted};font-variant-numeric:tabular-nums`],
    [
      ".stam-card__gender-mark",
      `fill:none;stroke:${p.muted};stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round`,
    ],
    [".stam-card__badge rect", print ? `fill:none;stroke:${p.ink}` : `fill:${p.ink}`],
    [
      ".stam-card__badge text",
      `fill:${print ? p.ink : p.ground};font-variant-numeric:tabular-nums`,
    ],
    [".stam-export__title", `fill:${p.ink}`],
    [".stam-export__subtitle", `fill:${p.muted}`],
    [
      ".stam-export__ruler text",
      `fill:${p.muted};font-stretch:112%;letter-spacing:0.06em;font-variant-numeric:tabular-nums`,
    ],
    [".stam-export__ruler line", `stroke:${line};stroke-width:1`],
  ];
  return rules.map(([selector, body]) => `${selector}{${body}}`).join("\n");
}
