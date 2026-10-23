import type { Person, TreeDocument, Union } from "@/core/model/types";

/** Living as the card reads it: a death record makes a person deceased whatever `isLiving` says. */
export function isLivingPerson(p: Person): boolean {
  return p.isLiving && p.death === undefined;
}

function mapPersons(doc: TreeDocument, fn: (p: Person) => Person): Record<string, Person> {
  return Object.fromEntries(Object.entries(doc.persons).map(([id, p]) => [id, fn(p)]));
}

function mapUnions(doc: TreeDocument, fn: (u: Union) => Union): Record<string, Union> {
  return Object.fromEntries(Object.entries(doc.unions).map(([id, u]) => [id, fn(u)]));
}

function undated(u: Union): Union {
  const { start: _start, end: _end, ...rest } = u;
  return rest;
}

/**
 * Privacy mode (FR-X10): a living person keeps their names and nothing else personal (no dates,
 * places, photo or notes). A union with a living partner loses its dates too. Deceased people are
 * kept as they are. Returns a new document; the input is not changed.
 */
export function applyPrivacy(doc: TreeDocument): TreeDocument {
  const living = new Set(
    Object.values(doc.persons)
      .filter(isLivingPerson)
      .map((p) => p.id),
  );
  return {
    ...doc,
    persons: mapPersons(doc, (p) => {
      if (!living.has(p.id)) return p;
      const { birth: _b, death: _d, photoId: _photo, notes: _notes, ...names } = p;
      return names;
    }),
    unions: mapUnions(doc, (u) => (u.partners.some((id) => living.has(id)) ? undated(u) : u)),
  };
}

/**
 * The "dates" option turned off: birth, death and union dates go; places stay. A deceased person
 * keeps an (empty) death record, so the card still marks them with "†".
 */
export function withoutDates(doc: TreeDocument): TreeDocument {
  return {
    ...doc,
    persons: mapPersons(doc, (p) => {
      if (!p.birth?.date && !p.death?.date) return p;
      const { birth, death, ...rest } = p;
      const out: Person = { ...rest };
      if (birth?.place !== undefined) out.birth = { place: birth.place };
      if (death) out.death = death.place === undefined ? {} : { place: death.place };
      return out;
    }),
    unions: mapUnions(doc, (u) => (u.start || u.end ? undated(u) : u)),
  };
}
