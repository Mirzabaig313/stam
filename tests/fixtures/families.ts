import type {
  ChildType,
  Gender,
  Person,
  TreeDocument,
  Union,
  UnionStatus,
} from "@/core/model/types";

// Fixtures are written with raw object literals on purpose: they must not depend on commands.

const STAMP = "2026-01-01T00:00:00.000Z";

export function person(
  id: string,
  firstName: string,
  lastName: string,
  gender: Gender,
  extra: Partial<Person> = {},
): Person {
  return { id, firstName, lastName, gender, isLiving: true, ...extra };
}

export function union(
  id: string,
  partners: [string] | [string, string],
  children: (string | [string, ChildType])[] = [],
  status: UnionStatus = "married",
  extra: Partial<Union> = {},
): Union {
  return {
    id,
    partners,
    status,
    children: children.map((c) =>
      typeof c === "string" ? { personId: c, type: "biological" } : { personId: c[0], type: c[1] },
    ),
    ...extra,
  };
}

/** Builds a document; `unionOrder` follows the order unions are listed in. */
export function docOf(
  persons: Person[],
  unions: Union[],
  rootPersonId: string | undefined,
): TreeDocument {
  const unionOrder: Record<string, string[]> = {};
  for (const u of unions) {
    for (const p of u.partners) (unionOrder[p] ??= []).push(u.id);
  }
  return {
    id: "doc",
    name: "Fixture",
    schemaVersion: 1,
    rootPersonId,
    persons: Object.fromEntries(persons.map((p) => [p.id, p])),
    unions: Object.fromEntries(unions.map((u) => [u.id, u])),
    unionOrder,
    settings: { theme: "default", colorMode: "light", direction: "ltr" },
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

/** Couple (dad, mom) with three children c1, c2, c3. Root is dad. */
export function famSimple(): TreeDocument {
  return docOf(
    [
      person("dad", "Ahmed", "Khan", "male"),
      person("mom", "Sara", "Khan", "female"),
      person("c1", "Ali", "Khan", "male", { birth: { date: { year: 1980 } } }),
      person("c2", "Zainab", "Khan", "female", { birth: { date: { year: 1983 } } }),
      person("c3", "Omar", "Khan", "male", { birth: { date: { year: 1990 } } }),
    ],
    [union("u1", ["dad", "mom"], ["c1", "c2", "c3"])],
    "dad",
  );
}

/** `ali` has two unions: first with `wife1` (children a1, a2), then with `wife2` (child a3). */
export function famRemarriage(): TreeDocument {
  return docOf(
    [
      person("ali", "Ali", "Raza", "male"),
      person("wife1", "Hina", "Raza", "female"),
      person("wife2", "Mehr", "Raza", "female"),
      person("a1", "Bilal", "Raza", "male"),
      person("a2", "Noor", "Raza", "female"),
      person("a3", "Sana", "Raza", "female"),
    ],
    [
      union("m1", ["ali", "wife1"], ["a1", "a2"], "divorced", { start: { year: 1975 } }),
      union("m2", ["ali", "wife2"], ["a3"], "married", { start: { year: 1990 } }),
    ],
    "ali",
  );
}

/** Father `f` with `m1` (children k1, k2) and with `m2` (child k3). k1/k2 are full siblings. */
export function famHalfSiblings(): TreeDocument {
  return docOf(
    [
      person("f", "Hamid", "Shah", "male"),
      person("m1", "Aisha", "Shah", "female"),
      person("m2", "Farah", "Shah", "female"),
      person("k1", "Kamran", "Shah", "male"),
      person("k2", "Kiran", "Shah", "female"),
      person("k3", "Kashif", "Shah", "male"),
    ],
    [union("u1", ["f", "m1"], ["k1", "k2"]), union("u2", ["f", "m2"], ["k3"])],
    "f",
  );
}

/**
 * Grandparents g1+g2 have p1 and p2. p1+s1 have cousin1, p2+s2 have cousin2.
 * cousin1 and cousin2 are married and have `kid`. Root is g1.
 */
export function famCousinMarriage(): TreeDocument {
  return docOf(
    [
      person("g1", "Jamil", "Malik", "male"),
      person("g2", "Razia", "Malik", "female"),
      person("p1", "Tariq", "Malik", "male"),
      person("p2", "Yasmin", "Malik", "female"),
      person("s1", "Nazia", "Malik", "female"),
      person("s2", "Waqar", "Butt", "male"),
      person("cousin1", "Imran", "Malik", "male"),
      person("cousin2", "Rabia", "Butt", "female"),
      person("kid", "Danish", "Malik", "male"),
    ],
    [
      union("ug", ["g1", "g2"], ["p1", "p2"]),
      union("up1", ["p1", "s1"], ["cousin1"]),
      union("up2", ["s2", "p2"], ["cousin2"]),
      union("uc", ["cousin1", "cousin2"], ["kid"]),
    ],
    "g1",
  );
}

/** `a`+`b` have a biological child k1 and an adopted child k2, whose birth parents are n1+n2. */
export function famAdoption(): TreeDocument {
  return docOf(
    [
      person("a", "Usman", "Aziz", "male"),
      person("b", "Lubna", "Aziz", "female"),
      person("k1", "Hira", "Aziz", "female"),
      person("k2", "Zaid", "Aziz", "male"),
      person("n1", "Rashid", "Iqbal", "male"),
      person("n2", "Saima", "Iqbal", "female"),
    ],
    [union("ua", ["a", "b"], ["k1", ["k2", "adopted"]]), union("un", ["n1", "n2"], ["k2"])],
    "a",
  );
}

export const allFamilies: [string, () => TreeDocument][] = [
  ["famSimple", famSimple],
  ["famRemarriage", famRemarriage],
  ["famHalfSiblings", famHalfSiblings],
  ["famCousinMarriage", famCousinMarriage],
  ["famAdoption", famAdoption],
];
