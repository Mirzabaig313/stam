export type FuzzyDate = {
  qualifier?: "about" | "before" | "after" | "between";
  year?: number;
  month?: number;
  day?: number;
  toYear?: number;
};

export type ParseFuzzyDateResult =
  { ok: true; date: FuzzyDate } | { ok: false; error: "EMPTY" | "INVALID" };

// English only for now; localized in M4.
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MIN_YEAR = 1;
const MAX_YEAR = 9999;

const INVALID: ParseFuzzyDateResult = { ok: false, error: "INVALID" };

const PREFIX = /^(about|abt|circa|ca|c\.|~|before|bef|<|after|aft|>)\s*(.*)$/i;
const BETWEEN_WORDS = /^(?:bet|between)\s+(\d{1,4})\s+and\s+(\d{1,4})$/i;
const BETWEEN_DASH = /^(\d{1,4})\s*[–-]\s*(\d{3,4})$/;
const DATE = /^(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/;

function qualifierFor(prefix: string): "about" | "before" | "after" {
  const p = prefix.toLowerCase();
  if (p === "bef" || p === "before" || p === "<") return "before";
  if (p === "aft" || p === "after" || p === ">") return "after";
  return "about";
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function validYear(year: number): boolean {
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

function parseRange(input: string): FuzzyDate | undefined {
  const match = BETWEEN_WORDS.exec(input) ?? BETWEEN_DASH.exec(input);
  if (!match) return undefined;
  const year = Number(match[1]);
  const toYear = Number(match[2]);
  if (!validYear(year) || !validYear(toYear) || toYear < year) return undefined;
  return { qualifier: "between", year, toYear };
}

function parsePlainDate(input: string): FuzzyDate | undefined {
  const match = DATE.exec(input);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (!validYear(year)) return undefined;
  const date: FuzzyDate = { year };
  if (match[2] !== undefined) {
    const month = Number(match[2]);
    if (month < 1 || month > 12) return undefined;
    date.month = month;
    if (match[3] !== undefined) {
      const day = Number(match[3]);
      if (day < 1 || day > daysInMonth(year, month)) return undefined;
      date.day = day;
    }
  }
  return date;
}

export function parseFuzzyDate(input: string): ParseFuzzyDateResult {
  const text = input.trim();
  if (text === "") return { ok: false, error: "EMPTY" };

  const range = parseRange(text);
  if (range) return { ok: true, date: range };

  const prefixed = PREFIX.exec(text);
  const body = prefixed ? (prefixed[2] ?? "") : text;
  const date = parsePlainDate(body);
  if (!date) return INVALID;
  if (prefixed) date.qualifier = qualifierFor(prefixed[1] ?? "");
  return { ok: true, date };
}

function formatPlain(d: FuzzyDate): string {
  if (d.year === undefined) return "";
  const parts: string[] = [];
  if (d.month !== undefined) {
    if (d.day !== undefined) parts.push(String(d.day));
    parts.push(MONTH_NAMES[d.month - 1] ?? "");
  }
  parts.push(String(d.year));
  return parts.join(" ");
}

export function formatFuzzyDate(d: FuzzyDate): string {
  if (d.qualifier === "between" && d.year !== undefined && d.toYear !== undefined) {
    return `${d.year}–${d.toYear}`;
  }
  const plain = formatPlain(d);
  if (plain === "") return "";
  switch (d.qualifier) {
    case "about":
      return `abt ${plain}`;
    case "before":
      return `bef ${plain}`;
    case "after":
      return `aft ${plain}`;
    default:
      return plain;
  }
}

function sortKey(d: FuzzyDate): [number, number, number] {
  return [d.year ?? 0, d.month ?? 0, d.day ?? 0];
}

export function compareFuzzyDate(a?: FuzzyDate, b?: FuzzyDate): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    const diff = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Same date by value: field by field, so key order and undefined fields do not matter. */
export function sameFuzzyDate(a?: FuzzyDate, b?: FuzzyDate): boolean {
  if (!a || !b) return a === b;
  return (
    a.qualifier === b.qualifier &&
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.toYear === b.toYear
  );
}

function yearLabel(d: FuzzyDate): string {
  return formatFuzzyDate({ ...d, month: undefined, day: undefined });
}

export function lifespanLabel(birth?: FuzzyDate, death?: FuzzyDate, isLiving?: boolean): string {
  const born = birth ? yearLabel(birth) : "";
  const died = death ? yearLabel(death) : "";
  if (death) return `${born || "?"} – †${died}`;
  if (isLiving) return born;
  return born ? `${born} – †` : "†";
}
