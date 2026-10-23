import { describe, expect, test } from "bun:test";

import { ageLabel, ageOf } from "@/core/dates/age";
import type { FuzzyDate } from "@/core/dates/fuzzy";

const NOW = new Date(2026, 9, 24); // 24 Oct 2026

const p = (birth?: FuzzyDate, death?: FuzzyDate, isLiving = death === undefined) => ({
  isLiving,
  ...(birth ? { birth: { date: birth } } : {}),
  ...(death ? { death: { date: death } } : {}),
});

describe("ageOf and ageLabel", () => {
  test("deceased with both years: the age they died at", () => {
    expect(ageLabel(p({ year: 1820 }, { year: 1900 }), NOW)).toBe("80 yrs");
  });

  test("living with a birth year: today's age", () => {
    expect(ageLabel(p({ year: 1953 }), NOW)).toBe("73 yrs");
  });

  test("full dates count whole years, one less before the birthday", () => {
    expect(ageOf(p({ year: 1953, month: 11, day: 2 }), NOW)).toEqual({
      years: 72,
      approximate: false,
    });
    expect(ageOf(p({ year: 1953, month: 10, day: 24 }), NOW)?.years).toBe(73);
    expect(
      ageOf(p({ year: 1900, month: 6, day: 10 }, { year: 1980, month: 6, day: 9 }), NOW)?.years,
    ).toBe(79);
  });

  test("partial dates: a month without a day counts the month only", () => {
    expect(ageOf(p({ year: 1953, month: 11 }), NOW)?.years).toBe(72);
    expect(ageOf(p({ year: 1953, month: 10 }), NOW)?.years).toBe(73);
    expect(ageOf(p({ year: 1900, month: 6 }, { year: 1980 }), NOW)?.years).toBe(80);
  });

  test("approximate dates give an approximate age", () => {
    expect(ageLabel(p({ year: 1820, qualifier: "about" }, { year: 1900 }), NOW)).toBe("~80 yrs");
    expect(ageLabel(p({ year: 1820 }, { year: 1900, qualifier: "before" }), NOW)).toBe("~80 yrs");
    expect(
      ageLabel(p({ year: 1818, toYear: 1822, qualifier: "between" }, { year: 1900 }), NOW),
    ).toBe("~80 yrs");
  });

  test("unknown: no birth year, or deceased with no death year", () => {
    expect(ageLabel(p(), NOW)).toBe("");
    expect(ageLabel(p(undefined, { year: 1900 }), NOW)).toBe("");
    expect(ageLabel(p({ year: 1820 }, undefined, false), NOW)).toBe("");
    expect(ageLabel({ isLiving: false, death: {} }, NOW)).toBe("");
  });

  test("invalid dates give no age", () => {
    expect(ageOf(p({ year: 1900 }, { year: 1850 }), NOW)).toBeNull();
    expect(
      ageOf(p({ year: 1900, month: 6, day: 10 }, { year: 1900, month: 1, day: 1 }), NOW),
    ).toBeNull();
    expect(ageOf(p({ year: 2040 }), NOW)).toBeNull();
    expect(ageOf(p({ year: 1850 }), NOW)).toBeNull(); // "living" at 176
    expect(ageOf(p({ year: 1900, toYear: 1890, qualifier: "between" }), NOW)).toBeNull();
  });

  test("a baby is 0, and one year is singular; the words can be translated", () => {
    expect(ageLabel(p({ year: 2026, month: 3 }), NOW)).toBe("0 yrs");
    expect(ageLabel(p({ year: 2025, month: 3 }), NOW)).toBe("1 yr");
    expect(ageLabel(p({ year: 1953 }), NOW, (n) => `${n} سال`)).toBe("73 سال");
  });
});
