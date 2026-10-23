import { formatFuzzyDate, type FuzzyDate } from "@/core/dates/fuzzy";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function plain(d: FuzzyDate, language: string): string {
  if (d.year === undefined) return "";
  const options: Intl.DateTimeFormatOptions = { year: "numeric", timeZone: "UTC" };
  if (d.month !== undefined) options.month = "long";
  if (d.month !== undefined && d.day !== undefined) options.day = "numeric";
  const date = new Date(Date.UTC(2000, (d.month ?? 1) - 1, d.day ?? 1));
  date.setUTCFullYear(d.year); // years before 100 stay as written
  return new Intl.DateTimeFormat(language, options).format(date);
}

/**
 * A fuzzy date for display in the interface language: month names, order and digits from Intl
 * (Arabic-Indic digits only where the locale writes them by default), qualifiers from the
 * "dates" strings. English keeps the short genealogical form ("abt 14 Mar 1950").
 */
export function formatDate(d: FuzzyDate, language: string, t: Translate): string {
  if (language.split("-")[0] === "en") return formatFuzzyDate(d);
  if (d.qualifier === "between" && d.year !== undefined && d.toYear !== undefined) {
    return t("dates.between", {
      from: plain({ year: d.year }, language),
      to: plain({ year: d.toYear }, language),
    });
  }
  const date = plain(d, language);
  if (date === "" || !d.qualifier || d.qualifier === "between") return date;
  return t(`dates.${d.qualifier}`, { date });
}
