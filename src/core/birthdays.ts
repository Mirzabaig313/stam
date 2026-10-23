import type { FuzzyDate } from "@/core/dates/fuzzy";
import type { Person, TreeDocument } from "@/core/model/types";

export type UpcomingBirthday = {
  personId: string;
  /** The day it is celebrated this time round (Feb 29 is Mar 1 in a non-leap year). */
  date: { month: number; day: number };
  /** The age they reach; null without a birth year. */
  turning: number | null;
  /** 0 = today. */
  inDays: number;
};

export type OnThisDay = {
  personId: string;
  kind: "birth" | "death" | "union";
  year: number;
  unionId?: string;
};

const DAY_MS = 86_400_000;
/** Nobody is presumed to be living past this age, whatever the record says. */
export const MAX_PRESUMED_AGE = 110;

/**
 * Whether to treat someone as living on `now` for birthdays and the timeline: marked living, no
 * death date, and not born more than `MAX_PRESUMED_AGE` years ago (an old record nobody updated).
 */
export function presumedLiving(person: Person, now: Date): boolean {
  if (!person.isLiving || person.death?.date?.year !== undefined) return false;
  const born = person.birth?.date?.year;
  return born === undefined || now.getFullYear() - born <= MAX_PRESUMED_AGE;
}
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** A real calendar day (Feb 29 counts: it is a valid birthday). */
function validDay(date: FuzzyDate | undefined): { month: number; day: number } | null {
  const month = date?.month;
  const day = date?.day;
  if (month === undefined || day === undefined) return null;
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12) return null;
  if (day < 1 || day > (DAYS_IN_MONTH[month - 1] ?? 0)) return null;
  return { month, day };
}

/** The day the anniversary is kept in `year`: Feb 29 moves to Mar 1 when there is none. */
function keptOn(year: number, md: { month: number; day: number }): { month: number; day: number } {
  return md.month === 2 && md.day === 29 && !isLeap(year) ? { month: 3, day: 1 } : md;
}

/** Midnight UTC of a calendar day: differences of these are whole days, whatever the time zone. */
const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY_MS;

function todayOf(today: Date) {
  return { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
}

/**
 * Living people (see `presumedLiving`) with a known birth month and day whose birthday is within `days` days of `today`
 * (today counts), soonest first. Ties go by person id.
 */
export function upcomingBirthdays(doc: TreeDocument, today: Date, days = 30): UpcomingBirthday[] {
  const now = todayOf(today);
  const start = dayNumber(now.year, now.month, now.day);
  const out: UpcomingBirthday[] = [];
  for (const person of Object.values(doc.persons)) {
    if (!presumedLiving(person, today) || person.isPlaceholder) continue;
    const md = validDay(person.birth?.date);
    if (!md) continue;
    for (const year of [now.year, now.year + 1]) {
      const on = keptOn(year, md);
      const inDays = dayNumber(year, on.month, on.day) - start;
      if (inDays < 0) continue;
      if (inDays <= days) {
        const born = person.birth?.date?.year;
        out.push({
          personId: person.id,
          date: on,
          turning: born === undefined ? null : year - born,
          inDays,
        });
      }
      break;
    }
  }
  return out.toSorted((a, b) => a.inDays - b.inDays || (a.personId < b.personId ? -1 : 1));
}

/** Births, deaths and union starts that happened on today's month and day, oldest first. */
export function onThisDay(doc: TreeDocument, today: Date): OnThisDay[] {
  const now = todayOf(today);
  const matches = (date: FuzzyDate | undefined): number | null => {
    const md = validDay(date);
    if (!md || date?.year === undefined) return null;
    const on = keptOn(now.year, md);
    return on.month === now.month && on.day === now.day ? date.year : null;
  };
  const out: OnThisDay[] = [];
  for (const person of Object.values(doc.persons)) {
    if (person.isPlaceholder) continue;
    const born = matches(person.birth?.date);
    if (born !== null) out.push({ personId: person.id, kind: "birth", year: born });
    const died = matches(person.death?.date);
    if (died !== null) out.push({ personId: person.id, kind: "death", year: died });
  }
  for (const union of Object.values(doc.unions)) {
    const began = matches(union.start);
    const first = union.partners[0];
    if (began !== null)
      out.push({ personId: first, kind: "union", year: began, unionId: union.id });
  }
  return out.toSorted(
    (a, b) =>
      a.year - b.year ||
      (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0) ||
      (a.kind < b.kind ? -1 : 1),
  );
}
