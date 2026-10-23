import { CARD_H } from "@/core/layout/constants";

import type { Viewport } from "./viewport";

const NUMERALS: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** 1 → "I", 4 → "IV", 1994 → "MCMXCIV". */
export function toRoman(n: number): string {
  let rest = Math.floor(n);
  let out = "";
  for (const [value, numeral] of NUMERALS) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

export type Row = { generation: number; y: number };

/** One row per generation, with the row's top y, sorted by generation. */
export function rowsOf(nodes: readonly { generation: number; y: number }[]): Row[] {
  const tops = new Map<number, number>();
  for (const { generation, y } of nodes) {
    const top = tops.get(generation);
    if (top === undefined || y < top) tops.set(generation, y);
  }
  return [...tops]
    .map(([generation, y]) => ({ generation, y }))
    .toSorted((a, b) => a.generation - b.generation);
}

export type GenerationRulerProps = {
  rows: readonly Row[];
  viewport: Viewport;
  /** Screen height of the canvas, in px. */
  height: number;
  /** Generation of the selected person, drawn in ink instead of muted. */
  activeGeneration?: number | null;
};

/** Labels closer than this to the screen edge are left out (half a label's height). */
const EDGE = 8;

/**
 * Roman numerals I, II, III… down the inline-start margin, one per generation row. The ruler is
 * fixed to the screen edge and follows vertical pan and zoom only.
 */
export function GenerationRuler({
  rows,
  viewport,
  height,
  activeGeneration,
}: GenerationRulerProps) {
  return (
    <div className="stam-ruler" aria-hidden="true">
      {rows.map(({ generation, y }) => {
        const centre = (y + CARD_H / 2) * viewport.k + viewport.y;
        if (centre < EDGE || centre > height - EDGE) return null;
        const active = generation === activeGeneration;
        return (
          <span
            key={generation}
            className={active ? "stam-ruler__label stam-ruler__label--active" : "stam-ruler__label"}
            style={{ transform: `translateY(${Math.round(centre * 10) / 10}px)` }}
          >
            {toRoman(generation + 1)}
          </span>
        );
      })}
    </div>
  );
}
