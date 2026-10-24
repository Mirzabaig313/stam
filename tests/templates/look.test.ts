import { describe, expect, test } from "bun:test";

import { DEFAULT_METRICS, MIN_ROW_GAP } from "@/core/layout/constants";
import { DEFAULT_LOOK, type Look, normalizeLook, TEMPLATE_IDS } from "@/templates/look";
import { BASE_METRICS, metricsFor } from "@/templates/metrics";

const look = (over: Partial<Look> = {}): Look => ({ ...DEFAULT_LOOK, ...over });

describe("normalizeLook", () => {
  test("anything unusable is the default look", () => {
    for (const raw of [undefined, null, 3, "album", [], {}]) {
      expect(normalizeLook(raw)).toEqual(DEFAULT_LOOK);
    }
  });

  test("keeps known values and drops unknown ones", () => {
    expect(
      normalizeLook({ template: "shajara", cardSize: 120, textSize: 90, spacing: "airy", x: 1 }),
    ).toEqual({ template: "shajara", cardSize: 120, textSize: 90, spacing: "airy" });
    expect(normalizeLook({ template: "neon", spacing: "huge" })).toEqual(DEFAULT_LOOK);
  });

  test("sizes snap to 5 % steps inside their ranges", () => {
    expect(normalizeLook({ cardSize: 500, textSize: 1 })).toMatchObject({
      cardSize: 140,
      textSize: 85,
    });
    expect(normalizeLook({ cardSize: 103, textSize: 112 })).toMatchObject({
      cardSize: 105,
      textSize: 110,
    });
    expect(normalizeLook({ cardSize: Number.NaN })).toMatchObject({ cardSize: 100 });
  });
});

describe("metricsFor", () => {
  test("at 100 % a template gets its own card, today's gaps and its row gap", () => {
    for (const template of TEMPLATE_IDS) {
      const base = BASE_METRICS[template];
      expect(metricsFor(look({ template }))).toEqual({
        cardW: base.cardW,
        cardH: base.cardH,
        coupleGap: DEFAULT_METRICS.coupleGap,
        gap: DEFAULT_METRICS.gap,
        rowH: base.cardH + base.rowGap,
        ...(base.unionY === undefined ? {} : { unionY: base.unionY }),
      });
    }
  });

  test("card size scales the card and its gaps together", () => {
    const small = metricsFor(look({ cardSize: 80 }));
    const big = metricsFor(look({ cardSize: 140 }));
    expect(big.cardW).toBeGreaterThan(small.cardW);
    expect(big.cardH).toBeGreaterThan(small.cardH);
    expect(big.gap).toBeGreaterThan(small.gap);
  });

  test("text size grows the card, mostly in height", () => {
    const plain = metricsFor(look());
    const large = metricsFor(look({ textSize: 130 }));
    expect(large.cardH - plain.cardH).toBeGreaterThan(large.cardW - plain.cardW - 30);
    expect(large.cardH).toBeGreaterThan(plain.cardH);
    expect(large.cardW).toBeGreaterThan(plain.cardW);
    expect(large.gap).toBe(plain.gap);
  });

  test("spacing widens or narrows the gaps, never the card", () => {
    const tight = metricsFor(look({ spacing: "tight" }));
    const airy = metricsFor(look({ spacing: "airy" }));
    expect(airy.cardW).toBe(tight.cardW);
    expect(airy.gap).toBeGreaterThan(tight.gap);
    expect(airy.rowH - airy.cardH).toBeGreaterThan(tight.rowH - tight.cardH);
  });

  test("rows always keep room for sibling bars", () => {
    for (const template of TEMPLATE_IDS) {
      const m = metricsFor(look({ template, cardSize: 80, spacing: "tight" }));
      expect(m.rowH - m.cardH).toBeGreaterThanOrEqual(MIN_ROW_GAP);
    }
  });
});
