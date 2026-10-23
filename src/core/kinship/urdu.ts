import type { Relationship } from "./types";

// Urdu kinship words, in Urdu script, for the relationships Urdu names with a single word.
// They depend on the side (دادا vs نانا), on the sex of the linking person (بھتیجا vs بھانجا)
// and, for a father's brother, on age (تایا is older than the father, چچا younger or unknown).
//
// REVIEW NEEDED: the project owner does not read Urdu. Every term in this file (including the
// choice of سوتیلا for both half- and step-siblings, لے پالک for adopted children, منگیتر for
// both fiancé and fiancée, and the "بھتیجے کی بیوی" phrases for a nephew's or niece's partner)
// must be checked by a native Urdu speaker before M4 ships the Urdu locale.

type Pair = readonly [male: string, female: string];

const pick = (rel: Relationship, [male, female]: Pair) => (rel.sexOfA === "male" ? male : female);

const BASIC: Partial<Record<Relationship["kind"], Pair>> = {
  parent: ["والد", "والدہ"],
  child: ["بیٹا", "بیٹی"],
  spouse: ["شوہر", "بیوی"],
  exSpouse: ["سابق شوہر", "سابقہ بیوی"],
  fiance: ["منگیتر", "منگیتر"],
  stepParent: ["سوتیلا باپ", "سوتیلی ماں"],
  stepChild: ["سوتیلا بیٹا", "سوتیلی بیٹی"],
  stepSibling: ["سوتیلا بھائی", "سوتیلی بہن"],
  parentInLaw: ["سسر", "ساس"],
  childInLaw: ["داماد", "بہو"],
};

const GRANDPARENT = {
  paternal: [
    ["دادا", "دادی"],
    ["پردادا", "پردادی"],
  ],
  maternal: [
    ["نانا", "نانی"],
    ["پرنانا", "پرنانی"],
  ],
} as const satisfies Record<string, Pair[]>;

/** By the sex of A's parent: a son's child or a daughter's child. */
const GRANDCHILD = {
  male: [
    ["پوتا", "پوتی"],
    ["پرپوتا", "پرپوتی"],
  ],
  female: [
    ["نواسا", "نواسی"],
    ["پرنواسا", "پرنواسی"],
  ],
} as const satisfies Record<string, Pair[]>;

/** Urdu word for "A is B's …", or null when Urdu has no single word for it. */
export function urduTerm(rel: Relationship): string | null {
  if (rel.adopted) {
    // لے پالک بیٹا / بیٹی for the adopted child; no single everyday word for the adoptive parent.
    return rel.kind === "child" ? pick(rel, ["لے پالک بیٹا", "لے پالک بیٹی"]) : null;
  }
  const basic = BASIC[rel.kind];
  if (basic) return pick(rel, basic);

  switch (rel.kind) {
    case "sibling":
      // سوتیلا covers half-siblings as well as step-siblings in everyday Urdu.
      return pick(rel, rel.half ? ["سوتیلا بھائی", "سوتیلی بہن"] : ["بھائی", "بہن"]);
    case "grandparent": {
      const pair = rel.side && GRANDPARENT[rel.side][rel.greats];
      return pair ? pick(rel, pair) : null;
    }
    case "grandchild": {
      const pair = rel.viaSex && GRANDCHILD[rel.viaSex][rel.greats];
      return pair ? pick(rel, pair) : null;
    }
    case "auncle":
      if (rel.greats !== 0 || !rel.side) return null;
      if (rel.side === "paternal") {
        return rel.sexOfA === "male" ? (rel.elder ? "تایا" : "چچا") : "پھوپھی";
      }
      return pick(rel, ["ماموں", "خالہ"]);
    case "nibling":
      if (rel.greats !== 0 || !rel.viaSex) return null;
      return pick(rel, rel.viaSex === "male" ? ["بھتیجا", "بھتیجی"] : ["بھانجا", "بھانجی"]);
    case "auncleByMarriage":
      // The partner of a parent's sibling: چچی / تائی (father's brother's wife), پھوپھا (father's
      // sister's husband), ممانی (mother's brother's wife), خالو (mother's sister's husband).
      if (rel.greats !== 0 || !rel.side || !rel.partnerSex) return null;
      if (rel.partnerSex === "male") {
        if (rel.side === "paternal") return rel.elder ? "تائی" : "چچی";
        return "ممانی";
      }
      return rel.side === "paternal" ? "پھوپھا" : "خالو";
    case "niblingInLaw": {
      // "Brother's son's wife": the nephew or niece's word, then "wife" or "husband".
      if (rel.greats !== 0 || !rel.viaSex || !rel.partnerSex) return null;
      const nephew = rel.viaSex === "male" ? "بھتیجے" : "بھانجے";
      const niece = rel.viaSex === "male" ? "بھتیجی" : "بھانجی";
      return rel.partnerSex === "male" ? `${nephew} کی بیوی` : `${niece} کا شوہر`;
    }
    default:
      return null;
  }
}
