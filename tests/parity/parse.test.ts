import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as fc from "fast-check";

import { parseTreeDocument } from "@/io/json/parseTree";

import { ALL_KINDS, arbOp, buildFamily, runs } from "../fixtures/arbitraries";
import { canonicalDoc } from "../fixtures/canonical";
import { loadCore } from "./wasm";

const core = loadCore();
const FIXTURES = join(import.meta.dir, "..", "..", "server", "stam-core", "tests", "fixtures");

function tsParse(text: string): string | null {
  try {
    return canonicalDoc(parseTreeDocument(JSON.parse(text)));
  } catch {
    return null;
  }
}

function rustParse(text: string): string | null {
  const out = JSON.parse(core.parse_tree_json(text));
  return "ok" in out ? canonicalDoc(out.ok) : null;
}

/** Every path to a value in a JSON tree. */
function paths(value: unknown, at: (string | number)[] = []): (string | number)[][] {
  if (value === null || typeof value !== "object") return [at];
  const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
  return [
    at,
    ...keys.flatMap((k) => paths((value as Record<string, unknown>)[k as string], [...at, k])),
  ];
}

/** Whole numbers stay within ±2^53 (see the Task 4 ruling); everything else is fair game. */
const REPLACEMENTS: unknown[] = [
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

function mutate(doc: unknown, path: (string | number)[], how: number): unknown {
  const copy = structuredClone(doc) as Record<string, unknown>;
  if (path.length === 0) return REPLACEMENTS[how % REPLACEMENTS.length];
  let parent: Record<string | number, unknown> = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
  const last = path.at(-1)!;
  if (how === REPLACEMENTS.length) delete parent[last];
  else if (how === REPLACEMENTS.length + 1 && !Array.isArray(parent)) parent["extra"] = 1;
  else parent[last] = REPLACEMENTS[how % REPLACEMENTS.length];
  return copy;
}

describe("TS and Rust parsers agree", () => {
  test.each(readdirSync(FIXTURES))("on the fixture %s", (name) => {
    const text = readFileSync(join(FIXTURES, name), "utf8");
    expect(rustParse(text)).toBe(tsParse(text));
    expect(rustParse(text)).not.toBeNull();
  });

  test("on random damage to a valid tree", () => {
    fc.assert(
      fc.property(
        fc.array(arbOp(ALL_KINDS), { maxLength: 20 }),
        fc.nat(10_000),
        fc.nat(REPLACEMENTS.length + 1),
        (ops, pick, how) => {
          const doc = JSON.parse(JSON.stringify(buildFamily(ops)));
          const all = paths(doc);
          const text = JSON.stringify(mutate(doc, all[pick % all.length]!, how));
          expect(rustParse(text)).toBe(tsParse(text));
        },
      ),
      { numRuns: runs() },
    );
  });

  test("on text that is not a tree", () => {
    for (const text of ["[]", "null", "7", '"tree"', "{}", "not json"]) {
      expect(rustParse(text)).toBeNull();
    }
  });
});
