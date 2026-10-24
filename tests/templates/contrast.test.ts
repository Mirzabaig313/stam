import { describe, expect, test } from "bun:test";

import { TEMPLATES } from "@/templates";
import type { Palette } from "@/templates/types";

// WCAG 2.x contrast of the templates' own palettes (they are literals, drawn inline). Text needs
// 4.5:1 on what it sits on; lines and marks, 3:1 (R32).

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const CHECKS: { what: string; fg: keyof Palette; bg: keyof Palette; min: number }[] = [
  { what: "names on a card", fg: "ink", bg: "card", min: 4.5 },
  { what: "names on a deceased card", fg: "ink", bg: "cardDeceased", min: 4.5 },
  { what: "native names and years on a card", fg: "muted", bg: "card", min: 4.5 },
  { what: "the legend and titles on the page", fg: "muted", bg: "ground", min: 4.5 },
  { what: "connectors on the page", fg: "line", bg: "ground", min: 3 },
  { what: "the male marker on a card", fg: "male", bg: "card", min: 3 },
  { what: "the female marker on a card", fg: "female", bg: "card", min: 3 },
];

describe("template palettes are readable", () => {
  for (const template of Object.values(TEMPLATES)) {
    for (const [name, palette] of Object.entries(template.palettes)) {
      test(`${template.id} ${name}`, () => {
        for (const { what, fg, bg, min } of CHECKS) {
          const ratio = contrast(palette[fg] as string, palette[bg] as string);
          expect({ what, ratio: ratio >= min ? "ok" : ratio.toFixed(2) }).toEqual({
            what,
            ratio: "ok",
          });
        }
      });
    }
  }
});
