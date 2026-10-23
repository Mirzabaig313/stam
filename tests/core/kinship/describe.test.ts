import { describe, expect, test } from "bun:test";

import i18next from "i18next";

import { describeRelationship } from "@/core/kinship/describe";
import { relate } from "@/core/kinship/relate";
import type { Relationship } from "@/core/kinship/types";
import en from "@/i18n/locales/en.json";

import { famAdoption } from "../../fixtures/families";
import { famKinship } from "./family";

const i18n = i18next.createInstance();
await i18n.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
const t = i18n.t;

const rel = (
  kind: Relationship["kind"],
  sexOfA: Relationship["sexOfA"],
  extra: Partial<Relationship> = {},
): Relationship => ({ kind, sexOfA, greats: 0, half: false, path: [], ...extra });

const M = "male" as const;
const F = "female" as const;

const cases: [Relationship, string, string, string][] = [
  // The sentences from the plan.
  [
    rel("cousin", F, { degree: 1, removal: 1 }),
    "Noor",
    "Adam",
    "Noor is Adam's first cousin once removed",
  ],
  [rel("sibling", M, { half: true }), "Ali", "Sara", "Ali is Sara's half-brother"],
  [rel("auncle", F, { greats: 2 }), "Zara", "Omar", "Zara is Omar's great-great-aunt"],
  [rel("siblingInLaw", F), "Hina", "Ahmed", "Hina is Ahmed's sister-in-law"],
  // Parents, children, grandparents and grandchildren.
  [rel("parent", M), "A", "B", "A is B's father"],
  [rel("parent", F), "A", "B", "A is B's mother"],
  [rel("child", M), "A", "B", "A is B's son"],
  [rel("child", F), "A", "B", "A is B's daughter"],
  [rel("grandparent", M), "A", "B", "A is B's grandfather"],
  [rel("grandparent", F, { greats: 1 }), "A", "B", "A is B's great-grandmother"],
  [rel("grandparent", M, { greats: 3 }), "A", "B", "A is B's great-great-great-grandfather"],
  [rel("grandparent", M, { greats: 4 }), "A", "B", "A is B's 4th great-grandfather"],
  [rel("grandchild", F), "A", "B", "A is B's granddaughter"],
  [rel("grandchild", M, { greats: 2 }), "A", "B", "A is B's great-great-grandson"],
  // Siblings, uncles and aunts, nephews and nieces.
  [rel("sibling", F), "A", "B", "A is B's sister"],
  [rel("sibling", F, { half: true }), "A", "B", "A is B's half-sister"],
  [rel("auncle", M), "A", "B", "A is B's uncle"],
  [rel("auncle", M, { half: true }), "A", "B", "A is B's half-uncle"],
  [rel("auncle", F, { greats: 1, half: true }), "A", "B", "A is B's half great-aunt"],
  [rel("auncle", M, { greats: 5 }), "A", "B", "A is B's 5th great-uncle"],
  [rel("nibling", F), "A", "B", "A is B's niece"],
  [rel("nibling", M, { greats: 1 }), "A", "B", "A is B's great-nephew"],
  [rel("nibling", M, { half: true }), "A", "B", "A is B's half-nephew"],
  // Cousins.
  [rel("cousin", M, { degree: 1, removal: 0 }), "A", "B", "A is B's first cousin"],
  [rel("cousin", F, { degree: 2, removal: 0 }), "A", "B", "A is B's second cousin"],
  [rel("cousin", M, { degree: 3, removal: 2 }), "A", "B", "A is B's third cousin twice removed"],
  [rel("cousin", M, { degree: 1, removal: 3 }), "A", "B", "A is B's first cousin 3 times removed"],
  [rel("cousin", F, { degree: 1, removal: 0, half: true }), "A", "B", "A is B's half first cousin"],
  [rel("cousin", M, { degree: 12, removal: 0 }), "A", "B", "A is B's 12th cousin"],
  [rel("cousin", M, { degree: 21, removal: 1 }), "A", "B", "A is B's 21st cousin once removed"],
  // Spouses, step relations and in-laws.
  [rel("spouse", M), "A", "B", "A is B's husband"],
  [rel("spouse", F), "A", "B", "A is B's wife"],
  [rel("exSpouse", F), "A", "B", "A is B's ex-wife"],
  [rel("exSpouse", M), "A", "B", "A is B's ex-husband"],
  [rel("stepParent", F), "A", "B", "A is B's stepmother"],
  [rel("stepParent", M), "A", "B", "A is B's stepfather"],
  [rel("stepChild", M), "A", "B", "A is B's stepson"],
  [rel("stepChild", F), "A", "B", "A is B's stepdaughter"],
  [rel("stepSibling", F), "A", "B", "A is B's stepsister"],
  [rel("stepSibling", M), "A", "B", "A is B's stepbrother"],
  [rel("parentInLaw", M), "A", "B", "A is B's father-in-law"],
  [rel("parentInLaw", F), "A", "B", "A is B's mother-in-law"],
  [rel("childInLaw", M), "A", "B", "A is B's son-in-law"],
  [rel("childInLaw", F), "A", "B", "A is B's daughter-in-law"],
  [rel("siblingInLaw", M), "A", "B", "A is B's brother-in-law"],
  [rel("otherInLaw", F), "A", "B", "A is B's relative by marriage"],
  // Engaged and unmarried couples.
  [rel("fiance", M), "A", "B", "A is B's fiancé"],
  [rel("fiance", F), "A", "B", "A is B's fiancée"],
  [rel("partner", M), "A", "B", "A is B's partner"],
  [rel("partner", F), "A", "B", "A is B's partner"],
  // By marriage.
  [rel("auncleByMarriage", M), "A", "B", "A is B's uncle by marriage"],
  [rel("auncleByMarriage", F), "A", "B", "A is B's aunt by marriage"],
  [rel("auncleByMarriage", F, { greats: 1 }), "A", "B", "A is B's great-aunt by marriage"],
  [rel("niblingByMarriage", M), "A", "B", "A is B's nephew by marriage"],
  [rel("niblingByMarriage", F), "A", "B", "A is B's niece by marriage"],
  [rel("auncleInLaw", M), "A", "B", "A is B's uncle-in-law"],
  [rel("auncleInLaw", F), "A", "B", "A is B's aunt-in-law"],
  [rel("niblingInLaw", M), "A", "B", "A is B's nephew-in-law"],
  [rel("niblingInLaw", F), "A", "B", "A is B's niece-in-law"],
  [rel("grandparentInLaw", M), "A", "B", "A is B's grandfather-in-law"],
  [rel("grandparentInLaw", F), "A", "B", "A is B's grandmother-in-law"],
  [rel("grandchildInLaw", M), "A", "B", "A is B's grandson-in-law"],
  [rel("grandchildInLaw", F), "A", "B", "A is B's granddaughter-in-law"],
  [rel("grandchildInLaw", F, { greats: 1 }), "A", "B", "A is B's great-granddaughter-in-law"],
  [rel("self", M), "Ali", "Ali", "Ali and Ali are the same person"],
  // Adoption is said outright on the direct link.
  [rel("child", M, { adopted: true }), "Ali", "Ahmed", "Ali is Ahmed's adopted son"],
  [rel("child", F, { adopted: true }), "Hina", "Ahmed", "Hina is Ahmed's adopted daughter"],
  [rel("parent", M, { adopted: true }), "Ahmed", "Ali", "Ahmed is Ali's adoptive father"],
  [rel("parent", F, { adopted: true }), "Sara", "Ali", "Sara is Ali's adoptive mother"],
];

describe("describeRelationship", () => {
  test.each(cases)("%o → %s, %s: %s", (relationship, a, b, expected) => {
    expect(describeRelationship(relationship, a, b, t)).toBe(expected);
  });

  test("works end to end with relate", () => {
    const doc = famKinship();
    const say = (a: string, b: string) =>
      relate(doc, a, b).map((r) => describeRelationship(r, a, b, t));
    expect(say("cousin1Kid", "me")).toEqual(["cousin1Kid is me's first cousin once removed"]);
    expect(say("ggUncle", "me")).toEqual(["ggUncle is me's great-great-uncle"]);
    expect(say("stepmom", "me")).toEqual(["stepmom is me's stepmother"]);
    expect(say("khalu", "me")).toEqual(["khalu is me's uncle by marriage"]);
    expect(say("nawasaWife", "me")).toEqual(["nawasaWife is me's granddaughter-in-law"]);
  });

  test("adoption end to end with relate", () => {
    const d = famAdoption();
    const say = (a: string, b: string) =>
      relate(d, a, b).map((r) => describeRelationship(r, a, b, t));
    expect(say("k2", "a")).toEqual(["k2 is a's adopted son"]);
    expect(say("a", "k2")).toEqual(["a is k2's adoptive father"]);
    expect(say("b", "k2")).toEqual(["b is k2's adoptive mother"]);
    expect(say("n1", "k2")).toEqual(["n1 is k2's father"]);
  });

  test("names are inserted as given, without escaping", () => {
    expect(describeRelationship(rel("parent", M), "Ali & Co", "<Sara>", t)).toBe(
      "Ali & Co is <Sara>'s father",
    );
  });
});
