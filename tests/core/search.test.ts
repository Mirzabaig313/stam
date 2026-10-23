import { describe, expect, test } from "bun:test";

import { searchPeople } from "@/core/search";

import { docOf, famSimple, person } from "../fixtures/families";

const names = docOf(
  [
    person("khalid", "Khalid", "Raza", "male"),
    person("ali", "Ali", "Khan", "male"),
    person("alia", "Alia", "Shah", "female"),
    person("zoe", "Zoë", "Malik", "female"),
    person("nick", "Muhammad", "Siddiqui", "male", { nickname: "Bobby" }),
    person("native", "Hassan", "Ali", "male", { nativeName: "حسن" }),
    person("blank", "", "", "female", { isPlaceholder: true }),
  ],
  [],
  "ali",
);

describe("searchPeople", () => {
  test("prefix matches rank before substring matches", () => {
    const result = searchPeople(names, "ali");
    expect(result.slice(0, 2)).toEqual(["ali", "alia"]);
    expect(result).toContain("khalid");
    expect(result.indexOf("khalid")).toBeGreaterThan(result.indexOf("alia"));
  });

  test("a last-name prefix counts as a prefix match", () => {
    // Hassan Ali: lastName starts with "ali", so he outranks Khalid (substring only).
    const result = searchPeople(names, "ali");
    expect(result.indexOf("native")).toBeLessThan(result.indexOf("khalid"));
  });

  test("is diacritic- and case-insensitive in both directions", () => {
    expect(searchPeople(names, "zoe")).toEqual(["zoe"]);
    expect(searchPeople(names, "ZOË")).toEqual(["zoe"]);
  });

  test("matches nickname and native name", () => {
    expect(searchPeople(names, "bob")).toEqual(["nick"]);
    expect(searchPeople(names, "حسن")).toEqual(["native"]);
  });

  test("matches a full name typed with a space", () => {
    expect(searchPeople(famSimple(), "ali khan")).toEqual(["c1"]);
  });

  test("blank query and no match give an empty list", () => {
    expect(searchPeople(names, "")).toEqual([]);
    expect(searchPeople(names, "   ")).toEqual([]);
    expect(searchPeople(names, "qqq")).toEqual([]);
  });

  test("respects the limit (default 20)", () => {
    const many = docOf(
      Array.from({ length: 30 }, (_, i) => person(`p${i}`, `Sam${i}`, "X", "male")),
      [],
      "p0",
    );
    expect(searchPeople(many, "sam")).toHaveLength(20);
    expect(searchPeople(many, "sam", 5)).toHaveLength(5);
  });
});
