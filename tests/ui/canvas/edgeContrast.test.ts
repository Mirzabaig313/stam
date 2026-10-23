import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const GROUND: [number, number, number] = [0xf4, 0xee, 0xea]; // #F4EEEA
const INK: [number, number, number] = [0x2a, 0x1e, 0x24]; // #2A1E24

describe("connector contrast (ruling R32, WCAG 1.4.11)", () => {
  const css = readFileSync("src/ui/canvas/canvas.css", "utf8");
  const rule = /\.stam-edges\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
  // The opacity is the theme's --edge-opacity token; the fallback is the light value.
  const opacity = Number(/opacity:\s*(?:var\(--edge-opacity,\s*)?([\d.]+)/.exec(rule)?.[1]);
  const tokens = readFileSync("src/ui/styles/tokens.css", "utf8");
  const lightToken = Number(/--edge-opacity:\s*([\d.]+)/.exec(tokens)?.[1]);

  test("the fallback is the light theme's token (every theme: tokenContrast.test.ts)", () => {
    expect(opacity).toBe(lightToken);
  });

  test("the connector group has an opacity", () => {
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(1);
  });

  test("ink at the connector opacity over the ground is at least 3:1 (it is about 3.9:1 at 50%)", () => {
    const blended = INK.map((c, i) => opacity * c + (1 - opacity) * GROUND[i]!) as [
      number,
      number,
      number,
    ];
    expect(contrast(blended, GROUND)).toBeGreaterThanOrEqual(3);
  });

  test("the old 14% line strength fails, so the check can tell the difference", () => {
    const blended = INK.map((c, i) => 0.14 * c + 0.86 * GROUND[i]!) as [number, number, number];
    expect(contrast(blended, GROUND)).toBeLessThan(3);
  });
});
