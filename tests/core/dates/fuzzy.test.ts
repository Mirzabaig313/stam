import { describe, expect, test } from "bun:test";

import {
  compareFuzzyDate,
  formatFuzzyDate,
  type FuzzyDate,
  lifespanLabel,
  parseFuzzyDate,
} from "@/core/dates/fuzzy";

const ok: [string, FuzzyDate][] = [
  ["1950", { year: 1950 }],
  ["1950-03", { year: 1950, month: 3 }],
  ["1950-03-14", { year: 1950, month: 3, day: 14 }],
  ["abt 1950", { qualifier: "about", year: 1950 }],
  ["~1950", { qualifier: "about", year: 1950 }],
  ["c. 1950", { qualifier: "about", year: 1950 }],
  ["bef 1950", { qualifier: "before", year: 1950 }],
  ["aft 1950-03", { qualifier: "after", year: 1950, month: 3 }],
  ["1948–1952", { qualifier: "between", year: 1948, toYear: 1952 }],
  ["1948-1952", { qualifier: "between", year: 1948, toYear: 1952 }],
  ["bet 1948 and 1952", { qualifier: "between", year: 1948, toYear: 1952 }],
  ["  2000-02-29 ", { year: 2000, month: 2, day: 29 }],
  ["ABOUT 1950", { qualifier: "about", year: 1950 }],
  ["Circa 1950", { qualifier: "about", year: 1950 }],
  ["ca 1950", { qualifier: "about", year: 1950 }],
  ["before 1950", { qualifier: "before", year: 1950 }],
  ["<1950", { qualifier: "before", year: 1950 }],
  ["after 1950", { qualifier: "after", year: 1950 }],
  [">1950-03-14", { qualifier: "after", year: 1950, month: 3, day: 14 }],
  ["1", { year: 1 }],
  ["9999", { year: 9999 }],
  ["1948 – 1952", { qualifier: "between", year: 1948, toYear: 1952 }],
  ["1950-1950", { qualifier: "between", year: 1950, toYear: 1950 }],
];

const bad = [
  "1950-13",
  "1900-02-29",
  "1952–1948",
  "abc",
  "0",
  "10000",
  "1950-00",
  "1950-04-31",
  "1950-03-00",
  "abt",
  "abt abt 1950",
  "bet 1952 and 1948",
  "1950-03-14-01",
];

describe("parseFuzzyDate", () => {
  test.each(ok)("parses %p", (input, date) => {
    expect(parseFuzzyDate(input)).toEqual({ ok: true, date });
  });

  test.each(bad)("rejects %p as INVALID", (input) => {
    expect(parseFuzzyDate(input)).toEqual({ ok: false, error: "INVALID" });
  });

  test("empty and whitespace-only input is EMPTY", () => {
    expect(parseFuzzyDate("")).toEqual({ ok: false, error: "EMPTY" });
    expect(parseFuzzyDate("   ")).toEqual({ ok: false, error: "EMPTY" });
  });

  test("accepts leap days only in Gregorian leap years", () => {
    expect(parseFuzzyDate("2000-02-29").ok).toBe(true);
    expect(parseFuzzyDate("2024-02-29").ok).toBe(true);
    expect(parseFuzzyDate("1900-02-29").ok).toBe(false);
    expect(parseFuzzyDate("2023-02-29").ok).toBe(false);
  });
});

describe("formatFuzzyDate", () => {
  test.each<[FuzzyDate, string]>([
    [{ year: 1950 }, "1950"],
    [{ year: 1950, month: 3 }, "Mar 1950"],
    [{ year: 1950, month: 3, day: 14 }, "14 Mar 1950"],
    [{ qualifier: "about", year: 1950 }, "abt 1950"],
    [{ qualifier: "before", year: 1950 }, "bef 1950"],
    [{ qualifier: "after", year: 1950 }, "aft 1950"],
    [{ qualifier: "after", year: 1950, month: 3 }, "aft Mar 1950"],
    [{ qualifier: "between", year: 1948, toYear: 1952 }, "1948–1952"],
  ])("formats %p as %p", (date, text) => {
    expect(formatFuzzyDate(date)).toBe(text);
  });
});

describe("compareFuzzyDate", () => {
  test("orders by year, then month, then day", () => {
    expect(compareFuzzyDate({ year: 1949 }, { year: 1950 })).toBeLessThan(0);
    expect(compareFuzzyDate({ year: 1950 }, { year: 1950, month: 1 })).toBeLessThan(0);
    expect(
      compareFuzzyDate({ year: 1950, month: 3, day: 2 }, { year: 1950, month: 3, day: 1 }),
    ).toBeGreaterThan(0);
    expect(compareFuzzyDate({ year: 1950, month: 3 }, { year: 1950, month: 3 })).toBe(0);
  });

  test("undefined sorts last", () => {
    expect(compareFuzzyDate({ year: 1950 }, undefined)).toBeLessThan(0);
    expect(compareFuzzyDate(undefined, { year: 1950 })).toBeGreaterThan(0);
    expect(compareFuzzyDate(undefined, undefined)).toBe(0);
  });
});

describe("lifespanLabel", () => {
  test("birth and death", () => {
    expect(lifespanLabel({ year: 1950 }, { year: 2019 })).toBe("1950 – †2019");
  });

  test("living person with birth only", () => {
    expect(lifespanLabel({ year: 1950 }, undefined, true)).toBe("1950");
  });

  test("unknown birth with death", () => {
    expect(lifespanLabel(undefined, { year: 2019 })).toBe("? – †2019");
  });

  test("no dates", () => {
    expect(lifespanLabel(undefined, undefined, false)).toBe("†");
    expect(lifespanLabel(undefined, undefined, true)).toBe("");
  });

  test("birth only, not marked living", () => {
    expect(lifespanLabel({ year: 1950 }, undefined, false)).toBe("1950 – †");
  });

  test("shows years only, keeping qualifiers", () => {
    expect(
      lifespanLabel(
        { year: 1950, month: 3, day: 14 },
        { qualifier: "about", year: 2019, month: 5 },
      ),
    ).toBe("1950 – †abt 2019");
  });
});
