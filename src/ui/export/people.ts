import type { TFunction } from "i18next";

import { type FuzzyDate, lifespanLabel } from "@/core/dates/fuzzy";
import type { Person, TreeDocument } from "@/core/model/types";
import type { ExportPerson } from "@/export/types";
import { formatDate } from "@/i18n/format";
import { personLabel } from "@/ui/cards/describe";

function when(
  place: string | undefined,
  date: Person["birth"],
  includeDates: boolean,
  format: (d: FuzzyDate) => string,
): string {
  const parts = [includeDates && date?.date ? format(date.date) : "", place?.trim() ?? ""].filter(
    Boolean,
  );
  return parts.join(", ");
}

/**
 * The details-panel data of the interactive HTML export, for the given people. Pass the document
 * after privacy has been applied: this adds nothing back, and leaves dates out when asked.
 * Dates are written for `language` (see `formatDate`).
 */
export function buildPeople(
  doc: TreeDocument,
  personIds: readonly string[],
  opts: { includeDates: boolean },
  t: TFunction,
  language = "en",
): ExportPerson[] {
  const format = (d: FuzzyDate) => formatDate(d, language, (key, options) => t(key, options));
  const people: ExportPerson[] = [];
  for (const id of new Set(personIds)) {
    const p = doc.persons[id];
    if (!p) continue;
    const details: ExportPerson["details"] = [];
    const born = when(p.birth?.place, p.birth, opts.includeDates, format);
    if (born) details.push({ label: t("export.detail.born"), value: born });
    const died = when(p.death?.place, p.death, opts.includeDates, format);
    if (died) details.push({ label: t("export.detail.died"), value: died });
    if (p.notes?.trim()) details.push({ label: t("export.detail.notes"), value: p.notes.trim() });
    people.push({
      id,
      name: personLabel(p, t),
      ...(p.nativeName ? { nativeName: p.nativeName } : {}),
      lifespan: opts.includeDates ? lifespanLabel(p.birth?.date, p.death?.date, p.isLiving) : "",
      details,
    });
  }
  return people;
}
