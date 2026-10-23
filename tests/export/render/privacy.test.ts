import { describe, expect, test } from "bun:test";

import { applyPrivacy, withoutDates } from "@/export/render/privacy";

import { docOf, person, union } from "../../fixtures/families";

function family() {
  return docOf(
    [
      person("liv", "Ali", "Khan", "male", {
        nickname: "Alu",
        nativeName: "علی خان",
        birth: { date: { year: 1980, month: 4 }, place: "Lahore" },
        photoId: "ph1",
        notes: "Phone 0300",
      }),
      person("dec", "Sara", "Khan", "female", {
        isLiving: false,
        birth: { date: { year: 1950 }, place: "Delhi" },
        death: { date: { year: 2010 }, place: "Karachi" },
        photoId: "ph2",
        notes: "Teacher",
      }),
      // Marked living but with a death record: counts as deceased, like the card does.
      person("odd", "Omar", "Khan", "male", { death: { date: { year: 2001 } } }),
    ],
    [
      union("u1", ["liv", "dec"], [], "married", { start: { year: 2000 }, end: { year: 2010 } }),
      union("u2", ["dec", "odd"], [], "married", { start: { year: 1970 } }),
    ],
    "liv",
  );
}

describe("applyPrivacy", () => {
  test("a living person keeps their names only", () => {
    const p = applyPrivacy(family()).persons.liv!;
    expect(p).toEqual({
      id: "liv",
      firstName: "Ali",
      lastName: "Khan",
      nickname: "Alu",
      nativeName: "علی خان",
      gender: "male",
      isLiving: true,
    });
  });

  test("a deceased person keeps dates, places, photo and notes", () => {
    const doc = family();
    expect(applyPrivacy(doc).persons.dec).toEqual(doc.persons.dec!);
    expect(applyPrivacy(doc).persons.odd).toEqual(doc.persons.odd!);
  });

  test("union dates are dropped when a partner is living", () => {
    const out = applyPrivacy(family());
    expect(out.unions.u1!.start).toBeUndefined();
    expect(out.unions.u1!.end).toBeUndefined();
    expect(out.unions.u2!.start).toEqual({ year: 1970 });
  });

  test("does not change the input document", () => {
    const doc = family();
    const before = structuredClone(doc);
    applyPrivacy(doc);
    expect(doc).toEqual(before);
  });
});

describe("withoutDates", () => {
  test("drops birth and death dates but keeps the deceased mark and places", () => {
    const out = withoutDates(family());
    expect(out.persons.dec!.birth).toEqual({ place: "Delhi" });
    expect(out.persons.dec!.death).toEqual({ place: "Karachi" });
    expect(out.persons.liv!.birth).toEqual({ place: "Lahore" });
    expect(out.unions.u2!.start).toBeUndefined();
  });
});
