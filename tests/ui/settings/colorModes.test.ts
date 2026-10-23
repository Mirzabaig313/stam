import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { layoutFamily } from "@/core/layout/family";
import { partnersOf } from "@/core/model/tree";
import { branchOf, generationHue, HUE_COUNT } from "@/ui/settings/colorModes";

import { arbFamily, runs } from "../../fixtures/arbitraries";
import {
  docOf,
  famCousinMarriage,
  famRemarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";

const layoutOf = (doc: ReturnType<typeof famSimple>, rootId = doc.rootPersonId!) =>
  layoutFamily(doc, { rootId });

describe("branchOf", () => {
  test("each child of the root starts a branch, in sibling order; the root couple has none", () => {
    const doc = famSimple();
    const b = branchOf(doc, layoutOf(doc));
    expect(b).toEqual({ c1: 0, c2: 1, c3: 2 });
  });

  test("children from every union of the root, in union order", () => {
    const doc = famRemarriage();
    expect(branchOf(doc, layoutOf(doc))).toEqual({ a1: 0, a2: 1, a3: 2 });
  });

  test("descendants inherit their branch, and so do their partners", () => {
    const doc = famCousinMarriage();
    const b = branchOf(doc, layoutOf(doc));
    expect(b.p1).toBe(0);
    expect(b.s1).toBe(0); // p1's wife
    expect(b.cousin1).toBe(0);
    expect(b.p2).toBe(1);
    expect(b.s2).toBe(1);
    expect(b.cousin2).toBe(1);
    // cousin1 and cousin2 married: their child goes with the first branch that reaches them.
    expect(b.kid).toBe(0);
    expect(b.g1).toBeUndefined();
    expect(b.g2).toBeUndefined();
  });

  test("the view root decides: a sub-tree starts its own branches", () => {
    const doc = famCousinMarriage();
    expect(branchOf(doc, layoutOf(doc, "p1"))).toEqual({ cousin1: 0, cousin2: 0, kid: 0 });
  });

  test("more children than hues wrap around", () => {
    const kids = Array.from({ length: 8 }, (_, i) => person(`k${i}`, `K${i}`, "X", "male"));
    const doc = docOf(
      [person("r", "R", "X", "male"), ...kids],
      [
        union(
          "u",
          ["r"],
          kids.map((k) => k.id),
        ),
      ],
      "r",
    );
    const b = branchOf(doc, layoutOf(doc));
    expect(b.k5).toBe(5);
    expect(b.k6).toBe(0);
    expect(b.k7).toBe(1);
  });

  test("an empty layout gives no branches", () => {
    const doc = famSimple();
    expect(branchOf(doc, { ...layoutOf(doc), nodes: [] })).toEqual({});
  });

  test("property: only people in the layout, every value a hue, everyone below the root has one", () => {
    fc.assert(
      fc.property(arbFamily(), (doc) => {
        if (!doc.rootPersonId) return;
        const layout = layoutOf(doc);
        const b = branchOf(doc, layout);
        const shown = new Set(layout.nodes.map((n) => n.personId));
        for (const [id, hue] of Object.entries(b)) {
          expect(shown.has(id)).toBe(true);
          expect(Number.isInteger(hue) && hue >= 0 && hue < HUE_COUNT).toBe(true);
        }
        expect(b[doc.rootPersonId]).toBeUndefined();
        // Everyone shown below the root, or partnered with someone who is, has a branch.
        for (const node of layout.nodes) {
          if (node.generation === 0) continue;
          const partnered = partnersOf(doc, node.personId).some((p) => b[p] !== undefined);
          if (node.kind === "blood" || partnered) expect(b[node.personId]).toBeDefined();
        }
      }),
      { numRuns: Math.max(100, runs() / 10) },
    );
  });
});

describe("generationHue", () => {
  test("cycles through the hues, negative generations included", () => {
    expect([0, 1, 5, 6, 7].map(generationHue)).toEqual([0, 1, 5, 0, 1]);
    expect(generationHue(-1)).toBe(5);
  });
});
