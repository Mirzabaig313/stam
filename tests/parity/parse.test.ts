import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as fc from "fast-check";

import type { TreeDocument } from "@/core/model/types";
import { isIndexKey, parseTreeDocument } from "@/io/json/parseTree";

import { ALL_KINDS, arbOp, buildFamily, runs } from "../fixtures/arbitraries";
import { canonicalDoc } from "../fixtures/canonical";
import { arbMutation, mutateAt } from "./mutate";
import { loadCore } from "./wasm";

const core = loadCore();
const FIXTURES = join(import.meta.dir, "..", "..", "server", "stam-core", "tests", "fixtures");

/** Shared trees refuse array-index ids (`isSharedId`), which local trees still allow. */
function hasIndexId(doc: TreeDocument): boolean {
  const ids = [
    doc.rootPersonId ?? "",
    ...Object.keys(doc.persons),
    ...Object.keys(doc.unionOrder),
    ...Object.values(doc.unionOrder).flat(),
    ...Object.values(doc.persons).map((p) => p.photoId ?? ""),
    ...Object.values(doc.unions).flatMap((u) => [
      u.id,
      ...u.partners,
      ...u.children.map((c) => c.personId),
    ]),
  ];
  return ids.some(isIndexKey);
}

function tsParse(text: string): string | null {
  try {
    const doc = parseTreeDocument(JSON.parse(text));
    if (hasIndexId(doc)) return null;
    return canonicalDoc(doc);
  } catch {
    return null;
  }
}

function rustParse(text: string): string | null {
  const out = JSON.parse(core.parse_tree_json(text));
  return "ok" in out ? canonicalDoc(out.ok) : null;
}

describe("TS and Rust parsers agree", () => {
  test.each(readdirSync(FIXTURES))("on the fixture %s", (name) => {
    const text = readFileSync(join(FIXTURES, name), "utf8");
    expect(rustParse(text)).toBe(tsParse(text));
    expect(rustParse(text)).not.toBeNull();
  });

  test("on random damage to a valid tree", () => {
    fc.assert(
      fc.property(fc.array(arbOp(ALL_KINDS), { maxLength: 20 }), arbMutation, (ops, m) => {
        const doc = JSON.parse(JSON.stringify(buildFamily(ops)));
        const text = JSON.stringify(mutateAt(doc, m));
        expect(rustParse(text)).toBe(tsParse(text));
      }),
      { numRuns: runs() },
    );
  });

  test("on a tree with an array-index id, which shared trees refuse", () => {
    const doc = JSON.parse(JSON.stringify(buildFamily([])));
    const id = Object.keys(doc.persons)[0]!;
    const text = JSON.stringify(doc).replaceAll(id, "7");
    expect(rustParse(text)).toBeNull();
    expect(tsParse(text)).toBeNull();
  });

  test("on text that is not a tree", () => {
    for (const text of ["[]", "null", "7", '"tree"', "{}", "not json"]) {
      expect(rustParse(text)).toBeNull();
    }
  });
});
