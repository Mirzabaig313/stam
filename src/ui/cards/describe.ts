import type { TFunction } from "i18next";

import { formatFuzzyDate, type FuzzyDate } from "@/core/dates/fuzzy";
import { displayName, parentsOf } from "@/core/model/tree";
import type { Person, TreeDocument } from "@/core/model/types";

/** The name shown for a person: their name, "Unknown father/mother", or "Unnamed person". */
export function personLabel(person: Person, t: TFunction): string {
  const name = displayName(person);
  if (name) return name;
  if (person.isPlaceholder) {
    return t(person.gender === "male" ? "canvas.unknownFather" : "canvas.unknownMother");
  }
  return t("canvas.describe.unnamed");
}

/** "1950", "abt 1950": the year with its qualifier, without day and month. */
function yearOf(date: FuzzyDate | undefined): string {
  return date ? formatFuzzyDate({ ...date, month: undefined, day: undefined }) : "";
}

/**
 * Everyone's biological parents (as `parentsOf` gives them), in one pass over the unions: for
 * labelling many people at once without a scan of every union per person.
 */
export function biologicalParents(doc: TreeDocument): Map<string, readonly string[]> {
  const parents = new Map<string, readonly string[]>();
  for (const union of Object.values(doc.unions)) {
    for (const child of union.children) {
      if (child.type === "biological" && !parents.has(child.personId)) {
        parents.set(child.personId, union.partners);
      }
    }
  }
  return parents;
}

/**
 * The screen-reader label of a card, e.g. "Ali Khan, born 1950, son of Ahmed Khan and Sara Khan".
 * `linked` marks a linked copy; `hiddenCount` mentions a collapsed branch. `parents` (from
 * `biologicalParents`) saves looking the parents up.
 */
export function describePerson(
  doc: TreeDocument,
  personId: string,
  t: TFunction,
  extra: {
    linked?: boolean;
    hiddenCount?: number;
    parents?: ReadonlyMap<string, readonly string[]>;
  } = {},
): string {
  const person = doc.persons[personId];
  if (!person) return "";
  const parts = [personLabel(person, t)];

  const born = yearOf(person.birth?.date);
  if (born) parts.push(t("canvas.describe.born", { date: born }));
  const died = yearOf(person.death?.date);
  if (died) parts.push(t("canvas.describe.died", { date: died }));

  const parents = (extra.parents ? (extra.parents.get(personId) ?? []) : parentsOf(doc, personId))
    .map((id) => doc.persons[id])
    .filter((p): p is Person => p !== undefined)
    .map((p) => personLabel(p, t));
  if (parents.length > 0) {
    const names =
      parents.length === 2
        ? t("canvas.describe.twoParents", { first: parents[0], second: parents[1] })
        : parents[0];
    const key = person.gender === "male" ? "canvas.describe.sonOf" : "canvas.describe.daughterOf";
    parts.push(t(key, { parents: names }));
  }

  if (extra.linked) parts.push(t("canvas.describe.linked"));
  if (extra.hiddenCount) parts.push(t("canvas.describe.hidden", { count: extra.hiddenCount }));
  return parts.join(", ");
}
