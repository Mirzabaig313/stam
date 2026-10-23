import { describe, expect, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import { layoutPedigree } from "@/core/layout/pedigree";
import { validate } from "@/core/model/validate";
import { ancestorFamily, bigFamily, chainFamily, remarriedFamily } from "@/dev/bigFamily";

describe("bigFamily", () => {
  test("has exactly the people asked for, all reachable from the root", () => {
    const doc = bigFamily(1000);
    expect(Object.keys(doc.persons)).toHaveLength(1000);
    expect(validate(doc)).toEqual([]);
    const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
    expect(layout.unreachable).toEqual([]);
    expect(layout.nodes.filter((n) => n.kind === "linked")).toEqual([]);
  });

  test("is deterministic, ids included", () => {
    expect(bigFamily(200)).toEqual(bigFamily(200));
    expect(bigFamily(200, 7)).not.toEqual(bigFamily(200));
  });

  test("is balanced: four children per couple, every blood relative married", () => {
    const doc = bigFamily(1000);
    const unions = Object.values(doc.unions);
    const withChildren = unions.filter((u) => u.children.length > 0);
    // Only the last couple filled may have fewer than four children.
    expect(withChildren.filter((u) => u.children.length !== 4).length).toBeLessThanOrEqual(1);
    for (const union of unions) expect(union.partners).toHaveLength(2);
    // 1000 is even, so every person, blood or in-law, is in exactly one couple.
    for (const id of Object.keys(doc.persons)) expect(doc.unionOrder[id]).toHaveLength(1);
  });

  test("is frozen like any other document", () => {
    expect(Object.isFrozen(bigFamily(20).persons)).toBe(true);
  });

  test("builds 5,000 people in well under a second (R13)", () => {
    const start = performance.now();
    const doc = bigFamily(5000);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(Object.keys(doc.persons)).toHaveLength(5000);
  });
});

describe("benchmark shapes", () => {
  test("chainFamily is a deep line of couples, each with unmarried siblings", () => {
    const doc = chainFamily(50, 2);
    expect(validate(doc)).toEqual([]);
    expect(Object.keys(doc.persons)).toHaveLength(2 + 49 * 4);
    const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
    expect(layout.generationCount).toBe(50);
    expect(layout.unreachable).toEqual([]);
    expect(chainFamily(50, 2)).toEqual(doc);
  });

  test("remarriedFamily gives every blood relative three marriages", () => {
    const doc = remarriedFamily(1000);
    expect(validate(doc)).toEqual([]);
    expect(Object.keys(doc.persons)).toHaveLength(1000);
    const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
    expect(layout.unreachable).toEqual([]);
    expect(doc.unionOrder[doc.rootPersonId!]).toHaveLength(3);
    expect(remarriedFamily(1000)).toEqual(doc);
  });

  test("ancestorFamily is a full pedigree of exactly the people asked for", () => {
    const doc = ancestorFamily(1001);
    expect(validate(doc)).toEqual([]);
    expect(Object.keys(doc.persons)).toHaveLength(1001);
    const layout = layoutPedigree(doc, { focusId: doc.rootPersonId! });
    expect(layout.unreachable).toEqual([]);
    expect(layout.nodes).toHaveLength(1001);
    // The focus and nine generations above: 1 + 2 + … + 256 = 511 < 1001 ≤ 1023.
    expect(layout.generationCount).toBe(10);
    expect(ancestorFamily(1001)).toEqual(doc);
  });
});
