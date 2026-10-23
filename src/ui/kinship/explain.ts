import { describeRelationship } from "@/core/kinship/describe";
import { relate } from "@/core/kinship/relate";
import { describeIn } from "@/core/kinship/sentences";
import type { Relationship, Translate } from "@/core/kinship/types";
import { urduTerm } from "@/core/kinship/urdu";
import type { TreeDocument } from "@/core/model/types";
import { personLabel } from "@/ui/cards/describe";

/** The kinship calculator's functions (lane K); a parameter so tests can use small fakes. */
export type KinshipFns = {
  relate: typeof relate;
  describeRelationship: typeof describeRelationship;
  urduTerm: typeof urduTerm;
};

export const realKinship: KinshipFns = { relate, describeRelationship, urduTerm };

/** A sentence in pieces: text, and where the two names go (to be isolated with `<bdi>`). */
export type SentencePart = string | { name: "a" | "b" };

export type Explanation = {
  aId: string;
  bId: string;
  /** Every distinct sentence, closest first (identical sentences merged). Empty when unrelated. */
  results: { text: string; urdu: string | null; parts: SentencePart[] }[];
  /** Person ids from A to B along the closest relationship: what the canvas highlights. */
  path: string[];
};

type T = Parameters<typeof personLabel>[1];

/** Stand-ins for the names while the sentence is built: private-use characters no locale uses. */
const A_MARK = "\uE000";
const B_MARK = "\uE001";

function partsOf(template: string): SentencePart[] {
  return template
    .split(/(\uE000|\uE001)/)
    .filter((piece) => piece !== "")
    .map((piece) => (piece === A_MARK ? { name: "a" } : piece === B_MARK ? { name: "b" } : piece));
}

/**
 * What changes a relationship: who is linked to whom, and each person's sex and birth date (for
 * the words and for elder/younger). Not names: renaming someone only changes the sentences.
 */
export function kinshipKey(doc: TreeDocument): string {
  let key = "";
  for (const p of Object.values(doc.persons)) {
    const b = p.birth?.date;
    key += `${p.id}:${p.gender}:${b?.year ?? ""}.${b?.month ?? ""}.${b?.day ?? ""}.${b?.qualifier ?? ""};`;
  }
  return key;
}

/**
 * "A is B's …" for every way the two are related, with the Urdu term where Urdu has one. Null when
 * either person is missing or both are the same person (there is nothing to compare).
 */
export function explainRelation(
  doc: TreeDocument,
  aId: string | null,
  bId: string | null,
  t: T,
  fns: KinshipFns = realKinship,
  language = "en",
): Explanation | null {
  if (aId === null || bId === null || aId === bId) return null;
  const a = doc.persons[aId];
  const b = doc.persons[bId];
  if (!a || !b) return null;
  return phraseRelations(doc, aId, bId, fns.relate(doc, aId, bId), t, fns, language);
}

/**
 * The sentences for relationships `relate` already worked out (see `explainRelation`), in the
 * interface `language`. In Urdu the sentence already has the Urdu word, so `urdu` stays null.
 */
export function phraseRelations(
  doc: TreeDocument,
  aId: string,
  bId: string,
  rels: Relationship[],
  t: T,
  fns: KinshipFns = realKinship,
  language = "en",
): Explanation | null {
  const a = doc.persons[aId];
  const b = doc.persons[bId];
  if (!a || !b) return null;
  const names = { a: personLabel(a, t), b: personLabel(b, t) };
  const translate: Translate = (key, options) => t(key, options);
  const base = language.split("-")[0];
  const describe = base === "ur" || base === "ar" ? describeIn(base) : fns.describeRelationship;
  // Pedigree collapse can give the same sentence along two lines (a great-grandson through both
  // parents): one row each, the first line's Urdu term and path.
  const results: Explanation["results"] = [];
  const seen = new Set<string>();
  for (const rel of rels) {
    const parts = partsOf(describe(rel, A_MARK, B_MARK, translate));
    const text = parts.map((p) => (typeof p === "string" ? p : names[p.name])).join("");
    if (seen.has(text)) continue;
    seen.add(text);
    results.push({ text, urdu: base === "ur" ? null : fns.urduTerm(rel), parts });
  }
  return { aId, bId, results, path: rels[0]?.path ?? [] };
}
