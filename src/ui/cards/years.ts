import type { TFunction } from "i18next";

import { ageLabel } from "@/core/dates/age";
import { formatFuzzyDate, type FuzzyDate } from "@/core/dates/fuzzy";
import type { Person } from "@/core/model/types";

const yearOf = (d: FuzzyDate | undefined) =>
  d ? formatFuzzyDate({ ...d, month: undefined, day: undefined }) : "";

/** Left-to-right text kept left to right inside an RTL line (LRI … PDI); unchanged in LTR. */
const ltr = (text: string, dir: "ltr" | "rtl") => (dir === "rtl" ? `⁦${text}⁩` : text);

/**
 * The life line of a person, as cards and the person panel show it, with no "†" (no font the
 * app ships draws a proper dagger):
 * - deceased with both years: "1820 – 1900 · 80 yrs" ("~80 yrs" when a date is approximate);
 * - living with a birth year: "b. 1953 · 73 yrs";
 * - deceased with one year: "d. 1900", or "1820 – ?";
 * - nothing known: "" (a deceased card shows a quiet "Deceased" tag instead).
 * The year range always reads left to right; in RTL it is isolated so the words around it flow.
 */
export function lifeLine(
  person: Pick<Person, "birth" | "death" | "isLiving">,
  t: TFunction,
  now: Date = new Date(),
  dir: "ltr" | "rtl" = "ltr",
): string {
  const born = yearOf(person.birth?.date);
  const died = yearOf(person.death?.date);
  const deceased = person.death !== undefined || person.isLiving === false;
  const age = ageLabel(person, now, (count) => t("canvas.age", { count }));
  const withAge = (text: string) => (age ? `${text} · ${age}` : text);
  if (!deceased) return born ? withAge(t("canvas.years.born", { year: ltr(born, dir) })) : "";
  if (born && died) return withAge(ltr(`${born} – ${died}`, dir));
  if (died) return t("canvas.years.died", { year: ltr(died, dir) });
  if (born) return ltr(`${born} – ?`, dir);
  return "";
}

/**
 * Just the years, for tight spots (the fan's segments, the timeline's bars): "1920 – 1994",
 * "? – 1994", "1920 – ?", or the birth year of a living person. No "†" and no age.
 */
export function yearRange(person: Pick<Person, "birth" | "death" | "isLiving">): string {
  const born = yearOf(person.birth?.date);
  const died = yearOf(person.death?.date);
  const deceased = person.death !== undefined || person.isLiving === false;
  if (!deceased) return born;
  if (!born && !died) return "";
  return `${born || "?"} – ${died || "?"}`;
}
