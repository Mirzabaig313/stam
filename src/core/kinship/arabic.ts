import type { Relationship } from "./types";

// Arabic kinship words, in the form that goes straight before B's name (an idafa): "عم أحمد" is
// Ahmad's paternal uncle, "ابن خالة أحمد" his mother's sister's son. Arabic names uncles, aunts and
// first cousins by side and by the linking parent's sex; it doesn't name grandparents by side.
//
// REVIEW NEEDED: machine-assisted. Every term here (including حمو / حماة for parents-in-law,
// كنّة for a daughter-in-law, ربيب / ربيبة for stepchildren, and زوج أم / زوجة أب for
// step-parents) must be checked by a native Arabic speaker before the Arabic locale ships.

type Pair = readonly [male: string, female: string];

const pick = (rel: Relationship, [male, female]: Pair) => (rel.sexOfA === "male" ? male : female);

const BASIC: Partial<Record<Relationship["kind"], Pair>> = {
  parent: ["أب", "أم"],
  child: ["ابن", "ابنة"],
  spouse: ["زوج", "زوجة"],
  exSpouse: ["طليق", "طليقة"],
  fiance: ["خطيب", "خطيبة"],
  partner: ["شريك", "شريكة"],
  stepParent: ["زوج أم", "زوجة أب"],
  stepChild: ["ربيب", "ربيبة"],
  parentInLaw: ["حمو", "حماة"],
  childInLaw: ["صهر", "كنّة"],
};

/** A parent's sibling by side and sex: عم, عمة, خال, خالة. */
function auncleWord(side: "paternal" | "maternal", sex: "male" | "female"): string {
  if (side === "paternal") return sex === "male" ? "عم" : "عمة";
  return sex === "male" ? "خال" : "خالة";
}

/**
 * Arabic word for "A is B's …", to be followed by B's name, or null when Arabic has no short
 * word for it (half-siblings, great-grandparents, second cousins…).
 */
export function arabicTerm(rel: Relationship): string | null {
  if (rel.adopted) return null;
  const basic = BASIC[rel.kind];
  if (basic) return pick(rel, basic);

  switch (rel.kind) {
    case "sibling":
      return rel.half ? null : pick(rel, ["أخ", "أخت"]);
    case "grandparent":
      return rel.greats === 0 ? pick(rel, ["جد", "جدة"]) : null;
    case "grandchild":
      return rel.greats === 0 ? pick(rel, ["حفيد", "حفيدة"]) : null;
    case "auncle":
      if (rel.greats !== 0 || rel.half || !rel.side) return null;
      return auncleWord(rel.side, rel.sexOfA);
    case "nibling":
      if (rel.greats !== 0 || rel.half || !rel.viaSex) return null;
      return `${pick(rel, ["ابن", "ابنة"])} ${rel.viaSex === "male" ? "أخ" : "أخت"}`;
    case "cousin":
      // A first cousin is a son or daughter of B's uncle or aunt: A's parent on the path.
      if (rel.degree !== 1 || rel.removal || rel.half || !rel.side || !rel.viaSex) return null;
      return `${pick(rel, ["ابن", "ابنة"])} ${auncleWord(rel.side, rel.viaSex)}`;
    case "auncleByMarriage":
      // The partner of B's uncle or aunt: زوجة عم, زوج عمة, زوجة خال, زوج خالة.
      if (rel.greats !== 0 || !rel.side || !rel.partnerSex) return null;
      return `${pick(rel, ["زوج", "زوجة"])} ${auncleWord(rel.side, rel.partnerSex)}`;
    default:
      return null;
  }
}
