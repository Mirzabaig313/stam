import type { Person, TreeDocument } from "@/core/model/types";

/** Lower-case, decompose (NFD) and drop combining marks: "Zoë" -> "zoe". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** What a query is matched against: each name field on its own, plus "first last". */
function candidates(p: Person): string[] {
  const full = `${p.firstName} ${p.lastName}`.trim();
  return [p.firstName, p.lastName, p.nickname, p.nativeName, full]
    .map((field) => (field ? fold(field.trim()) : ""))
    .filter(Boolean);
}

/**
 * People whose first name, last name, nickname or native name match `query`, best first.
 * Case- and diacritic-insensitive. Prefix matches rank before substring matches; ties keep
 * document order. A blank query matches nobody.
 */
export function searchPeople(doc: TreeDocument, query: string, limit = 20): string[] {
  const needle = fold(query.trim());
  if (needle === "" || limit <= 0) return [];

  const prefix: string[] = [];
  const inside: string[] = [];
  for (const person of Object.values(doc.persons)) {
    const fields = candidates(person);
    if (fields.some((f) => f.startsWith(needle))) prefix.push(person.id);
    else if (fields.some((f) => f.includes(needle))) inside.push(person.id);
  }
  return [...prefix, ...inside].slice(0, limit);
}
