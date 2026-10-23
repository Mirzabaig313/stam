import { describe, expect, test } from "bun:test";

import { describePerson, personLabel } from "@/ui/cards/describe";

import { t } from "../i18n";
import { cardFamily } from "./fixtures";

describe("describePerson", () => {
  test("names the person, their birth year and both parents", () => {
    expect(describePerson(cardFamily(), "ali", t)).toBe(
      "Ali Khan, born 1950, son of Ahmed Khan and Sara Khan",
    );
  });

  test("says daughter for a woman and adds the death year", () => {
    expect(describePerson(cardFamily(), "zainab", t)).toBe(
      "Zainab Khan, born 1953, died 2019, daughter of Ahmed Khan and Sara Khan",
    );
  });

  test("uses the placeholder label for an unknown parent", () => {
    expect(describePerson(cardFamily(), "hina", t)).toBe(
      "Hina Raza, daughter of Imran Raza and Unknown mother",
    );
  });

  test("leaves out parents when there are none", () => {
    expect(describePerson(cardFamily(), "ahmed", t)).toBe("Ahmed Khan, born 1920");
  });

  test("adds the linked-copy and hidden-descendant notes when asked", () => {
    expect(describePerson(cardFamily(), "sara", t, { linked: true })).toBe(
      "Sara Khan, linked copy",
    );
    expect(describePerson(cardFamily(), "ahmed", t, { hiddenCount: 1 })).toBe(
      "Ahmed Khan, born 1920, 1 hidden descendant",
    );
    expect(describePerson(cardFamily(), "ahmed", t, { hiddenCount: 7 })).toBe(
      "Ahmed Khan, born 1920, 7 hidden descendants",
    );
  });

  test("keeps fuzzy-date qualifiers", () => {
    const doc = cardFamily();
    const fuzzy = {
      ...doc,
      persons: {
        ...doc.persons,
        ahmed: {
          ...doc.persons.ahmed!,
          birth: { date: { year: 1920, qualifier: "about" as const } },
        },
      },
    };
    expect(describePerson(fuzzy, "ahmed", t)).toBe("Ahmed Khan, born abt 1920");
  });

  test("an unknown id gives an empty string", () => {
    expect(describePerson(cardFamily(), "nobody", t)).toBe("");
  });
});

describe("personLabel", () => {
  test("is the display name, the placeholder label, or 'Unnamed person'", () => {
    const doc = cardFamily();
    expect(personLabel(doc.persons.ali!, t)).toBe("Ali Khan");
    expect(personLabel(doc.persons.unknownMom!, t)).toBe("Unknown mother");
    expect(personLabel({ ...doc.persons.unknownMom!, gender: "male" }, t)).toBe("Unknown father");
    expect(personLabel({ ...doc.persons.ali!, firstName: "", lastName: " " }, t)).toBe(
      "Unnamed person",
    );
  });
});
