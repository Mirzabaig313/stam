import { describe, expect, test } from "bun:test";

import { arabicTerm } from "@/core/kinship/arabic";
import { relate } from "@/core/kinship/relate";
import type { Relationship } from "@/core/kinship/types";

import { famKinship } from "./family";

const doc = famKinship();

// [A, B, the Arabic word for "A is B's …", ready to be followed by B's name (idafa)].
const cases: [string, string, string | null][] = [
  ["dad", "me", "أب"],
  ["mom", "me", "أم"],
  ["son", "me", "ابن"],
  ["daughter", "me", "ابنة"],
  ["bro", "me", "أخ"],
  ["sis", "me", "أخت"],
  ["halfBro", "me", null],
  ["dada", "me", "جد"],
  ["nani", "me", "جدة"],
  ["pardada", "me", null],
  ["grandson", "me", "حفيد"],
  ["taya", "me", "عم"],
  ["chacha", "me", "عم"],
  ["phuphi", "me", "عمة"],
  ["mamu", "me", "خال"],
  ["khala", "me", "خالة"],
  ["grandUncle", "me", null],
  ["bhateeja", "me", "ابن أخ"],
  ["bhateeji", "me", "ابنة أخ"],
  ["bhanja", "me", "ابن أخت"],
  ["bhanji", "me", "ابنة أخت"],
  ["cousin1", "me", "ابن عم"],
  ["sasur", "me", "حمو"],
  ["saas", "me", "حماة"],
  ["me", "sasur", "صهر"],
  ["bahu", "me", "كنّة"],
  ["wife", "me", "زوجة"],
  ["me", "wife", "زوج"],
  ["stepmom", "me", "زوجة أب"],
  ["me", "stepmom", "ربيب"],
  ["khalu", "me", "زوج خالة"],
  ["chachi", "me", "زوجة عم"],
  ["mumani", "me", "زوجة خال"],
  ["phupha", "me", "زوج عمة"],
];

const rel = (
  kind: Relationship["kind"],
  sexOfA: Relationship["sexOfA"],
  extra: Partial<Relationship> = {},
): Relationship => ({ kind, sexOfA, greats: 0, half: false, path: [], ...extra });

describe("arabicTerm", () => {
  test.each(cases)("%s relative to %s", (a, b, expected) => {
    const [first] = relate(doc, a, b);
    expect(first).toBeDefined();
    expect(arabicTerm(first!)).toBe(expected);
  });

  test.each([
    // A cousin is named by the parent who links them: father's brother's daughter and so on.
    [
      rel("cousin", "female", { degree: 1, removal: 0, side: "paternal", viaSex: "female" }),
      "ابنة عمة",
    ],
    [rel("cousin", "male", { degree: 1, removal: 0, side: "maternal", viaSex: "male" }), "ابن خال"],
    [
      rel("cousin", "male", { degree: 1, removal: 0, side: "maternal", viaSex: "female" }),
      "ابن خالة",
    ],
    [rel("cousin", "male", { degree: 2, removal: 0, side: "maternal", viaSex: "female" }), null],
    [rel("cousin", "male", { degree: 1, removal: 1, side: "maternal", viaSex: "female" }), null],
    [rel("grandparent", "male"), "جد"],
    [rel("auncle", "male"), null],
    [rel("exSpouse", "female"), "طليقة"],
    [rel("fiance", "male"), "خطيب"],
    [rel("partner", "female"), "شريكة"],
    [rel("child", "male", { adopted: true }), null],
    [rel("self", "male"), null],
    [rel("otherInLaw", "male"), null],
  ] as const)("%o is %p", (r, expected) => {
    expect(arabicTerm(r)).toBe(expected);
  });
});
