import { describe, expect, test } from "bun:test";

import { defaultGender, parseNameEntry } from "@/ui/cards/nameEntry";

describe("parseNameEntry", () => {
  test("last word is the last name, the rest the first name", () => {
    expect(parseNameEntry("Ali Raza Khan")).toEqual({ firstName: "Ali Raza", lastName: "Khan" });
    expect(parseNameEntry("Ali Khan")).toEqual({ firstName: "Ali", lastName: "Khan" });
  });

  test("one word is a first name and inherits the last name", () => {
    expect(parseNameEntry("Noor", "Khan")).toEqual({ firstName: "Noor", lastName: "Khan" });
    expect(parseNameEntry("Noor")).toEqual({ firstName: "Noor", lastName: "" });
  });

  test("two or more words ignore the inherited last name", () => {
    expect(parseNameEntry("Noor Ahmed", "Khan")).toEqual({ firstName: "Noor", lastName: "Ahmed" });
  });

  test("blank gives null, whitespace is collapsed", () => {
    expect(parseNameEntry("   ")).toBeNull();
    expect(parseNameEntry("")).toBeNull();
    expect(parseNameEntry("  Ali \t Raza   Khan ")).toEqual({
      firstName: "Ali Raza",
      lastName: "Khan",
    });
  });
});

describe("defaultGender", () => {
  test("spouse is the opposite of the partner", () => {
    expect(defaultGender("spouse", { partnerGender: "male" })).toBe("female");
    expect(defaultGender("spouse", { partnerGender: "female" })).toBe("male");
    expect(defaultGender("spouse", {})).toBeNull();
  });

  test("parent is the opposite of an existing parent, else null", () => {
    expect(defaultGender("parent", { existingParentGender: "male" })).toBe("female");
    expect(defaultGender("parent", { existingParentGender: "female" })).toBe("male");
    expect(defaultGender("parent", {})).toBeNull();
  });

  test("child, sibling and first must be chosen", () => {
    for (const role of ["child", "sibling", "first"] as const) {
      expect(
        defaultGender(role, { partnerGender: "male", existingParentGender: "female" }),
      ).toBeNull();
    }
  });
});
