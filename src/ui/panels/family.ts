import type { FuzzyDate } from "@/core/dates/fuzzy";
import { siblingsOf, unionsOf } from "@/core/model/tree";
import type { ChildType, Person, TreeDocument, Union } from "@/core/model/types";
import { formatDate } from "@/i18n/format";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type Family = {
  /** Birth parents first, then adoptive, step or foster parents, each with how they are linked. */
  parents: { personId: string; childType: ChildType }[];
  /** Spouses: the unions that have a second partner, in order. A union of one is not a spouse. */
  partnerships: { union: Union; partnerId: string }[];
  /** Every union of the person, single-parent ones too: where their children are recorded. */
  unions: Union[];
  /** Children of every union, each once, with the union they belong to. */
  children: { personId: string; childType: ChildType; unionId: string }[];
  siblings: { personId: string; half: boolean }[];
};

/** The person's close family, as the panel's Family section lists it. */
export function familyOf(doc: TreeDocument, personId: string): Family {
  const exists = (id: string) => doc.persons[id] !== undefined;

  const parents: Family["parents"] = [];
  const seenParents = new Set<string>();
  const parentLinks = Object.values(doc.unions).flatMap((union) => {
    const link = union.children.find((c) => c.personId === personId);
    return link ? [{ union, childType: link.type }] : [];
  });
  // Birth parents lead; the rest keep the document's order.
  parentLinks.sort(
    (a, b) => Number(a.childType !== "biological") - Number(b.childType !== "biological"),
  );
  for (const { union, childType } of parentLinks) {
    for (const id of union.partners) {
      if (seenParents.has(id) || !exists(id)) continue;
      seenParents.add(id);
      parents.push({ personId: id, childType });
    }
  }

  const unions = unionsOf(doc, personId);
  const partnerships: Family["partnerships"] = [];
  for (const union of unions) {
    const partnerId = union.partners.find((id) => id !== personId && exists(id));
    if (partnerId !== undefined) partnerships.push({ union, partnerId });
  }

  const children: Family["children"] = [];
  const seenChildren = new Set<string>();
  for (const union of unions) {
    for (const child of union.children) {
      if (seenChildren.has(child.personId) || !exists(child.personId)) continue;
      seenChildren.add(child.personId);
      children.push({ personId: child.personId, childType: child.type, unionId: union.id });
    }
  }

  const siblings = siblingsOf(doc, personId).filter((s) => exists(s.personId));
  return { parents, partnerships, unions, children, siblings };
}

/** "1950", "abt 1950": a date down to its year, in the interface language. */
function yearText(date: FuzzyDate | undefined, language: string, t: Translate): string {
  if (!date || date.year === undefined) return "";
  return formatDate({ ...date, month: undefined, day: undefined }, language, t);
}

/**
 * The profile's summary lines: the years ("1900 – 1985", "Born 1950", "Died 1990", or nothing:
 * never a lone dagger) and one place, where they were born or else where they died.
 */
export function lifeSummary(
  person: Person,
  language: string,
  t: Translate,
): { years: string; place: string } {
  const born = yearText(person.birth?.date, language, t);
  const died = yearText(person.death?.date, language, t);
  let years = "";
  if (born && died) years = t("panel.summary.span", { born, died });
  else if (born) years = t("panel.summary.born", { date: born });
  else if (died) years = t("panel.summary.died", { date: died });
  const place = person.birth?.place?.trim() || person.death?.place?.trim() || "";
  return { years, place };
}
