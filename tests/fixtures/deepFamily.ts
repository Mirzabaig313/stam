import * as fc from "fast-check";

import type { Gender, Person, TreeDocument, Union } from "@/core/model/types";

// Deep, bushy families built directly (no commands), so thousands are cheap to generate. They
// reach up to 12 generations and mix remarriage (0–3 spouses), single-parent unions, cousin
// marriages and adopted links to people placed elsewhere (pedigree collapse).

const MAX_GENERATION = 11;
const MAX_PEOPLE = 300;
/** Children per union, weighted towards small families. */
const CHILD_COUNTS = [0, 0, 1, 1, 1, 2, 2, 3, 4, 5];

const STAMP = "2026-01-01T00:00:00.000Z";

/**
 * Replays `choices` into a family. Each number drives one decision; once they run out every
 * decision is "none", so shrinking the array shrinks the family.
 */
export function buildDeepFamily(choices: readonly number[]): TreeDocument {
  let cursor = 0;
  const next = () => (cursor < choices.length ? choices[cursor++]! : 0);

  const persons: Record<string, Person> = {};
  const unions: Record<string, Union> = {};
  const unionOrder: Record<string, string[]> = {};
  const generation = new Map<string, number>();
  const bloodByGeneration = new Map<number, string[]>();
  let personCount = 0;
  let unionCount = 0;

  const addPerson = (gender: Gender, gen: number | undefined): string => {
    const id = `p${personCount++}`;
    persons[id] = { id, firstName: id, lastName: "", gender, isLiving: true };
    if (gen !== undefined) {
      generation.set(id, gen);
      const row = bloodByGeneration.get(gen) ?? [];
      row.push(id);
      bloodByGeneration.set(gen, row);
    }
    return id;
  };
  const addUnion = (partners: [string] | [string, string]): Union => {
    const id = `u${unionCount++}`;
    const union: Union = { id, partners, status: "married", children: [] };
    unions[id] = union;
    for (const p of partners) (unionOrder[p] ??= []).push(id);
    return union;
  };
  const partnersOf = (personId: string) =>
    new Set((unionOrder[personId] ?? []).flatMap((u) => unions[u]!.partners));

  const rootId = addPerson("male", 0);
  const stack = [rootId];
  while (stack.length > 0) {
    if (personCount >= MAX_PEOPLE) break;
    const personId = stack.pop()!;
    const gen = generation.get(personId)!;
    const gender = persons[personId]!.gender;
    const plan = next();
    const familyUnions: Union[] = [];

    // The root always marries, so the family never stops at one person.
    const spouses = gen === 0 ? 1 + (plan % 3) : plan % 4;
    for (let s = 0; s < spouses; s++) {
      const married = partnersOf(personId);
      const cousins = (bloodByGeneration.get(gen) ?? []).filter(
        (q) => q !== personId && !married.has(q),
      );
      const pick = next();
      const spouseId =
        pick % 6 === 0 && cousins.length > 0
          ? cousins[pick % cousins.length]!
          : addPerson(gender === "male" ? "female" : "male", undefined);
      familyUnions.push(addUnion([personId, spouseId]));
    }
    if (Math.floor(plan / 4) % 4 === 0) familyUnions.push(addUnion([personId]));

    const born: string[] = [];
    for (const union of familyUnions) {
      const count = gen < MAX_GENERATION ? CHILD_COUNTS[next() % CHILD_COUNTS.length]! : 0;
      for (let c = 0; c < count; c++) {
        if (personCount >= MAX_PEOPLE) break;
        const childId = addPerson(next() % 2 === 0 ? "male" : "female", gen + 1);
        union.children.push({ personId: childId, type: "biological" });
        born.push(childId);
      }
      // Now and then adopt someone from a later generation: they appear twice. Edges always
      // go to a later generation, so this never makes a cycle.
      const adopt = next();
      if (adopt % 7 === 0) {
        const later = [...generation].filter(([id, g]) => g > gen && id !== personId);
        const target = later.length > 0 ? later[adopt % later.length]![0] : undefined;
        if (target !== undefined && !union.children.some((c) => c.personId === target)) {
          union.children.push({ personId: target, type: "adopted" });
        }
      }
    }
    for (let i = born.length - 1; i >= 0; i--) stack.push(born[i]!);
  }

  return {
    id: "deep",
    name: "Deep family",
    schemaVersion: 1,
    rootPersonId: rootId,
    persons,
    unions,
    unionOrder,
    settings: { theme: "default", colorMode: "light", direction: "ltr" },
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

export function arbDeepFamily(): fc.Arbitrary<TreeDocument> {
  return fc.array(fc.nat(10_000), { maxLength: 600, size: "max" }).map(buildDeepFamily);
}
