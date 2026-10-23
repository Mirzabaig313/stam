// Dev-only data for /dev/views: a pedigree-shaped family, laid out by the real `layoutFan` and
// `layoutTimeline`.
import { parentsOf } from "@/core/model/tree";
import type { Gender, Person, TreeDocument, Union } from "@/core/model/types";

const STAMP = "2026-01-01T00:00:00.000Z";
const NOW = 2026;

const FIRST: Record<Gender, string[]> = {
  male: ["Ahmed", "Ali", "Bilal", "Danish", "Hamid", "Imran", "Kamran", "Omar", "Tariq", "Usman"],
  female: ["Aisha", "Farah", "Hina", "Kiran", "Lubna", "Noor", "Rabia", "Sara", "Yasmin", "Zainab"],
};
const LAST = ["Khan", "Malik", "Raza", "Shah", "Siddiqui", "Aziz", "Iqbal", "Qureshi", "Chaudhry"];
const NATIVE: Record<string, string> = { Noor: "نور", Ali: "علی", Sara: "سارہ", Ahmed: "احمد" };

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Noor (born 1992) and her ancestors up to `generations` back, with gaps that grow with depth,
 * an "Unknown mother" placeholder, a few siblings per couple, estimated and known deaths.
 */
export function pedigreeFamily(generations = 7, seed = 11): TreeDocument {
  const rng = random(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]!;
  const persons: Record<string, Person> = {};
  const unions: Record<string, Union> = {};
  const unionOrder: Record<string, string[]> = {};
  let n = 0;
  let u = 0;

  const add = (gender: Gender, lastName: string, year: number, extra: Partial<Person> = {}) => {
    const id = `p${n++}`;
    const firstName = pick(FIRST[gender]);
    const living = year > 1945 || (year > 1932 && rng() < 0.5);
    const deathKnown = rng() < 0.65;
    persons[id] = {
      id,
      firstName,
      lastName,
      gender,
      nativeName: NATIVE[firstName] && rng() < 0.5 ? NATIVE[firstName] : undefined,
      isLiving: living,
      birth: { date: { year } },
      death:
        !living && deathKnown
          ? { date: { year: Math.min(NOW - 1, year + 48 + Math.floor(rng() * 42)) } }
          : undefined,
      ...extra,
    };
    return id;
  };

  const marry = (partners: [string] | [string, string], children: string[]) => {
    const id = `u${u++}`;
    unions[id] = {
      id,
      partners,
      status: "married",
      children: children.map((personId) => ({ personId, type: "biological" })),
    };
    for (const p of partners) (unionOrder[p] ??= []).push(id);
    return unions[id]!;
  };

  const focus = add("female", "Khan", 1992, { firstName: "Noor" });

  /** Adds the parents of `childId` (and a sibling or two), then recurses. */
  const grow = (childId: string, depth: number) => {
    if (depth > generations) return;
    const child = persons[childId]!;
    const childYear = child.birth!.date!.year!;
    const gap = Math.min(0.55, 0.06 * depth * depth);
    const hasFather = depth === 1 || rng() > gap;
    const hasMother = depth === 1 || rng() > gap;
    if (!hasFather && !hasMother) return;
    const fatherYear = childYear - 26 - Math.floor(rng() * 9);
    const motherYear = childYear - 21 - Math.floor(rng() * 8);
    const father = hasFather ? add("male", child.lastName, fatherYear) : null;
    const mother = hasMother
      ? depth === 3 && rng() < 0.4
        ? add("female", "", motherYear, { firstName: "", isPlaceholder: true, birth: undefined })
        : add("female", pick(LAST), motherYear)
      : null;
    const siblings: string[] = [];
    const extra = depth <= 3 ? Math.floor(rng() * 3) : 0;
    for (let i = 0; i < extra; i++) {
      siblings.push(add(rng() < 0.5 ? "male" : "female", child.lastName, childYear - 4 + i * 3));
    }
    const partners = [father, mother].filter((p): p is string => p !== null) as
      [string] | [string, string];
    marry(partners, [childId, ...siblings]);
    if (father) grow(father, depth + 1);
    if (mother && !persons[mother]!.isPlaceholder) grow(mother, depth + 1);
  };
  grow(focus, 1);

  // The root is the topmost person on the paternal line, as the family view would use.
  let root = focus;
  for (let up = parentsOf({ unions } as TreeDocument, root)[0]; up;) {
    root = up;
    up = parentsOf({ unions } as TreeDocument, root)[0];
  }

  return {
    id: "views-demo",
    name: "Views demo",
    schemaVersion: 1,
    rootPersonId: root,
    persons,
    unions,
    unionOrder,
    settings: { theme: "default", colorMode: "light", direction: "ltr" },
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}
