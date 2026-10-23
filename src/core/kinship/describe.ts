import type { Relationship, Translate } from "./types";

// English (and later other languages) sentences for a relationship. All words come from the
// "kinship" group of the locale through `t`, so core never imports i18n.

/** Up to this many "great-" prefixes are spelled out; beyond it, "4th great-grandfather". */
const SPELLED_GREATS = 3;
/** Ordinals spelled as words ("first" … "tenth"); beyond it, "12th". */
const SPELLED_ORDINALS = 10;

function ordinal(n: number, t: Translate): string {
  return n >= 1 && n <= SPELLED_ORDINALS
    ? t(`kinship.ordinal.${n}`)
    : t("kinship.nth", { count: n, ordinal: true });
}

function withGreats(term: string, greats: number, t: Translate): string {
  if (greats > SPELLED_GREATS) {
    // Genealogists write "4th great-grandfather", with a numeral.
    return t("kinship.greatN", { term, nth: t("kinship.nth", { count: greats, ordinal: true }) });
  }
  let result = term;
  for (let i = 0; i < greats; i++) result = t("kinship.great", { term: result });
  return result;
}

function removal(n: number, t: Translate): string {
  if (n === 1) return t("kinship.removal1");
  if (n === 2) return t("kinship.removal2");
  return t("kinship.removalN", { count: n });
}

/** The relationship word, e.g. "first cousin once removed" or "great-aunt". */
export function relationTerm(rel: Relationship, t: Translate): string {
  if (rel.adopted && (rel.kind === "parent" || rel.kind === "child")) {
    // Adoption is said outright: "adopted son", "adoptive mother".
    return t(`kinship.term.${rel.kind}Adopted_${rel.sexOfA}`);
  }
  const base = t(`kinship.term.${rel.kind}_${rel.sexOfA}`);
  switch (rel.kind) {
    case "cousin": {
      let term = t("kinship.cousin", { nth: ordinal(rel.degree ?? 1, t), term: base });
      if (rel.removal) term = t("kinship.removed", { term, removal: removal(rel.removal, t) });
      return rel.half ? t("kinship.halfLong", { term }) : term;
    }
    case "grandparent":
    case "grandchild":
    case "auncleByMarriage":
    case "niblingByMarriage":
    case "auncleInLaw":
    case "niblingInLaw":
    case "grandparentInLaw":
    case "grandchildInLaw":
      return withGreats(base, rel.greats, t);
    case "sibling":
    case "auncle":
    case "nibling": {
      const term = withGreats(base, rel.greats, t);
      if (!rel.half) return term;
      return t(rel.greats > 0 ? "kinship.halfLong" : "kinship.half", { term });
    }
    default:
      return base;
  }
}

/** "Noor is Adam's first cousin once removed": A relative to B, gendered by A. */
export function describeRelationship(
  rel: Relationship,
  aName: string,
  bName: string,
  t: Translate,
): string {
  if (rel.kind === "self") return t("kinship.same", { a: aName, b: bName });
  return t("kinship.sentence", { a: aName, b: bName, relation: relationTerm(rel, t) });
}
