// A small relationship calculator for the landing page demo. It only has to be right for the
// sample family: blood relatives through a common ancestor, partners, step-parents and in-laws.
// The full calculator (FR-K1..K6) is a later milestone.

import type { Gender, TreeDocument } from "@/core/model/types";

import type { SampleDoc } from "./family";
import { samplePerson } from "./family";

export type Kinship = {
  /** "Lena is Noor's first cousin once removed." */
  sentence: string;
  /** Keys along the connecting path, from a to b. */
  path: string[];
};

type Graph = {
  parents: Map<string, string[]>;
  partners: Map<string, { key: string; former: boolean }[]>;
  gender: Map<string, Gender>;
};

function graphOf(sample: SampleDoc): Graph {
  const { doc, keyOf } = sample;
  const key = (id: string) => keyOf[id] ?? id;
  const parents = new Map<string, string[]>();
  const partners = new Map<string, { key: string; former: boolean }[]>();
  const gender = new Map<string, Gender>();
  for (const person of Object.values(doc.persons)) gender.set(key(person.id), person.gender);
  for (const union of Object.values((doc as TreeDocument).unions)) {
    const ps = union.partners.map(key);
    for (const child of union.children) parents.set(key(child.personId), ps);
    const former = union.status === "divorced" || union.status === "separated";
    if (ps.length === 2) {
      const [a, b] = ps as [string, string];
      partners.set(a, [...(partners.get(a) ?? []), { key: b, former }]);
      partners.set(b, [...(partners.get(b) ?? []), { key: a, former }]);
    }
  }
  return { parents, partners, gender };
}

/** Every ancestor with its distance, the person included at 0, and the path down to them. */
function ancestors(g: Graph, start: string): Map<string, string[]> {
  const found = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const parent of g.parents.get(current) ?? []) {
      if (found.has(parent)) continue;
      found.set(parent, [...found.get(current)!, parent]);
      queue.push(parent);
    }
  }
  return found;
}

const ORDINAL = ["", "first", "second", "third", "fourth", "fifth"];
const TIMES = ["", "once", "twice", "three times", "four times"];

function word(g: Gender | undefined, male: string, female: string): string {
  return g === "male" ? male : female;
}

/** "great-great-grand" prefixes for a distance of 2 or more generations. */
function grand(distance: number): string {
  if (distance < 2) return "";
  return "great-".repeat(distance - 2) + "grand";
}

/** The blood relationship of a to b, with a at `da` and b at `db` steps from a shared ancestor. */
function bloodTerm(gA: Gender | undefined, da: number, db: number, half: boolean): string {
  if (da === 0) {
    const base = word(gA, "father", "mother");
    return db === 1 ? base : `${grand(db)}${base}`;
  }
  if (db === 0) {
    const base = word(gA, "son", "daughter");
    return da === 1 ? base : `${grand(da)}${base}`;
  }
  if (da === 1 && db === 1) return `${half ? "half-" : ""}${word(gA, "brother", "sister")}`;
  if (da === 1) {
    const base = word(gA, "uncle", "aunt");
    return db === 2 ? base : `${"great-".repeat(db - 2)}${base}`;
  }
  if (db === 1) {
    const base = word(gA, "nephew", "niece");
    return da === 2 ? base : `${"great-".repeat(da - 2)}${base}`;
  }
  const degree = Math.min(da, db) - 1;
  const removed = Math.abs(da - db);
  const cousin = `${ORDINAL[degree] ?? `${degree}th`} cousin`;
  return removed === 0 ? cousin : `${cousin} ${TIMES[removed] ?? `${removed} times`} removed`;
}

type Found = { term: string; path: string[] };

function blood(g: Graph, a: string, b: string): Found | undefined {
  const upA = ancestors(g, a);
  const upB = ancestors(g, b);
  let best: { anc: string; da: number; db: number } | undefined;
  for (const [anc, pathA] of upA) {
    const pathB = upB.get(anc);
    if (!pathB) continue;
    const da = pathA.length - 1;
    const db = pathB.length - 1;
    if (!best || da + db < best.da + best.db) best = { anc, da, db };
  }
  if (!best) return undefined;
  const pathA = upA.get(best.anc)!;
  const pathB = upB.get(best.anc)!;
  let half = false;
  if (best.da === 1 && best.db === 1) {
    const pa = new Set(g.parents.get(a) ?? []);
    const shared = (g.parents.get(b) ?? []).filter((p) => pa.has(p)).length;
    half = shared < 2 && pa.size === 2;
  }
  return {
    term: bloodTerm(g.gender.get(a), best.da, best.db, half),
    path: [...pathA, ...pathB.toReversed().slice(1)],
  };
}

/** a's blood relationship to b's partner, seen from b. A partner's child is a step-child (above). */
const IN_LAW: Record<string, string> = {
  father: "father-in-law",
  mother: "mother-in-law",
  brother: "brother-in-law",
  sister: "sister-in-law",
  // A partner's nephew is simply your nephew.
  nephew: "nephew",
  niece: "niece",
};

/** Relationship of a to b, as a sentence, plus the path to highlight. */
export function relationship(sample: SampleDoc, a: string, b: string): Kinship {
  const g = graphOf(sample);
  const nameA = samplePerson(a).first;
  const nameB = samplePerson(b).first;
  const say = (term: string, path: string[]): Kinship => ({
    sentence: `${nameA} is ${nameB}’s ${term}.`,
    path,
  });
  if (a === b) return { sentence: `That’s ${nameA} twice. Pick someone else.`, path: [a] };

  const partner = (g.partners.get(a) ?? []).find((p) => p.key === b);
  if (partner) {
    const term = word(g.gender.get(a), "husband", "wife");
    return say(partner.former ? `former ${term}` : term, [a, b]);
  }

  const direct = blood(g, a, b);
  if (direct) return say(direct.term, direct.path);

  // Step-parent: a is the current partner of b's parent.
  const current = (person: string, other: string) =>
    (g.partners.get(person) ?? []).some((p) => p.key === other && !p.former);
  for (const parent of g.parents.get(b) ?? []) {
    if (current(parent, a)) {
      return say(word(g.gender.get(a), "stepfather", "stepmother"), [a, parent, b]);
    }
  }
  for (const parent of g.parents.get(a) ?? []) {
    if (current(parent, b)) {
      return say(word(g.gender.get(a), "stepson", "stepdaughter"), [a, parent, b]);
    }
  }

  // In-laws: a is a blood relative of b's partner, or a is the partner of b's relative.
  for (const { key: spouse, former } of g.partners.get(b) ?? []) {
    const viaSpouse = blood(g, a, spouse);
    if (viaSpouse && IN_LAW[viaSpouse.term]) {
      const term = IN_LAW[viaSpouse.term]!;
      return say(former && term.endsWith("-in-law") ? `former ${term}` : term, [
        ...viaSpouse.path,
        b,
      ]);
    }
  }
  for (const { key: spouse, former } of g.partners.get(a) ?? []) {
    const viaSpouse = blood(g, spouse, b);
    const pair = viaSpouse && PARTNER_OF[viaSpouse.term];
    if (viaSpouse && pair && !(former && pair[0].startsWith("step"))) {
      const term = word(g.gender.get(a), pair[0], pair[1]);
      return say(former && term.endsWith("-in-law") ? `former ${term}` : term, [
        a,
        ...viaSpouse.path,
      ]);
    }
  }

  return (
    marriedInto(g, a, b) ??
    marriedInto(g, b, a) ?? {
      sentence: `${nameA} and ${nameB} are related by marriage.`,
      path: [a, b],
    }
  );
}

/** The partner of b's son is b's son-in-law or daughter-in-law, and so on. */
const PARTNER_OF: Record<string, [string, string]> = {
  son: ["son-in-law", "daughter-in-law"],
  daughter: ["son-in-law", "daughter-in-law"],
  brother: ["brother-in-law", "sister-in-law"],
  sister: ["brother-in-law", "sister-in-law"],
  father: ["stepfather", "stepmother"],
  mother: ["stepfather", "stepmother"],
  uncle: ["uncle", "aunt"],
  aunt: ["uncle", "aunt"],
};

/** "Omar is married to Clara, Theo's great-aunt." when no single word fits. */
function marriedInto(g: Graph, a: string, b: string): Kinship | undefined {
  for (const { key: spouse, former } of g.partners.get(a) ?? []) {
    const viaSpouse = blood(g, spouse, b);
    if (!viaSpouse) continue;
    const verb = former ? "was married to" : "is married to";
    return {
      sentence: `${samplePerson(a).first} ${verb} ${samplePerson(spouse).first}, ${samplePerson(b).first}’s ${viaSpouse.term}.`,
      path: [a, ...viaSpouse.path],
    };
  }
  return undefined;
}
