import { arabicTerm } from "./arabic";
import { describeRelationship, relationTerm } from "./describe";
import type { Relationship, Translate } from "./types";
import { urduTerm } from "./urdu";

// Relationship sentences in Urdu and Arabic. Their grammar differs from English ("A is B's …"),
// so it is built here rather than through one template: the Urdu possessive agrees with the
// relation word, and Arabic puts the word straight before B's name. Where a language has its own
// word (urduTerm, arabicTerm) that is used; otherwise the locale's general "kinship" words, as
// `relationTerm` composes them through `t`.
//
// REVIEW NEEDED: machine-assisted, like the words they use. A native speaker of each language
// should check the sentence shapes before the Urdu and Arabic locales ship.

export type Describe = (rel: Relationship, aName: string, bName: string, t: Translate) => string;

/** "علی، احمد کا چچا ہے": A, B's <relation> is. کا for a male relative's word, کی for a female's. */
export const describeRelationshipUr: Describe = (rel, aName, bName, t) => {
  if (rel.kind === "self") return t("kinship.same", { a: aName, b: bName });
  const term = urduTerm(rel) ?? relationTerm(rel, t);
  const of = rel.sexOfA === "male" ? "کا" : "کی";
  return `${aName}، ${bName} ${of} ${term} ہے`;
};

/**
 * "علي هو عم أحمد": A he/she <relation> B, the word before B's name. A composed phrase without a
 * short word ("أخ غير شقيق") takes لـ instead: "علي هو أخ غير شقيق لـأحمد".
 */
export const describeRelationshipAr: Describe = (rel, aName, bName, t) => {
  if (rel.kind === "self") return t("kinship.same", { a: aName, b: bName });
  const pronoun = rel.sexOfA === "male" ? "هو" : "هي";
  const term = arabicTerm(rel);
  if (term) return `${aName} ${pronoun} ${term} ${bName}`;
  return `${aName} ${pronoun} ${relationTerm(rel, t)} لـ${bName}`;
};

/** The sentence builder for an interface language ("ur", "ar-EG", "en" …); English otherwise. */
export function describeIn(language: string): Describe {
  const base = language.split("-")[0];
  if (base === "ur") return describeRelationshipUr;
  if (base === "ar") return describeRelationshipAr;
  return describeRelationship;
}
