import { describe, expect, test } from "bun:test";

import { newId } from "@/core/model/ids";
import {
  childrenOf,
  createTree,
  descendantsOf,
  displayName,
  isAncestor,
  parentsOf,
  parentUnionOf,
  partnersOf,
  siblingsOf,
  topmostAncestor,
  unionsOf,
} from "@/core/model/tree";

import {
  famAdoption,
  famCousinMarriage,
  famHalfSiblings,
  famRemarriage,
  famSimple,
  person,
} from "../../fixtures/families";

describe("ids and createTree", () => {
  test("newId is 12 characters and unique", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toHaveLength(12);
  });

  test("createTree makes an empty schema-1 document", () => {
    const now = new Date("2026-03-04T05:06:07.000Z");
    const doc = createTree("The Khans", now);
    expect(doc.name).toBe("The Khans");
    expect(doc.schemaVersion).toBe(1);
    expect(doc.rootPersonId).toBeUndefined();
    expect(doc.persons).toEqual({});
    expect(doc.unions).toEqual({});
    expect(doc.unionOrder).toEqual({});
    expect(doc.createdAt).toBe("2026-03-04T05:06:07.000Z");
    expect(doc.updatedAt).toBe(doc.createdAt);
    expect(doc.id).toHaveLength(12);
    expect(doc.settings.direction).toBe("ltr");
  });
});

describe("queries", () => {
  test("unionsOf follows unionOrder", () => {
    const doc = famRemarriage();
    expect(unionsOf(doc, "ali").map((u) => u.id)).toEqual(["m1", "m2"]);
    doc.unionOrder["ali"] = ["m2", "m1"];
    expect(unionsOf(doc, "ali").map((u) => u.id)).toEqual(["m2", "m1"]);
    expect(unionsOf(doc, "a1")).toEqual([]);
    expect(unionsOf(doc, "nobody")).toEqual([]);
  });

  test("parentUnionOf and parentsOf use the biological union by default", () => {
    const doc = famAdoption();
    expect(parentUnionOf(doc, "k2")?.id).toBe("un");
    expect(parentUnionOf(doc, "k2", "adopted")?.id).toBe("ua");
    expect(parentUnionOf(doc, "k1", "adopted")).toBeUndefined();
    expect(parentUnionOf(doc, "a")).toBeUndefined();
    expect(parentsOf(doc, "k2")).toEqual(["n1", "n2"]);
    expect(parentsOf(doc, "a")).toEqual([]);
  });

  test("childrenOf lists children of every union, any link type", () => {
    expect(childrenOf(famRemarriage(), "ali")).toEqual(["a1", "a2", "a3"]);
    expect(childrenOf(famRemarriage(), "wife2")).toEqual(["a3"]);
    expect(childrenOf(famAdoption(), "a")).toEqual(["k1", "k2"]);
    expect(childrenOf(famSimple(), "c1")).toEqual([]);
  });

  test("partnersOf lists partners across unions", () => {
    expect(partnersOf(famRemarriage(), "ali")).toEqual(["wife1", "wife2"]);
    expect(partnersOf(famRemarriage(), "wife1")).toEqual(["ali"]);
    expect(partnersOf(famSimple(), "c1")).toEqual([]);
  });

  test("siblingsOf marks half-siblings", () => {
    const doc = famHalfSiblings();
    const sibs = siblingsOf(doc, "k1");
    expect(sibs).toContainEqual({ personId: "k2", half: false });
    expect(sibs).toContainEqual({ personId: "k3", half: true });
    expect(sibs).toHaveLength(2);
    expect(siblingsOf(doc, "k3")).toEqual([
      { personId: "k1", half: true },
      { personId: "k2", half: true },
    ]);
    expect(siblingsOf(doc, "f")).toEqual([]);
  });

  test("siblingsOf treats children of two unions with the same couple as full siblings", () => {
    const doc = famSimple();
    doc.unions["u2"] = {
      id: "u2",
      partners: ["dad", "mom"],
      status: "married",
      children: [{ personId: "c3", type: "biological" }],
    };
    doc.unions["u1"]!.children = doc.unions["u1"]!.children.filter((c) => c.personId !== "c3");
    doc.unionOrder["dad"] = ["u1", "u2"];
    doc.unionOrder["mom"] = ["u1", "u2"];
    expect(siblingsOf(doc, "c1")).toEqual([
      { personId: "c2", half: false },
      { personId: "c3", half: false },
    ]);
  });

  test("siblingsOf includes adopted siblings as full siblings", () => {
    expect(siblingsOf(famAdoption(), "k1")).toEqual([{ personId: "k2", half: false }]);
  });

  test("isAncestor is true downwards only, over any child type", () => {
    const doc = famCousinMarriage();
    expect(isAncestor(doc, "g1", "kid")).toBe(true);
    expect(isAncestor(doc, "kid", "g1")).toBe(false);
    expect(isAncestor(doc, "g1", "g1")).toBe(false);
    expect(isAncestor(doc, "p1", "cousin2")).toBe(false);
    expect(isAncestor(famAdoption(), "a", "k2")).toBe(true);
  });

  test("descendantsOf excludes the person and handles shared descendants", () => {
    const doc = famCousinMarriage();
    expect(descendantsOf(doc, "g1")).toEqual(new Set(["p1", "p2", "cousin1", "cousin2", "kid"]));
    expect(descendantsOf(doc, "kid")).toEqual(new Set());
  });

  test("topmostAncestor follows the first biological parent", () => {
    const doc = famCousinMarriage();
    expect(topmostAncestor(doc, "kid")).toBe("g1");
    expect(topmostAncestor(doc, "cousin2")).toBe("s2");
    expect(topmostAncestor(doc, "g1")).toBe("g1");
  });

  test("traversals terminate on 5,000-person chains without recursion", () => {
    const doc = famSimple();
    let parent = "c1";
    for (let i = 0; i < 5000; i++) {
      const id = `x${i}`;
      doc.persons[id] = person(id, "X", String(i), "male");
      doc.unions[`ux${i}`] = {
        id: `ux${i}`,
        partners: [parent],
        status: "partner",
        children: [{ personId: id, type: "biological" }],
      };
      doc.unionOrder[parent] = [...(doc.unionOrder[parent] ?? []), `ux${i}`];
      parent = id;
    }
    expect(isAncestor(doc, "c1", parent)).toBe(true);
    expect(descendantsOf(doc, "c1").size).toBe(5000);
  });
});

describe("displayName", () => {
  test("joins first and last name", () => {
    expect(displayName(person("a", "Ali", "Khan", "male"))).toBe("Ali Khan");
  });

  test("handles a single name", () => {
    expect(displayName(person("a", "Ali", "", "male"))).toBe("Ali");
    expect(displayName(person("a", "", "Khan", "male"))).toBe("Khan");
  });

  test("returns an empty string for an unnamed placeholder", () => {
    expect(displayName(person("a", "", "", "male", { isPlaceholder: true }))).toBe("");
  });
});
