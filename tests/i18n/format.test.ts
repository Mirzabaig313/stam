import { afterEach, describe, expect, test } from "bun:test";

import { formatFuzzyDate } from "@/core/dates/fuzzy";
import { i18n, setLanguage } from "@/i18n";
import { formatDate } from "@/i18n/format";

afterEach(() => setLanguage("en"));

const t = (...args: Parameters<typeof i18n.t>) => i18n.t(...args);
const intl = (lang: string, o: Intl.DateTimeFormatOptions, y: number, m = 1, d = 1) =>
  new Intl.DateTimeFormat(lang, { ...o, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));

const y = (n: number) => intl("ur", { year: "numeric" }, n);

describe("formatDate", () => {
  test("English keeps the genealogists' short form", () => {
    for (const d of [
      { year: 1950 },
      { year: 1950, month: 3, day: 14 },
      { year: 1950, qualifier: "about" as const },
      { year: 1948, toYear: 1952, qualifier: "between" as const },
    ]) {
      expect(formatDate(d, "en", t)).toBe(formatFuzzyDate(d));
    }
  });

  test("Urdu and Arabic name the month and order the parts as the locale does, through Intl", async () => {
    await setLanguage("ar");
    const long = { year: "numeric", month: "long", day: "numeric" } as const;
    expect(formatDate({ year: 1950, month: 3, day: 14 }, "ar", t)).toBe(
      intl("ar", long, 1950, 3, 14),
    );
    expect(formatDate({ year: 1950, month: 3 }, "ar", t)).toBe(
      intl("ar", { year: "numeric", month: "long" }, 1950, 3),
    );
    expect(formatDate({ year: 1950 }, "ar", t)).toBe(intl("ar", { year: "numeric" }, 1950));
    expect(formatDate({ year: 1950, month: 3, day: 14 }, "ar", t)).toContain("مارس");
  });

  test("qualifiers are words of the language", async () => {
    await setLanguage("ur");
    expect(formatDate({ year: 1950, qualifier: "about" }, "ur", t)).toBe(`تقریباً ${y(1950)}`);
    expect(formatDate({ year: 1950, qualifier: "before" }, "ur", t)).toBe(`${y(1950)} سے پہلے`);
    expect(formatDate({ year: 1948, toYear: 1952, qualifier: "between" }, "ur", t)).toBe(
      `${y(1948)} تا ${y(1952)}`,
    );
    expect(formatDate({}, "ur", t)).toBe("");
  });
});
