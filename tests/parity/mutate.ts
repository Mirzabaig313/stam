import * as fc from "fast-check";

/** Every path to a value in a JSON tree. */
export function paths(value: unknown, at: (string | number)[] = []): (string | number)[][] {
  if (value === null || typeof value !== "object") return [at];
  const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
  return [
    at,
    ...keys.flatMap((k) => paths((value as Record<string, unknown>)[k as string], [...at, k])),
  ];
}

/** Whole numbers stay within ±2^53 (see the Task 4 ruling); everything else is fair game. */
export const REPLACEMENTS: unknown[] = [
  "x",
  "",
  1.5,
  0,
  1990,
  -3,
  null,
  [],
  {},
  true,
  "a/b",
  "constructor",
  ["p"],
];

/** Which value to damage (an index into `paths`) and how: replace, delete, or add a field. */
export type Mutation = { pick: number; how: number };

export const arbMutation: fc.Arbitrary<Mutation> = fc.record({
  pick: fc.nat(10_000),
  how: fc.nat(REPLACEMENTS.length + 1),
});

/** A damaged copy of `value`. */
export function mutateAt(value: unknown, { pick, how }: Mutation): unknown {
  const all = paths(value);
  const path = all[pick % all.length]!;
  if (path.length === 0) return REPLACEMENTS[how % REPLACEMENTS.length];
  const copy = structuredClone(value) as Record<string, unknown>;
  let parent: Record<string | number, unknown> = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
  const last = path.at(-1)!;
  if (how === REPLACEMENTS.length) delete parent[last];
  else if (how === REPLACEMENTS.length + 1 && !Array.isArray(parent)) parent["extra"] = 1;
  else parent[last] = REPLACEMENTS[how % REPLACEMENTS.length];
  return copy;
}
