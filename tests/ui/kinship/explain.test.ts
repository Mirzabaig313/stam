import { describe, expect, test } from "bun:test";

import type { Relationship } from "@/core/kinship/types";
import { explainRelation, type KinshipFns } from "@/ui/kinship/explain";

import { famAdoption, famCousinMarriage, famSimple } from "../../fixtures/families";
import { t as realT } from "../i18n";

const rel = (path: string[], kind: Relationship["kind"] = "sibling"): Relationship => ({
  kind,
  greats: 0,
  half: false,
  sexOfA: "male",
  path,
});

const t = ((key: string) => key) as never;

function fns(rels: Relationship[], urdu: (string | null)[] = []): KinshipFns {
  return {
    relate: () => rels,
    describeRelationship: (r, a, b) => `${a} is ${b}'s ${r.kind}`,
    urduTerm: (r) => urdu[rels.indexOf(r)] ?? null,
  };
}

describe("explainRelation", () => {
  test("one sentence per relationship, with the Urdu term when there is one", () => {
    const a = rel(["c1", "dad", "c2"]);
    const b = rel(["c1", "mom", "c2"], "cousin");
    const out = explainRelation(famSimple(), "c1", "c2", t, fns([a, b], ["بھائی", null]));
    expect(out).toMatchObject({
      aId: "c1",
      bId: "c2",
      results: [
        { text: "Ali Khan is Zainab Khan's sibling", urdu: "بھائی" },
        { text: "Ali Khan is Zainab Khan's cousin", urdu: null },
      ],
      path: ["c1", "dad", "c2"],
    });
    // The names are slots, so the panel can isolate them.
    expect(out?.results[0]?.parts).toEqual([{ name: "a" }, " is ", { name: "b" }, "'s sibling"]);
  });

  test("unrelated people have no results and no path", () => {
    expect(explainRelation(famSimple(), "c1", "c2", t, fns([]))).toMatchObject({
      results: [],
      path: [],
    });
  });

  test("the same person twice is not asked of the calculator", () => {
    let asked = 0;
    const counting: KinshipFns = { ...fns([rel(["c1"])]), relate: () => (asked++, []) };
    expect(explainRelation(famSimple(), "c1", "c1", t, counting)).toBeNull();
    expect(asked).toBe(0);
  });

  test("a missing person gives nothing", () => {
    expect(explainRelation(famSimple(), "c1", null, t, fns([]))).toBeNull();
    expect(explainRelation(famSimple(), "c1", "ghost", t, fns([]))).toBeNull();
  });

  test("identical sentences merge into one row, keeping the first result's path", () => {
    const a = rel(["c1", "dad", "c2"]);
    const b = rel(["c1", "mom", "c2"]);
    const c = rel(["c1", "x", "c2"], "cousin");
    const out = explainRelation(famSimple(), "c1", "c2", t, fns([a, b, c], ["بھائی", "x", null]));
    expect(out?.results.map(({ text, urdu }) => ({ text, urdu }))).toEqual([
      { text: "Ali Khan is Zainab Khan's sibling", urdu: "بھائی" },
      { text: "Ali Khan is Zainab Khan's cousin", urdu: null },
    ]);
    expect(out?.path).toEqual(["c1", "dad", "c2"]);
  });
});

describe("explainRelation with the real calculator", () => {
  test("pedigree collapse upwards gives one sentence, not two", () => {
    const out = explainRelation(famCousinMarriage(), "kid", "g1", realT);
    const texts = out!.results.map((r) => r.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[0]).toMatch(/great-grand(son|daughter)$/);
    expect(out!.path[0]).toBe("kid");
    expect(out!.path.at(-1)).toBe("g1");
  });

  test("adoption is said outright, with the Urdu term for the adopted child", () => {
    const d = famAdoption();
    expect(explainRelation(d, "a", "k2", realT)!.results).toMatchObject([
      { text: "Usman Aziz is Zaid Aziz's adoptive father", urdu: null },
    ]);
    expect(explainRelation(d, "k2", "a", realT)!.results[0]).toMatchObject({
      text: "Zaid Aziz is Usman Aziz's adopted son",
      urdu: "لے پالک بیٹا",
    });
  });
});
