import { describe, expect, test } from "bun:test";

import i18next from "i18next";

import { relate } from "@/core/kinship/relate";
import {
  describeIn,
  describeRelationshipAr,
  describeRelationshipUr,
} from "@/core/kinship/sentences";
import type { Relationship } from "@/core/kinship/types";
import ar from "@/i18n/locales/ar.json";
import en from "@/i18n/locales/en.json";
import ur from "@/i18n/locales/ur.json";

import { famKinship } from "./family";

async function tFor(lng: string, translation: object) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng,
    resources: { [lng]: { translation } },
    interpolation: { escapeValue: false },
  });
  return i18n.t;
}
const tUr = await tFor("ur", ur);
const tAr = await tFor("ar", ar);
const tEn = await tFor("en", en);

const doc = famKinship();
const first = (a: string, b: string) => relate(doc, a, b)[0]!;
const rel = (
  kind: Relationship["kind"],
  sexOfA: Relationship["sexOfA"],
  extra: Partial<Relationship> = {},
): Relationship => ({ kind, sexOfA, greats: 0, half: false, path: [], ...extra });

describe("describeRelationshipUr", () => {
  test("A, B کا/کی <term> ہے, with the possessive agreeing with A's word", () => {
    expect(describeRelationshipUr(first("chacha", "me"), "علی", "احمد", tUr)).toBe(
      "علی، احمد کا چچا ہے",
    );
    expect(describeRelationshipUr(first("khala", "me"), "زینب", "احمد", tUr)).toBe(
      "زینب، احمد کی خالہ ہے",
    );
  });

  test("falls back to the Urdu locale's general words where Urdu has no single word", () => {
    expect(describeRelationshipUr(first("cousin1", "me"), "A", "B", tUr)).toBe(
      "A، B کا کزن (پہلا درجہ) ہے",
    );
  });

  test("the same person", () => {
    expect(describeRelationshipUr(rel("self", "male"), "A", "B", tUr)).toBe(
      "A اور B ایک ہی فرد ہیں",
    );
  });
});

describe("describeRelationshipAr", () => {
  test("A هو/هي <term> B: the term goes straight before B's name", () => {
    expect(describeRelationshipAr(first("cousin1", "me"), "علي", "أحمد", tAr)).toBe(
      "علي هو ابن عم أحمد",
    );
    expect(describeRelationshipAr(first("khala", "me"), "زينب", "أحمد", tAr)).toBe(
      "زينب هي خالة أحمد",
    );
  });

  test("without a short word, the Arabic locale's general words, then لـ B", () => {
    expect(describeRelationshipAr(first("halfBro", "me"), "علي", "أحمد", tAr)).toBe(
      "علي هو أخ غير شقيق لـأحمد",
    );
  });

  test("the same person", () => {
    expect(describeRelationshipAr(rel("self", "female"), "A", "B", tAr)).toBe("A وB شخص واحد");
  });
});

describe("describeIn", () => {
  test("picks the sentence builder for the interface language", () => {
    const r = first("chacha", "me");
    expect(describeIn("ur")(r, "A", "B", tUr)).toBe("A، B کا چچا ہے");
    expect(describeIn("ar")(r, "A", "B", tAr)).toBe("A هو عم B");
    expect(describeIn("en")(r, "A", "B", tEn)).toBe("A is B's uncle");
    expect(describeIn("en-GB")(r, "A", "B", tEn)).toBe("A is B's uncle");
  });
});
