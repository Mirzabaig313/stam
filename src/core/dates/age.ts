import type { Person } from "@/core/model/types";

import type { FuzzyDate } from "./fuzzy";

/** Older than this, a "living" person's age is a data mistake, not an age. */
const MAX_AGE = 130;

export type Age = { years: number; approximate: boolean };

/** A date's year, and whether it is exact enough to count from (no qualifier, a real year). */
function yearOf(d: FuzzyDate | undefined): { year: number; approximate: boolean } | null {
  if (!d || d.year === undefined || !Number.isInteger(d.year)) return null;
  if (d.qualifier === "between") {
    if (d.toYear === undefined || d.toYear < d.year) return null;
    return { year: Math.round((d.year + d.toYear) / 2), approximate: true };
  }
  return { year: d.year, approximate: d.qualifier !== undefined };
}

/** Whole years from `from` to `to`, one less when the birthday has not come yet that year. */
function wholeYears(from: FuzzyDate, to: { year: number; month?: number; day?: number }): number {
  let years = to.year - from.year!;
  if (from.month !== undefined && to.month !== undefined) {
    const before =
      to.month < from.month ||
      (to.month === from.month &&
        from.day !== undefined &&
        to.day !== undefined &&
        to.day < from.day);
    if (before) years -= 1;
  }
  return years;
}

/**
 * How old a person is (living, from their birth to `now`) or was when they died (from birth to
 * death). Approximate when either date is (about, before, after, a range). Null when it can't be
 * told: no birth year, a deceased person with no death year, or dates that make no sense (death
 * before birth, a birth in the future, a living person over 130).
 */
export function ageOf(person: Pick<Person, "birth" | "death" | "isLiving">, now: Date): Age | null {
  const born = yearOf(person.birth?.date);
  if (!born) return null;
  const deceased = person.death !== undefined || person.isLiving === false;
  let years: number;
  let approximate = born.approximate;
  if (deceased) {
    const died = yearOf(person.death?.date);
    if (!died) return null;
    if (died.year < born.year) return null;
    approximate ||= died.approximate;
    const death = person.death!.date!;
    years = approximate
      ? died.year - born.year
      : wholeYears(person.birth!.date!, { year: died.year, month: death.month, day: death.day });
    if (years < 0) return null;
  } else {
    const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    years = approximate ? today.year - born.year : wholeYears(person.birth!.date!, today);
    if (born.year > today.year || years > MAX_AGE) return null;
  }
  return { years: Math.max(0, years), approximate };
}

/**
 * The age as a short label: "80 yrs", "~80 yrs" when approximate, "" when unknown. `format`
 * words it (the app passes its translated "{{count}} yrs"); the default is English.
 */
export function ageLabel(
  person: Pick<Person, "birth" | "death" | "isLiving">,
  now: Date,
  format: (years: number) => string = (n) => `${n} ${n === 1 ? "yr" : "yrs"}`,
): string {
  const age = ageOf(person, now);
  if (!age) return "";
  return `${age.approximate ? "~" : ""}${format(age.years)}`;
}
