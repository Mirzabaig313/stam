import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { relate } from "@/core/kinship/relate";
import type { Relationship } from "@/core/kinship/types";
import type { Person, TreeDocument, Union } from "@/core/model/types";
import { validate } from "@/core/model/validate";

import { arbFamily, runs } from "../../fixtures/arbitraries";
import { arbDeepFamily } from "../../fixtures/deepFamily";
import {
  docOf,
  famAdoption,
  famCousinMarriage,
  famHalfSiblings,
  famRemarriage,
  person,
  union,
} from "../../fixtures/families";
import { famKinship } from "./family";

const doc = famKinship();

type Expect = Partial<Relationship>;
const M = "male" as const;
const F = "female" as const;
const P = "paternal" as const;
const Mat = "maternal" as const;

// "A is B's ...": [a, b, what the closest relationship must match].
const cases: [string, string, Expect][] = [
  // Self, parents and children.
  ["me", "me", { kind: "self", sexOfA: M, path: ["me"] }],
  ["dad", "me", { kind: "parent", sexOfA: M, half: false, path: ["dad", "me"] }],
  ["mom", "me", { kind: "parent", sexOfA: F, path: ["mom", "me"] }],
  ["me", "dad", { kind: "child", sexOfA: M, path: ["me", "dad"] }],
  ["daughter", "me", { kind: "child", sexOfA: F }],
  // Grandparents, up to great-great-great.
  ["dada", "me", { kind: "grandparent", greats: 0, side: P, sexOfA: M }],
  ["dadi", "me", { kind: "grandparent", greats: 0, side: P, sexOfA: F }],
  ["nana", "me", { kind: "grandparent", greats: 0, side: Mat, sexOfA: M }],
  ["nani", "me", { kind: "grandparent", greats: 0, side: Mat, sexOfA: F }],
  ["pardada", "me", { kind: "grandparent", greats: 1, side: P }],
  ["ppd", "me", { kind: "grandparent", greats: 2, side: P }],
  [
    "pppd",
    "me",
    {
      kind: "grandparent",
      greats: 3,
      side: P,
      path: ["pppd", "ppd", "pardada", "dada", "dad", "me"],
    },
  ],
  ["pardada", "dad", { kind: "grandparent", greats: 0, side: P }],
  // Grandchildren, up to great-great-great.
  ["grandson", "me", { kind: "grandchild", greats: 0, viaSex: M, sexOfA: M }],
  ["nawasa", "me", { kind: "grandchild", greats: 0, viaSex: F, sexOfA: M }],
  ["ggson", "me", { kind: "grandchild", greats: 1 }],
  ["gggson", "me", { kind: "grandchild", greats: 2, sexOfA: F }],
  ["ggggson", "me", { kind: "grandchild", greats: 3 }],
  ["me", "pppd", { kind: "grandchild", greats: 3, viaSex: M }],
  // Siblings, full and half.
  ["bro", "me", { kind: "sibling", half: false, sexOfA: M, path: ["bro", "dad", "me"] }],
  ["sis", "me", { kind: "sibling", half: false, sexOfA: F }],
  ["halfBro", "me", { kind: "sibling", half: true, side: P, path: ["halfBro", "dad", "me"] }],
  ["me", "halfBro", { kind: "sibling", half: true, side: P }],
  ["taya", "chacha", { kind: "sibling", half: false }],
  ["halfUncle", "dad", { kind: "sibling", half: true }],
  // Uncles and aunts, up to great-great-great.
  ["taya", "me", { kind: "auncle", greats: 0, side: P, sexOfA: M, elder: true }],
  ["chacha", "me", { kind: "auncle", greats: 0, side: P, sexOfA: M, elder: false }],
  ["phuphi", "me", { kind: "auncle", greats: 0, side: P, sexOfA: F, elder: true }],
  ["mamu", "me", { kind: "auncle", greats: 0, side: Mat, sexOfA: M }],
  ["khala", "me", { kind: "auncle", greats: 0, side: Mat, sexOfA: F }],
  ["halfUncle", "me", { kind: "auncle", greats: 0, half: true, side: P }],
  [
    "grandUncle",
    "me",
    { kind: "auncle", greats: 1, side: P, path: ["grandUncle", "pardada", "dada", "dad", "me"] },
  ],
  ["ggUncle", "me", { kind: "auncle", greats: 2, side: P }],
  ["gggUncle", "me", { kind: "auncle", greats: 3, side: P }],
  // Nephews and nieces, up to great-great.
  ["bhateeja", "me", { kind: "nibling", greats: 0, viaSex: M, sexOfA: M }],
  ["bhateeji", "me", { kind: "nibling", greats: 0, viaSex: M, sexOfA: F }],
  ["bhanja", "me", { kind: "nibling", greats: 0, viaSex: F, sexOfA: M }],
  ["bhanji", "me", { kind: "nibling", greats: 0, viaSex: F, sexOfA: F }],
  ["grandNephew", "me", { kind: "nibling", greats: 1 }],
  ["ggNephew", "me", { kind: "nibling", greats: 2, sexOfA: F }],
  ["me", "taya", { kind: "nibling", greats: 0, viaSex: M }],
  ["me", "grandUncle", { kind: "nibling", greats: 1 }],
  ["me", "halfUncle", { kind: "nibling", greats: 0, half: true }],
  // Cousins, up to third and twice removed, both directions.
  ["cousin1", "me", { kind: "cousin", degree: 1, removal: 0, half: false, side: P }],
  ["me", "cousin1", { kind: "cousin", degree: 1, removal: 0, side: P }],
  ["cousin1Kid", "me", { kind: "cousin", degree: 1, removal: 1, side: P, sexOfA: F }],
  ["me", "cousin1Kid", { kind: "cousin", degree: 1, removal: 1, side: P }],
  ["cousin1GKid", "me", { kind: "cousin", degree: 1, removal: 2 }],
  ["gu1", "me", { kind: "cousin", degree: 1, removal: 1, side: P }],
  ["secondCousin", "me", { kind: "cousin", degree: 2, removal: 0 }],
  ["scKid", "me", { kind: "cousin", degree: 2, removal: 1 }],
  ["scGKid", "me", { kind: "cousin", degree: 2, removal: 2 }],
  ["me", "scGKid", { kind: "cousin", degree: 2, removal: 2 }],
  [
    "thirdCousin",
    "me",
    {
      kind: "cousin",
      degree: 3,
      removal: 0,
      path: ["thirdCousin", "ggu2", "ggu1", "ggUncle", "ppd", "pardada", "dada", "dad", "me"],
    },
  ],
  ["tcKid", "me", { kind: "cousin", degree: 3, removal: 1 }],
  ["tcGKid", "me", { kind: "cousin", degree: 3, removal: 2 }],
  ["halfCousin", "me", { kind: "cousin", degree: 1, removal: 0, half: true }],
  // Spouses, current and former.
  ["wife", "me", { kind: "spouse", sexOfA: F, path: ["wife", "me"] }],
  ["me", "wife", { kind: "spouse", sexOfA: M }],
  ["stepmom", "dad", { kind: "spouse", sexOfA: F }],
  ["mom", "dad", { kind: "exSpouse", sexOfA: F, path: ["mom", "dad"] }],
  ["dad", "mom", { kind: "exSpouse", sexOfA: M }],
  // Step relations, through a parent's spouse or a step link.
  ["stepmom", "me", { kind: "stepParent", sexOfA: F, path: ["stepmom", "dad", "me"] }],
  ["me", "stepmom", { kind: "stepChild", sexOfA: M, path: ["me", "dad", "stepmom"] }],
  ["dad", "stepSib", { kind: "stepParent", sexOfA: M }],
  ["stepSib", "dad", { kind: "stepChild", sexOfA: F }],
  ["stepSib", "me", { kind: "stepSibling", sexOfA: F }],
  ["me", "stepSib", { kind: "stepSibling", sexOfA: M }],
  // Same mother, different fathers: half-siblings, not step-siblings.
  ["stepSib", "halfBro", { kind: "sibling", half: true, side: Mat }],
  // In-laws, both directions.
  ["sasur", "me", { kind: "parentInLaw", sexOfA: M, path: ["sasur", "wife", "me"] }],
  ["saas", "me", { kind: "parentInLaw", sexOfA: F }],
  ["me", "sasur", { kind: "childInLaw", sexOfA: M, path: ["me", "wife", "sasur"] }],
  ["me", "saas", { kind: "childInLaw", sexOfA: M }],
  ["bahu", "me", { kind: "childInLaw", sexOfA: F }],
  ["damad", "me", { kind: "childInLaw", sexOfA: M }],
  ["me", "damad", { kind: "parentInLaw", sexOfA: M }],
  ["sala", "me", { kind: "siblingInLaw", sexOfA: M, path: ["sala", "sasur", "wife", "me"] }],
  ["sali", "me", { kind: "siblingInLaw", sexOfA: F }],
  ["me", "sali", { kind: "siblingInLaw", sexOfA: M }],
  ["bhabhi", "me", { kind: "siblingInLaw", sexOfA: F, path: ["bhabhi", "bro", "dad", "me"] }],
  ["behnoi", "me", { kind: "siblingInLaw", sexOfA: M }],
  ["me", "bhabhi", { kind: "siblingInLaw", sexOfA: M }],
  // Uncles and aunts by marriage (a parent's sibling's partner), and the other way round.
  [
    "khalu",
    "me",
    {
      kind: "auncleByMarriage",
      sexOfA: M,
      side: Mat,
      path: ["khalu", "khala", "nana", "mom", "me"],
    },
  ],
  [
    "me",
    "khalu",
    { kind: "niblingByMarriage", sexOfA: M, path: ["me", "mom", "nana", "khala", "khalu"] },
  ],
  ["tayi", "me", { kind: "auncleByMarriage", sexOfA: F, side: P, elder: true, partnerSex: M }],
  ["chachi", "me", { kind: "auncleByMarriage", sexOfA: F, side: P, elder: false, partnerSex: M }],
  ["mumani", "me", { kind: "auncleByMarriage", sexOfA: F, side: Mat, partnerSex: M }],
  ["phupha", "me", { kind: "auncleByMarriage", sexOfA: M, side: P, partnerSex: F }],
  // A nephew's wife and a grandson's wife, and the other way round.
  ["bhanjaWife", "me", { kind: "niblingInLaw", sexOfA: F, viaSex: F, partnerSex: M }],
  ["me", "bhanjaWife", { kind: "auncleInLaw", sexOfA: M }],
  ["nawasaWife", "me", { kind: "grandchildInLaw", sexOfA: F, greats: 0 }],
  ["me", "nawasaWife", { kind: "grandparentInLaw", sexOfA: M, greats: 0 }],
  // Only what has no closer name stays a "relative by marriage".
  ["saliHusband", "me", { kind: "otherInLaw", sexOfA: M }],
];

describe("relate: one relationship per pair", () => {
  test("the fixture is a valid document", () => {
    expect(validate(doc)).toEqual([]);
  });

  test.each(cases)("%s relative to %s", (a, b, expected) => {
    const rels = relate(doc, a, b);
    expect(rels.length).toBeGreaterThan(0);
    expect(rels[0]).toMatchObject(expected);
  });

  test("paths run from A to B and every step is a family link", () => {
    for (const [a, b] of cases) {
      for (const rel of relate(doc, a, b)) {
        expect(rel.path[0]).toBe(a);
        expect(rel.path.at(-1)).toBe(b);
        expect(new Set(rel.path).size).toBe(rel.path.length);
      }
    }
  });

  test("elder is left out when birth dates don't tell", () => {
    expect(relate(doc, "mamu", "me")[0]).not.toHaveProperty("elder");
  });

  test("cousin fields are set only on cousins", () => {
    const [first] = relate(doc, "taya", "me");
    expect(first?.degree).toBeUndefined();
    expect(first?.removal).toBeUndefined();
  });
});

describe("relate: unrelated people", () => {
  test.each([
    ["stranger", "me"],
    ["me", "stranger"],
    // A divorced mother is no stepmother to her ex-husband's later son.
    ["mom", "halfBro"],
    ["halfBro", "mom"],
    // The stepmother's ex-husband is nobody to the stepmother's stepson.
    ["stepmomEx", "me"],
    ["nobody", "me"],
    ["me", "nobody"],
  ])("%s and %s are not related", (a, b) => {
    expect(relate(doc, a, b)).toEqual([]);
  });
});

describe("relate: several relationships", () => {
  test("pedigree collapse gives one great-grandparent relationship per line", () => {
    const rels = relate(famCousinMarriage(), "g1", "kid");
    expect(rels).toHaveLength(2);
    expect(rels.map((r) => [r.kind, r.greats, r.side])).toEqual([
      ["grandparent", 1, "paternal"],
      ["grandparent", 1, "maternal"],
    ]);
    expect(rels.map((r) => r.path)).toEqual([
      ["g1", "p1", "cousin1", "kid"],
      ["g1", "p2", "cousin2", "kid"],
    ]);
  });

  test("a grandfather on one side is a great-uncle on the other", () => {
    const rels = relate(famCousinMarriage(), "p1", "kid");
    expect(rels.map((r) => [r.kind, r.greats, r.side])).toEqual([
      ["grandparent", 0, "paternal"],
      ["auncle", 1, "maternal"],
    ]);
  });

  test("married cousins: the marriage first, then the blood relationship", () => {
    const rels = relate(famCousinMarriage(), "cousin1", "cousin2");
    expect(rels.map((r) => r.kind)).toEqual(["spouse", "cousin"]);
    expect(rels[0]!.path).toEqual(["cousin1", "cousin2"]);
    expect(rels[1]).toMatchObject({ degree: 1, removal: 0, side: "maternal" });
  });

  test("a father-in-law who is also an uncle", () => {
    const kinds = relate(famCousinMarriage(), "p1", "cousin2").map((r) => r.kind);
    expect(kinds).toEqual(["auncle", "parentInLaw"]);
  });
});

describe("relate: adoption and remarriage", () => {
  test("an adopted child is a child of the adoptive parents", () => {
    expect(relate(famAdoption(), "k2", "a")[0]).toMatchObject({ kind: "child", sexOfA: "male" });
  });

  test("the direct link to an adoptive parent is marked adopted, both ways", () => {
    const d = famAdoption();
    expect(relate(d, "k2", "a")[0]).toMatchObject({ kind: "child", adopted: true });
    expect(relate(d, "k2", "b")[0]).toMatchObject({ kind: "child", adopted: true });
    expect(relate(d, "a", "k2")[0]).toMatchObject({ kind: "parent", adopted: true });
    expect(relate(d, "b", "k2")[0]).toMatchObject({ kind: "parent", adopted: true });
  });

  test("biological and birth-parent links are not marked adopted", () => {
    const d = famAdoption();
    expect(relate(d, "k1", "a")[0]!.adopted).toBeUndefined();
    expect(relate(d, "a", "k1")[0]!.adopted).toBeUndefined();
    expect(relate(d, "k2", "n1")[0]!.adopted).toBeUndefined();
    expect(relate(d, "n1", "k2")[0]!.adopted).toBeUndefined();
    expect(relate(d, "k1", "k2")[0]!.adopted).toBeUndefined();
  });

  test("wider relations through an adoption stay plain", () => {
    const d = famAdoption();
    d.persons.gk = { ...d.persons.k1!, id: "gk", name: { given: "Gul" } } as never;
    d.unions.uk = {
      id: "uk",
      partners: ["k2"],
      status: "married",
      children: [{ personId: "gk", type: "biological" }],
    } as never;
    const [rel] = relate(d, "gk", "a");
    expect(rel).toMatchObject({ kind: "grandchild" });
    expect(rel!.adopted).toBeUndefined();
  });

  test("an adopted child and a biological child of the same couple are full siblings", () => {
    expect(relate(famAdoption(), "k1", "k2")[0]).toMatchObject({ kind: "sibling", half: false });
  });

  test("an adopted child is still a child of the birth parents", () => {
    expect(relate(famAdoption(), "n1", "k2")[0]).toMatchObject({ kind: "parent" });
  });

  test("the birth parents are not related to the adoptive family", () => {
    expect(relate(famAdoption(), "n1", "k1")).toEqual([]);
  });

  test("half and full siblings through remarriage", () => {
    const d = famHalfSiblings();
    expect(relate(d, "k1", "k2")[0]).toMatchObject({ kind: "sibling", half: false });
    expect(relate(d, "k1", "k3")[0]).toMatchObject({ kind: "sibling", half: true });
    // f is still married to both wives, so each is the other's children's stepmother.
    expect(relate(d, "m1", "k3")[0]).toMatchObject({ kind: "stepParent", path: ["m1", "f", "k3"] });
  });

  test("a later wife's children and the first wife are not related", () => {
    expect(relate(famRemarriage(), "wife1", "a3")).toEqual([]);
    expect(relate(famRemarriage(), "wife2", "a1")[0]).toMatchObject({ kind: "stepParent" });
  });
});

const who = (id: string, gender: "male" | "female") => person(id, id, "", gender);

// Dad recorded without a wife: his children A and B, and their children AK and BK.
const lone = () =>
  docOf(
    [who("dad", M), who("a", M), who("b", F), who("ak", M), who("bk", F)],
    [union("u", ["dad"], ["a", "b"]), union("ua", ["a"], ["ak"]), union("ub", ["b"], ["bk"])],
    "dad",
  );

describe("relate: half siblings need two different second parents", () => {
  test("children of a parent recorded alone are full siblings", () => {
    expect(relate(lone(), "a", "b")[0]).toMatchObject({ kind: "sibling", half: false });
    expect(relate(lone(), "b", "a")[0]).toMatchObject({ kind: "sibling", half: false });
  });

  test("their children are full first cousins, and they are plain uncle and aunt", () => {
    expect(relate(lone(), "ak", "bk")[0]).toMatchObject({ kind: "cousin", degree: 1, half: false });
    expect(relate(lone(), "a", "bk")[0]).toMatchObject({ kind: "auncle", half: false });
    expect(relate(lone(), "bk", "a")[0]).toMatchObject({ kind: "nibling", half: false });
  });

  test("a sibling with one recorded parent is a full sibling of one with two", () => {
    const d = docOf(
      [who("m", F), who("f", M), who("x", M), who("y", F)],
      [union("u1", ["f", "m"], ["x"]), union("u2", ["m"], ["y"])],
      "m",
    );
    expect(relate(d, "y", "x")[0]).toMatchObject({ kind: "sibling", half: false });
  });

  test("children of the same union are never half, whoever else adopted them", () => {
    const d = docOf(
      [who("f", M), who("x", M), who("y", F), who("p", M), who("q", F), who("a", M), who("b", F)],
      [
        union("u", ["f"], ["a", "b"]),
        union("ua", ["p"], [["a", "adopted"]]),
        union("ub", ["q"], [["b", "adopted"]]),
      ],
      "f",
    );
    expect(relate(d, "a", "b")[0]).toMatchObject({ kind: "sibling", half: false });
  });

  test("different second parents still make half-siblings", () => {
    expect(relate(famHalfSiblings(), "k1", "k3")[0]).toMatchObject({ kind: "sibling", half: true });
  });
});

// H1 died (widowed union, child C1); W then married H2 (child C2).
const widow = () =>
  docOf(
    [who("h1", M), who("w", F), who("h2", M), who("c1", M), who("c2", F), who("h1dad", M)],
    [
      union("uh1", ["h1dad"], ["h1"]),
      union("a", ["h1", "w"], ["c1"], "widowed"),
      union("b", ["w", "h2"], ["c2"]),
    ],
    "w",
  );

describe("relate: a widow's later marriage", () => {
  test("the late husband is no stepfather to the children of the later marriage", () => {
    expect(relate(widow(), "h1", "c2")).toEqual([]);
    expect(relate(widow(), "c2", "h1")).toEqual([]);
  });

  test("the later husband is the stepfather of the earlier children", () => {
    expect(relate(widow(), "h2", "c1")[0]).toMatchObject({ kind: "stepParent" });
  });

  test("the widowed marriage still counts for in-laws", () => {
    expect(relate(widow(), "h1dad", "w")[0]).toMatchObject({ kind: "parentInLaw" });
  });

  test("without a union order, start dates decide", () => {
    const d = widow();
    d.unionOrder = {};
    d.unions.a!.start = { year: 1980 };
    d.unions.b!.start = { year: 1995 };
    expect(relate(d, "h1", "c2").map((r) => r.kind)).not.toContain("stepParent");
  });
});

const couple = (status: "engaged" | "partner") =>
  docOf(
    [who("a", M), who("b", F), who("bdad", M)],
    [union("u", ["a", "b"], [], status), union("p", ["bdad"], ["b"])],
    "a",
  );

describe("relate: engaged and unmarried partners", () => {
  test("an engaged couple are fiancé and fiancée, with no in-laws yet", () => {
    expect(relate(couple("engaged"), "a", "b")).toMatchObject([{ kind: "fiance", sexOfA: M }]);
    expect(relate(couple("engaged"), "b", "a")).toMatchObject([{ kind: "fiance", sexOfA: F }]);
    expect(relate(couple("engaged"), "bdad", "a")).toEqual([]);
  });

  test("unmarried partners are partners", () => {
    expect(relate(couple("partner"), "a", "b")).toMatchObject([{ kind: "partner" }]);
  });

  test("a couple married after an earlier divorce from each other are spouses", () => {
    const d = docOf(
      [who("a", M), who("b", F)],
      [union("u1", ["a", "b"], [], "divorced"), union("u2", ["a", "b"], [], "married")],
      "a",
    );
    expect(relate(d, "a", "b").map((r) => r.kind)).toEqual(["spouse"]);
  });
});

/** Twelve generations of six couples whose sons marry daughters of other couples. */
function clan(): TreeDocument {
  const persons: Person[] = [];
  const unions: Union[] = [];
  let couples: [string, string][] = [];
  for (let k = 0; k < 6; k++) {
    persons.push(who(`m0_${k}`, M), who(`f0_${k}`, F));
    couples.push([`m0_${k}`, `f0_${k}`]);
  }
  for (let g = 1; g <= 12; g++) {
    const sons: string[] = [];
    const daughters: string[] = [];
    couples.forEach(([m, f], k) => {
      persons.push(who(`s${g}_${k}`, M), who(`d${g}_${k}`, F));
      unions.push(union(`u${g}_${k}`, [m, f], [`s${g}_${k}`, `d${g}_${k}`]));
      sons.push(`s${g}_${k}`);
      daughters.push(`d${g}_${k}`);
    });
    couples = sons.map((s, k) => [s, daughters[(k + 1 + (g % 5)) % 6]!]);
  }
  return docOf(persons, unions, "m0_0");
}

describe("relate: work is capped", () => {
  test("an endogamous clan gives at most 50 relationships, the closest first", () => {
    const rels = relate(clan(), "s12_0", "s12_3");
    expect(rels.length).toBeGreaterThan(0);
    expect(rels.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < rels.length; i++) {
      expect(rels[i]!.path.length).toBeGreaterThanOrEqual(rels[i - 1]!.path.length);
    }
  });
});

const agrees = (d: TreeDocument, a: string, b: string) =>
  relate(d, a, b).length > 0 === relate(d, b, a).length > 0;
const pathOk = (d: TreeDocument, a: string, b: string) =>
  relate(d, a, b).every(
    (r) => r.path[0] === a && r.path.at(-1) === b && new Set(r.path).size === r.path.length,
  );

const allPairsAgree = (d: TreeDocument) => {
  const ids = Object.keys(d.persons);
  return ids.every((a) => ids.every((b) => agrees(d, a, b)));
};

describe("relate: properties", () => {
  test("relate(a, b) is non-empty exactly when relate(b, a) is, for every pair", () => {
    expect(allPairsAgree(doc)).toBe(true);
    expect(allPairsAgree(famCousinMarriage())).toBe(true);
    fc.assert(fc.property(arbFamily({ maxOps: 30 }), allPairsAgree), {
      numRuns: Math.max(1, Math.floor(runs() / 20)),
    });
  }, 60_000);

  test("the same holds on deep families with pedigree collapse, and every path joins A to B", () => {
    const arb = arbDeepFamily().chain((d) => {
      const ids = Object.keys(d.persons);
      const id = fc.constantFrom(...(ids.length > 0 ? ids : ["none"]));
      return fc.tuple(fc.constant(d), fc.array(fc.tuple(id, id), { minLength: 1, maxLength: 20 }));
    });
    fc.assert(
      fc.property(arb, ([d, pairs]) => pairs.every(([a, b]) => agrees(d, a, b) && pathOk(d, a, b))),
      { numRuns: Math.max(1, Math.floor(runs() / 20)) },
    );
  }, 60_000);

  test("inverse kinds pair up", () => {
    const inverse: Record<string, string> = {
      parent: "child",
      child: "parent",
      grandparent: "grandchild",
      grandchild: "grandparent",
      auncle: "nibling",
      nibling: "auncle",
      stepParent: "stepChild",
      stepChild: "stepParent",
      parentInLaw: "childInLaw",
      childInLaw: "parentInLaw",
      auncleByMarriage: "niblingByMarriage",
      niblingByMarriage: "auncleByMarriage",
      auncleInLaw: "niblingInLaw",
      niblingInLaw: "auncleInLaw",
      grandparentInLaw: "grandchildInLaw",
      grandchildInLaw: "grandparentInLaw",
    };
    for (const [a, b] of cases) {
      const forward = relate(doc, a, b)[0]!;
      const backward = relate(doc, b, a)[0]!;
      expect(backward.kind).toBe((inverse[forward.kind] ?? forward.kind) as never);
      expect(backward.greats).toBe(forward.greats);
      expect(backward.degree).toBe(forward.degree);
      expect(backward.removal).toBe(forward.removal);
    }
  });
});
