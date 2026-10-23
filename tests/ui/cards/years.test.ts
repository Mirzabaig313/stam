import { describe, expect, test } from "bun:test";

import type { FuzzyDate } from "@/core/dates/fuzzy";
import ar from "@/i18n/locales/ar.json";
import ur from "@/i18n/locales/ur.json";
import { lifeLine } from "@/ui/cards/years";

import { t, testI18n } from "../i18n";

const NOW = new Date(2026, 9, 24);

const p = (birth?: FuzzyDate, death?: FuzzyDate, isLiving = death === undefined) => ({
  isLiving,
  ...(birth ? { birth: { date: birth } } : {}),
  ...(death ? { death: { date: death } } : {}),
});

describe("lifeLine", () => {
  test("deceased with both years: the range and the age they reached, no †", () => {
    expect(lifeLine(p({ year: 1820 }, { year: 1900 }), t, NOW)).toBe("1820 – 1900 · 80 yrs");
  });

  test("living with a birth year: b. and today's age", () => {
    expect(lifeLine(p({ year: 1953 }), t, NOW)).toBe("b. 1953 · 73 yrs");
    expect(lifeLine(p(), t, NOW)).toBe("");
  });

  test("approximate dates give an approximate age", () => {
    expect(lifeLine(p({ year: 1820, qualifier: "about" }, { year: 1900 }), t, NOW)).toBe(
      "abt 1820 – 1900 · ~80 yrs",
    );
  });

  test("one known end: d. for the death year, a question mark for the other", () => {
    expect(lifeLine(p(undefined, { year: 1994 }), t, NOW)).toBe("d. 1994");
    expect(lifeLine(p({ year: 1920 }, undefined, false), t, NOW)).toBe("1920 – ?");
  });

  test("a deceased person with no years has no line at all, never a lone †", () => {
    expect(lifeLine(p(undefined, undefined, false), t, NOW)).toBe("");
  });

  test("dates that make no sense keep the years but drop the age", () => {
    expect(lifeLine(p({ year: 1900 }, { year: 1850 }), t, NOW)).toBe("1900 – 1850");
  });

  test("RTL: the year range is isolated left to right; the words flow around it", () => {
    expect(lifeLine(p({ year: 1820 }, { year: 1900 }), t, NOW, "rtl")).toBe(
      "⁦1820 – 1900⁩ · 80 yrs",
    );
  });

  test("Urdu and Arabic word it in their own language", () => {
    testI18n.addResourceBundle("ur", "translation", ur);
    testI18n.addResourceBundle("ar", "translation", ar);
    for (const [lang, line] of [
      ["ur", "پیدائش 1953 · 73 سال"],
      ["ar", "وُلد 1953 · 73 سنة"],
    ] as const) {
      const tl = testI18n.getFixedT(lang);
      expect(lifeLine(p({ year: 1953 }), tl, NOW)).toBe(line);
    }
  });
});
