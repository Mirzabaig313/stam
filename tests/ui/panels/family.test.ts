import { describe, expect, test } from "bun:test";

import i18next from "i18next";

import ar from "@/i18n/locales/ar.json";
import { familyOf, lifeSummary } from "@/ui/panels/family";

import {
  docOf,
  famAdoption,
  famHalfSiblings,
  famRemarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";
import { t } from "../i18n";

describe("familyOf", () => {
  test("a child of one couple: both parents, no partners or children, two siblings", () => {
    const fam = familyOf(famSimple(), "c2");
    expect(fam.parents).toEqual([
      { personId: "dad", childType: "biological" },
      { personId: "mom", childType: "biological" },
    ]);
    expect(fam.partnerships).toEqual([]);
    expect(fam.children).toEqual([]);
    expect(fam.siblings).toEqual([
      { personId: "c1", half: false },
      { personId: "c3", half: false },
    ]);
  });

  test("a parent of two marriages: each partnership in order, every child once with its union", () => {
    const fam = familyOf(famRemarriage(), "ali");
    expect(fam.parents).toEqual([]);
    expect(fam.partnerships.map((p) => [p.union.id, p.partnerId])).toEqual([
      ["m1", "wife1"],
      ["m2", "wife2"],
    ]);
    expect(fam.children).toEqual([
      { personId: "a1", childType: "biological", unionId: "m1" },
      { personId: "a2", childType: "biological", unionId: "m1" },
      { personId: "a3", childType: "biological", unionId: "m2" },
    ]);
  });

  test("a union of one is no spouse: it keeps its children but lists no partnership", () => {
    const doc = docOf(
      [person("mum", "Hina", "Raza", "female"), person("kid", "Noor", "Raza", "female")],
      [union("solo", ["mum"], ["kid"])],
      "mum",
    );
    const fam = familyOf(doc, "mum");
    expect(fam.partnerships).toEqual([]);
    expect(fam.unions.map((u) => u.id)).toEqual(["solo"]);
    expect(fam.children).toEqual([{ personId: "kid", childType: "biological", unionId: "solo" }]);
  });

  test("half siblings are marked half", () => {
    expect(familyOf(famHalfSiblings(), "k1").siblings).toEqual([
      { personId: "k2", half: false },
      { personId: "k3", half: true },
    ]);
  });

  test("an adopted child lists birth parents first, then adoptive parents with the link type", () => {
    const fam = familyOf(famAdoption(), "k2");
    expect(fam.parents).toEqual([
      { personId: "n1", childType: "biological" },
      { personId: "n2", childType: "biological" },
      { personId: "a", childType: "adopted" },
      { personId: "b", childType: "adopted" },
    ]);
  });

  test("a union of one is not a partnership", () => {
    const doc = famSimple();
    doc.unions.u1!.partners = ["dad"];
    expect(familyOf(doc, "dad").partnerships).toEqual([]);
  });

  test("people missing from the document are left out", () => {
    const doc = famSimple();
    delete doc.persons.c3;
    expect(familyOf(doc, "dad").children.map((c) => c.personId)).toEqual(["c1", "c2"]);
    expect(familyOf(doc, "c1").siblings.map((s) => s.personId)).toEqual(["c2"]);
  });
});

const p = (extra: Parameters<typeof person>[4]) => person("x", "A", "B", "male", extra);

describe("lifeSummary", () => {
  test("birth and death years read as a span, with qualifiers", () => {
    expect(
      lifeSummary(
        p({
          isLiving: false,
          birth: { date: { year: 1900, qualifier: "about" } },
          death: { date: { year: 1985, month: 4 } },
        }),
        "en",
        t,
      ).years,
    ).toBe("abt 1900 – 1985");
  });

  test("only a birth year: born; only a death year: died", () => {
    expect(
      lifeSummary(p({ birth: { date: { year: 1950, month: 3, day: 2 } } }), "en", t).years,
    ).toBe("Born 1950");
    expect(
      lifeSummary(p({ isLiving: false, death: { date: { year: 1990 } } }), "en", t).years,
    ).toBe("Died 1990");
  });

  test("no dates: no years (never a lone dagger)", () => {
    expect(lifeSummary(p({ isLiving: false }), "en", t).years).toBe("");
  });

  test("the place is where they were born, else where they died", () => {
    expect(
      lifeSummary(p({ birth: { place: "Lahore" }, death: { place: "Karachi" } }), "en", t).place,
    ).toBe("Lahore");
    expect(lifeSummary(p({ death: { place: "Karachi" } }), "en", t).place).toBe("Karachi");
    expect(lifeSummary(p({}), "en", t).place).toBe("");
  });

  test("Arabic writes the years in its own words and digits", async () => {
    const arabic = i18next.createInstance();
    await arabic.init({
      lng: "ar",
      resources: { ar: { translation: ar } },
      interpolation: { escapeValue: false },
    });
    const years = lifeSummary(p({ birth: { date: { year: 1950 } } }), "ar", arabic.t).years;
    expect(years).not.toContain("Born");
    expect(years.length).toBeGreaterThan(0);
  });
});
