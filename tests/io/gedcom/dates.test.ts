import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import type { FuzzyDate } from "@/core/dates/fuzzy";
import { formatGedcomDate, parseGedcomDate } from "@/io/gedcom/dates";

import { runs } from "../../fixtures/arbitraries";

describe("parseGedcomDate", () => {
  test.each<[string, FuzzyDate]>([
    ["1900", { year: 1900 }],
    ["MAR 1900", { year: 1900, month: 3 }],
    ["12 MAR 1900", { year: 1900, month: 3, day: 12 }],
    ["2 jan 1850", { year: 1850, month: 1, day: 2 }],
    ["ABT 1900", { qualifier: "about", year: 1900 }],
    ["CAL 1900", { qualifier: "about", year: 1900 }],
    ["EST 1900", { qualifier: "about", year: 1900 }],
    ["BEF 3 FEB 1900", { qualifier: "before", year: 1900, month: 2, day: 3 }],
    ["AFT 1900", { qualifier: "after", year: 1900 }],
    ["BET 1900 AND 1910", { qualifier: "between", year: 1900, toYear: 1910 }],
    ["BET MAR 1900 AND 1910", { qualifier: "between", year: 1900, month: 3, toYear: 1910 }],
    ["FROM 1900 TO 1910", { qualifier: "between", year: 1900, toYear: 1910 }],
    ["FROM 1900", { qualifier: "after", year: 1900 }],
    ["TO 1910", { qualifier: "before", year: 1910 }],
    ["INT 1900 (from a letter)", { qualifier: "about", year: 1900 }],
    ["@#DGREGORIAN@ 4 JUL 1776", { year: 1776, month: 7, day: 4 }],
    ["@#DJULIAN@ 1700", { year: 1700 }],
    ["JULIAN 1700", { year: 1700 }],
    ["11 FEB 1731/32", { year: 1731, month: 2, day: 11 }],
    ["  abt   1900  ", { qualifier: "about", year: 1900 }],
    ["29 FEB 2000", { year: 2000, month: 2, day: 29 }],
    // Lenient extras seen in real files.
    ["March 1900", { year: 1900, month: 3 }],
    ["1900-03-12", { year: 1900, month: 3, day: 12 }],
    ["c. 1900", { qualifier: "about", year: 1900 }],
    ["Abt. 1900", { qualifier: "about", year: 1900 }],
    ["about Mar 1900", { qualifier: "about", year: 1900, month: 3 }],
    ["circa 1900", { qualifier: "about", year: 1900 }],
    ["before 12 Mar 1900", { qualifier: "before", year: 1900, month: 3, day: 12 }],
    ["After 1900", { qualifier: "after", year: 1900 }],
    ["between 1900 and 1910", { qualifier: "between", year: 1900, toYear: 1910 }],
    ["1 Jan. 1900", { year: 1900, month: 1, day: 1 }],
  ])("%p", (input, expected) => {
    expect(parseGedcomDate(input)).toEqual(expected);
  });

  test.each([
    "",
    "(unknown)",
    "29 FEB 1900",
    "31 APR 1900",
    "@#DHEBREW@ 1 TSH 5660",
    "BET 1910 AND 1900",
    "0",
    "12 FOO 1900",
    "1900 B.C.",
    "ABT",
    "BET 1900",
  ])("%p is not a date we can keep", (input) => {
    expect(parseGedcomDate(input)).toBeUndefined();
  });
});

describe("formatGedcomDate", () => {
  test.each<[FuzzyDate, string]>([
    [{ year: 1900 }, "1900"],
    [{ year: 1900, month: 3 }, "MAR 1900"],
    [{ year: 1900, month: 3, day: 12 }, "12 MAR 1900"],
    [{ qualifier: "about", year: 1900 }, "ABT 1900"],
    [{ qualifier: "before", year: 1900, month: 2 }, "BEF FEB 1900"],
    [{ qualifier: "after", year: 1900 }, "AFT 1900"],
    [{ qualifier: "between", year: 1900, toYear: 1910 }, "BET 1900 AND 1910"],
    [
      { qualifier: "between", year: 1900, month: 3, day: 1, toYear: 1910 },
      "BET 1 MAR 1900 AND 1910",
    ],
    // Shapes GEDCOM cannot say keep what they can.
    [{ qualifier: "between", year: 1900 }, "1900"],
    [{ year: 1900, day: 5 }, "1900"],
  ])("%p", (date, expected) => {
    expect(formatGedcomDate(date)).toBe(expected);
  });

  test("a date without a usable year is not written", () => {
    expect(formatGedcomDate({ month: 3 })).toBeUndefined();
    expect(formatGedcomDate({ year: 0 })).toBeUndefined();
    expect(formatGedcomDate({ year: 10000 })).toBeUndefined();
  });

  test("every valid fuzzy date survives a write and a read", () => {
    const arbDate = fc
      .record({
        year: fc.integer({ min: 1, max: 9999 }),
        month: fc.option(fc.integer({ min: 1, max: 12 }), { nil: undefined }),
        day: fc.option(fc.integer({ min: 1, max: 28 }), { nil: undefined }),
        qualifier: fc.option(fc.constantFrom("about", "before", "after", "between" as const), {
          nil: undefined,
        }),
        span: fc.integer({ min: 0, max: 50 }),
      })
      .map(({ year, month, day, qualifier, span }): FuzzyDate => {
        const d: FuzzyDate = { year };
        if (month !== undefined) {
          d.month = month;
          if (day !== undefined) d.day = day;
        }
        if (qualifier) d.qualifier = qualifier;
        if (qualifier === "between") d.toYear = Math.min(9999, year + span);
        return d;
      });
    fc.assert(
      fc.property(arbDate, (d) => {
        expect(parseGedcomDate(formatGedcomDate(d)!)).toEqual(d);
      }),
      { numRuns: runs() },
    );
  });
});
