import { describe, expect, test } from "bun:test";

import { relate } from "@/core/kinship/relate";
import type { Relationship } from "@/core/kinship/types";
import { urduTerm } from "@/core/kinship/urdu";

import { famKinship } from "./family";

const doc = famKinship();

// [A, B, the Urdu word for "A is B's …"] on the kinship fixture.
const cases: [string, string, string | null][] = [
  ["dad", "me", "والد"],
  ["mom", "me", "والدہ"],
  ["son", "me", "بیٹا"],
  ["daughter", "me", "بیٹی"],
  ["bro", "me", "بھائی"],
  ["sis", "me", "بہن"],
  ["halfBro", "me", "سوتیلا بھائی"],
  ["stepSib", "me", "سوتیلی بہن"],
  ["dada", "me", "دادا"],
  ["dadi", "me", "دادی"],
  ["nana", "me", "نانا"],
  ["nani", "me", "نانی"],
  ["pardada", "me", "پردادا"],
  ["pardadi", "me", "پردادی"],
  ["ppd", "me", null],
  ["grandson", "me", "پوتا"],
  ["nawasa", "me", "نواسا"],
  ["taya", "me", "تایا"],
  ["chacha", "me", "چچا"],
  ["phuphi", "me", "پھوپھی"],
  ["mamu", "me", "ماموں"],
  ["khala", "me", "خالہ"],
  ["grandUncle", "me", null],
  ["bhateeja", "me", "بھتیجا"],
  ["bhateeji", "me", "بھتیجی"],
  ["bhanja", "me", "بھانجا"],
  ["bhanji", "me", "بھانجی"],
  ["grandNephew", "me", null],
  ["sasur", "me", "سسر"],
  ["saas", "me", "ساس"],
  ["me", "sasur", "داماد"],
  ["bahu", "me", "بہو"],
  ["wife", "me", "بیوی"],
  ["me", "wife", "شوہر"],
  ["stepmom", "me", "سوتیلی ماں"],
  ["dad", "stepSib", "سوتیلا باپ"],
  ["me", "stepmom", "سوتیلا بیٹا"],
  ["cousin1", "me", null],
  ["sala", "me", null],
  // Uncles and aunts by marriage.
  ["khalu", "me", "خالو"],
  ["tayi", "me", "تائی"],
  ["chachi", "me", "چچی"],
  ["mumani", "me", "ممانی"],
  ["phupha", "me", "پھوپھا"],
  ["me", "khalu", null],
  // A sister's son's wife.
  ["bhanjaWife", "me", "بھانجے کی بیوی"],
  ["nawasaWife", "me", null],
];

const rel = (
  kind: Relationship["kind"],
  sexOfA: Relationship["sexOfA"],
  extra: Partial<Relationship> = {},
): Relationship => ({ kind, sexOfA, greats: 0, half: false, path: [], ...extra });

describe("urduTerm", () => {
  test.each(cases)("%s relative to %s", (a, b, expected) => {
    const [first] = relate(doc, a, b);
    expect(first).toBeDefined();
    expect(urduTerm(first!)).toBe(expected);
  });

  test.each([
    // A father's brother with unknown birth dates is چچا.
    [rel("auncle", "male", { side: "paternal" }), "چچا"],
    [rel("auncle", "male", { side: "paternal", elder: false }), "چچا"],
    [rel("auncle", "male", { side: "paternal", elder: true }), "تایا"],
    // Without a side there's no way to choose.
    [rel("auncle", "male"), null],
    [rel("grandparent", "female"), null],
    [rel("grandchild", "female", { viaSex: "male" }), "پوتی"],
    [rel("grandchild", "female", { viaSex: "female" }), "نواسی"],
    [rel("grandchild", "male", { greats: 1, viaSex: "male" }), "پرپوتا"],
    [rel("grandparent", "female", { greats: 1, side: "maternal" }), "پرنانی"],
    [rel("exSpouse", "female"), "سابقہ بیوی"],
    [rel("exSpouse", "male"), "سابق شوہر"],
    [rel("childInLaw", "male"), "داماد"],
    [rel("stepChild", "female"), "سوتیلی بیٹی"],
    [rel("nibling", "male"), null],
    [rel("cousin", "male", { degree: 1, removal: 0, side: "paternal" }), null],
    [rel("self", "male"), null],
    // Adoption: the child is لے پالک; Urdu has no single word for the adoptive parent here.
    [rel("child", "male", { adopted: true }), "لے پالک بیٹا"],
    [rel("child", "female", { adopted: true }), "لے پالک بیٹی"],
    [rel("parent", "male", { adopted: true }), null],
    [rel("parent", "female", { adopted: true }), null],
    // Engaged: منگیتر either way; an unmarried partner has no everyday word.
    [rel("fiance", "male"), "منگیتر"],
    [rel("fiance", "female"), "منگیتر"],
    [rel("partner", "male"), null],
    // By marriage: the side, the blood relative's sex and, on the father's side, age.
    [rel("auncleByMarriage", "female", { side: "paternal", partnerSex: "male" }), "چچی"],
    [
      rel("auncleByMarriage", "female", { side: "paternal", partnerSex: "male", elder: true }),
      "تائی",
    ],
    [rel("auncleByMarriage", "female", { side: "maternal", partnerSex: "male" }), "ممانی"],
    [rel("auncleByMarriage", "male", { side: "paternal", partnerSex: "female" }), "پھوپھا"],
    [rel("auncleByMarriage", "male", { side: "maternal", partnerSex: "female" }), "خالو"],
    [rel("auncleByMarriage", "male", { partnerSex: "female" }), null],
    [rel("auncleByMarriage", "male", { side: "maternal", partnerSex: "female", greats: 1 }), null],
    [rel("niblingInLaw", "female", { viaSex: "male", partnerSex: "male" }), "بھتیجے کی بیوی"],
    [rel("niblingInLaw", "male", { viaSex: "male", partnerSex: "female" }), "بھتیجی کا شوہر"],
    [rel("niblingInLaw", "female", { viaSex: "female", partnerSex: "male" }), "بھانجے کی بیوی"],
    [rel("niblingInLaw", "male", { viaSex: "female", partnerSex: "female" }), "بھانجی کا شوہر"],
    [rel("niblingInLaw", "male", { partnerSex: "female" }), null],
    [rel("grandchildInLaw", "female"), null],
  ] as const)("%o → %s", (relationship, expected) => {
    expect(urduTerm(relationship)).toBe(expected);
  });

  test("terms use Urdu letters, not their Arabic look-alikes", () => {
    const arabicOnly = /[يكهة]/; // ي ك ه ة
    for (const [a, b] of cases) {
      const term = urduTerm(relate(doc, a, b)[0]!);
      if (term !== null) expect(term).not.toMatch(arabicOnly);
    }
  });
});
