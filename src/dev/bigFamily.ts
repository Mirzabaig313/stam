import { freeze } from "immer";

import type { Gender, Person, TreeDocument, Union } from "@/core/model/types";
import { validate } from "@/core/model/validate";

// Dev and test data only: benchmarks, stress tests and the `?demo=` loader. Never imported by
// production code paths.
//
// R13: documents are built directly and checked once with `validate()`, not through
// `applyCommand`, so 5,000 people build in milliseconds. Ids are `p0, p1, …` and `u0, u1, …` in
// creation order, so every builder is deterministic.

const STAMP = "2026-01-01T00:00:00.000Z";
const FIRST_YEAR = 1800;
const GENERATION_YEARS = 25;

const NAMES: Record<Gender, string[]> = {
  male: ["Ahmed", "Ali", "Bilal", "Danish", "Hamid", "Imran", "Kamran", "Omar", "Tariq", "Usman"],
  female: ["Aisha", "Farah", "Hina", "Kiran", "Lubna", "Noor", "Rabia", "Sara", "Yasmin", "Zainab"],
};
const SURNAMES = ["Khan", "Malik", "Raza", "Shah", "Butt", "Aziz", "Iqbal", "Qureshi"];

/** mulberry32: a small seeded PRNG, so the same seed always gives the same family. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const opposite = (gender: Gender): Gender => (gender === "male" ? "female" : "male");

class FamilyBuilder {
  readonly persons: Record<string, Person> = {};
  readonly unions: Record<string, Union> = {};
  readonly unionOrder: Record<string, string[]> = {};
  count = 0;
  private unionCount = 0;
  private readonly rng: () => number;

  constructor(seed: number) {
    this.rng = random(seed);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)]!;
  }

  gender(): Gender {
    return this.rng() < 0.5 ? "male" : "female";
  }

  person(gender: Gender, lastName: string, year: number): string {
    const id = `p${this.count++}`;
    this.persons[id] = {
      id,
      firstName: this.pick(NAMES[gender]),
      lastName,
      gender,
      isLiving: false,
      birth: { date: { year } },
    };
    return id;
  }

  /** Marries `personId` to a new person; returns the union. */
  marry(personId: string, year: number, start: number): Union {
    const spouseId = this.person(
      opposite(this.persons[personId]!.gender),
      this.pick(SURNAMES),
      year,
    );
    const id = `u${this.unionCount++}`;
    const union: Union = {
      id,
      partners: [personId, spouseId],
      status: "married",
      start: { year: start },
      children: [],
    };
    this.unions[id] = union;
    for (const partner of union.partners) (this.unionOrder[partner] ??= []).push(id);
    return union;
  }

  child(union: Union, year: number): string {
    const lastName = this.persons[union.partners[0]]!.lastName;
    const childId = this.person(this.gender(), lastName, year);
    union.children.push({ personId: childId, type: "biological" });
    return childId;
  }

  finish(id: string, name: string, rootPersonId: string | undefined): TreeDocument {
    const doc: TreeDocument = {
      id,
      name,
      schemaVersion: 1,
      rootPersonId,
      persons: this.persons,
      unions: this.unions,
      unionOrder: this.unionOrder,
      settings: { theme: "default", colorMode: "light", direction: "ltr" },
      createdAt: STAMP,
      updatedAt: STAMP,
    };
    const issues = validate(doc);
    if (issues.length > 0) throw new Error(`${name} is invalid: ${issues[0]!.message}`);
    return freeze(doc, true);
  }
}

/**
 * A balanced family of exactly `people` persons: a root couple, four children per couple, and
 * every blood descendant married, filled generation by generation. When `people` is odd, the
 * last child added stays single.
 */
export function bigFamily(people: number, seed = 42): TreeDocument {
  const b = new FamilyBuilder(seed);
  type Couple = { union: Union; year: number };
  const couples: Couple[] = [];
  let rootId: string | undefined;
  if (people > 0) {
    rootId = b.person("male", "Khan", FIRST_YEAR);
    if (b.count < people) {
      couples.push({ union: b.marry(rootId, FIRST_YEAR, FIRST_YEAR + 20), year: FIRST_YEAR });
    }
  }
  for (let next = 0; next < couples.length && b.count < people; next++) {
    const { union, year: parentYear } = couples[next]!;
    for (let i = 0; i < 4 && b.count < people; i++) {
      const year = parentYear + GENERATION_YEARS + 2 * i;
      const childId = b.child(union, year);
      if (b.count < people) couples.push({ union: b.marry(childId, year, year + 20), year });
    }
  }
  return b.finish(`big-${people}-${seed}`, `Big family of ${people}`, rootId);
}

/**
 * A deep line: `generations` rows, where one child per couple marries and carries the line on
 * and `siblings` more children stay single. Stresses contour depth.
 */
export function chainFamily(generations: number, siblings = 2, seed = 42): TreeDocument {
  const b = new FamilyBuilder(seed);
  const rootId = b.person("male", "Khan", FIRST_YEAR);
  let union = b.marry(rootId, FIRST_YEAR, FIRST_YEAR + 20);
  for (let gen = 1; gen < generations; gen++) {
    const year = FIRST_YEAR + gen * GENERATION_YEARS;
    // The heir sits in the middle of the siblings, so their deep subtree has neighbours.
    const before = Math.floor(siblings / 2);
    for (let i = 0; i < before; i++) b.child(union, year);
    const heir = b.child(union, year);
    for (let i = before; i < siblings; i++) b.child(union, year);
    union = b.marry(heir, year, year + 20);
  }
  return b.finish(`chain-${generations}-${siblings}`, `Chain of ${generations}`, rootId);
}

/**
 * Exactly `people` persons where every blood relative has three marriages with one or two
 * children each, filled generation by generation. Stresses multi-union blocks and brackets.
 */
export function remarriedFamily(people: number, seed = 42): TreeDocument {
  const b = new FamilyBuilder(seed);
  const queue: { personId: string; year: number }[] = [];
  let rootId: string | undefined;
  if (people > 0) {
    rootId = b.person("male", "Khan", FIRST_YEAR);
    queue.push({ personId: rootId, year: FIRST_YEAR });
  }
  for (let next = 0; next < queue.length && b.count < people; next++) {
    const { personId, year } = queue[next]!;
    for (let m = 0; m < 3 && b.count < people; m++) {
      const union = b.marry(personId, year, year + 20 + 5 * m);
      const children = 1 + ((next + m) % 2);
      for (let c = 0; c < children && b.count < people; c++) {
        const childYear = year + GENERATION_YEARS + 5 * m + c;
        queue.push({ personId: b.child(union, childYear), year: childYear });
      }
    }
  }
  return b.finish(`remarried-${people}-${seed}`, `Remarried family of ${people}`, rootId);
}
