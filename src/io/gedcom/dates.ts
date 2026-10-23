import { type FuzzyDate, parseFuzzyDate } from "@/core/dates/fuzzy";

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const FULL_MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;

const MIN_YEAR = 1;
const MAX_YEAR = 9999;

type Calendar = "gregorian" | "julian";

/** A plain GEDCOM date: `[[day] month] year`, the year possibly dual ("1731/32"). */
const PLAIN = /^(?:(\d{1,2}) )?(?:([A-Z]{3,9}) )?(\d{1,4})(?:\/\d{1,4})?$/;

function monthNumber(token: string): number | undefined {
  const short = MONTHS.indexOf(token as (typeof MONTHS)[number]);
  if (short >= 0) return short + 1;
  // Full or longer abbreviations seen in hand-made files: "MARCH", "SEPT".
  const full = FULL_MONTHS.findIndex((m) => m.startsWith(token));
  return full >= 0 && token.length >= 3 ? full + 1 : undefined;
}

function daysInMonth(year: number, month: number, calendar: Calendar): number {
  if (month === 2) {
    const leap =
      calendar === "julian"
        ? year % 4 === 0
        : (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function parsePlain(text: string, calendar: Calendar): FuzzyDate | undefined {
  const match = PLAIN.exec(text);
  if (!match) return undefined;
  const year = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return undefined;
  const date: FuzzyDate = { year };
  if (match[2] !== undefined) {
    const month = monthNumber(match[2]);
    if (month === undefined) return undefined;
    date.month = month;
    if (match[1] !== undefined) {
      const day = Number(match[1]);
      if (day < 1 || day > daysInMonth(year, month, calendar)) return undefined;
      date.day = day;
    }
  } else if (match[1] !== undefined) {
    return undefined; // a day with no month
  }
  return date;
}

/**
 * Removes calendar markers (5.5.1 `@#DJULIAN@`, 7.0 `JULIAN`). Gregorian and Julian dates read
 * the same way; any other calendar (Hebrew, French Republican) cannot be kept.
 */
function stripCalendar(text: string): { text: string; calendar: Calendar } | undefined {
  let calendar: Calendar = "gregorian";
  let ok = true;
  const out = text
    .replace(/@#D([A-Z_ ]+?)@/g, (_all, name: string) => {
      const n = name.trim();
      if (n === "JULIAN") calendar = "julian";
      else if (n !== "GREGORIAN") ok = false;
      return " ";
    })
    .replace(/\b(GREGORIAN|JULIAN|HEBREW|FRENCH_R)\b/g, (name: string) => {
      if (name === "JULIAN") calendar = "julian";
      else if (name !== "GREGORIAN") ok = false;
      return " ";
    })
    .replace(/ +/g, " ")
    .trim();
  return ok ? { text: out, calendar } : undefined;
}

function parseGedcomForm(raw: string): FuzzyDate | undefined {
  const upper = raw
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    // Spellings seen in hand-made files: "Abt.", "about", "before", "between", "Jan.".
    .replace(/\b([A-Z]{3,9})\.(?= )/g, "$1")
    .replace(/^(ABOUT|CIRCA|CA)\b/, "ABT")
    .replace(/^BEFORE\b/, "BEF")
    .replace(/^AFTER\b/, "AFT")
    .replace(/^BETWEEN\b/, "BET");
  // INT carries a phrase in brackets; the date in front of it is what we keep.
  const phraseless = upper.replace(/^INT (.*?) ?\(.*\)$/, "INT $1");
  const stripped = stripCalendar(phraseless);
  if (!stripped) return undefined;
  const { text, calendar } = stripped;
  const plain = (s: string) => parsePlain(s.trim(), calendar);

  const range = /^(?:BET (.+) AND|FROM (.+) TO) (.+)$/.exec(text);
  if (range) {
    const from = plain(range[1] ?? range[2] ?? "");
    const to = plain(range[3] ?? "");
    if (!from || !to || to.year! < from.year!) return undefined;
    return { qualifier: "between", ...from, toYear: to.year! };
  }

  const prefixed = /^(ABT|CAL|EST|INT|BEF|AFT|FROM|TO) (.+)$/.exec(text);
  if (prefixed) {
    const date = plain(prefixed[2]!);
    if (!date) return undefined;
    const word = prefixed[1]!;
    const qualifier =
      word === "BEF" || word === "TO"
        ? "before"
        : word === "AFT" || word === "FROM"
          ? "after"
          : "about";
    return { qualifier, ...date };
  }

  return plain(text);
}

/**
 * Reads a GEDCOM date value (5.5.1 or 7.0) as a `FuzzyDate`. Returns undefined for anything that
 * cannot be kept faithfully: date phrases, other calendars, B.C. years, impossible days.
 * Lenient: falls back to the app's own date syntax ("1900-03-12", "c. 1900").
 */
export function parseGedcomDate(raw: string): FuzzyDate | undefined {
  const date = parseGedcomForm(raw);
  if (date) return date;
  const own = parseFuzzyDate(raw);
  return own.ok ? own.date : undefined;
}

function formatPlain(year: number, month?: number, day?: number): string {
  if (month === undefined || month < 1 || month > 12) return String(year);
  const name = MONTHS[month - 1]!;
  const dayOk = day !== undefined && day >= 1 && day <= daysInMonth(year, month, "gregorian");
  return dayOk ? `${day} ${name} ${year}` : `${name} ${year}`;
}

const validYear = (y: number | undefined): y is number =>
  y !== undefined && Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR;

/** Writes a `FuzzyDate` as a GEDCOM 5.5.1 date. Undefined when there is no usable year. */
export function formatGedcomDate(d: FuzzyDate): string | undefined {
  if (!validYear(d.year)) return undefined;
  const plain = formatPlain(d.year, d.month, d.day);
  switch (d.qualifier) {
    case "about":
      return `ABT ${plain}`;
    case "before":
      return `BEF ${plain}`;
    case "after":
      return `AFT ${plain}`;
    case "between":
      return validYear(d.toYear) && d.toYear >= d.year ? `BET ${plain} AND ${d.toYear}` : plain;
    default:
      return plain;
  }
}
