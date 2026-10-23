import { describe, expect, test } from "bun:test";

import { createTree } from "@/core/model/tree";
import { validate } from "@/core/model/validate";

import {
  allFamilies,
  docOf,
  famCousinMarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";

describe("validate", () => {
  test("an empty tree is valid", () => {
    expect(validate(createTree("Empty"))).toEqual([]);
  });

  test.each(allFamilies)("%s is valid", (_name, build) => {
    expect(validate(build())).toEqual([]);
  });

  test("a child id missing from persons is DANGLING_REF", () => {
    const doc = famSimple();
    doc.unions["u1"]!.children.push({ personId: "ghost", type: "biological" });
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("DANGLING_REF");
    expect(issues[0]?.ids).toContain("ghost");
  });

  test("a partner id missing from persons is DANGLING_REF", () => {
    const doc = famSimple();
    doc.unions["u1"]!.partners = ["dad", "ghost"];
    doc.unionOrder["mom"] = [];
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("DANGLING_REF");
  });

  test("a unionOrder entry for a missing union is DANGLING_REF", () => {
    const doc = famSimple();
    doc.unionOrder["dad"] = ["u1", "gone"];
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("DANGLING_REF");
  });

  test("a person who is a biological child of two unions is MULTIPLE_BIO_PARENTS", () => {
    const doc = docOf(
      [
        person("a", "A", "", "male"),
        person("b", "B", "", "female"),
        person("c", "C", "", "male"),
        person("d", "D", "", "female"),
        person("k", "K", "", "male"),
      ],
      [union("u1", ["a", "b"], ["k"]), union("u2", ["c", "d"], ["k"])],
      "a",
    );
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("MULTIPLE_BIO_PARENTS");
    expect(issues[0]?.ids).toContain("k");
  });

  test("being biological in one union and adopted in another is fine", () => {
    expect(validate(famCousinMarriage())).toEqual([]);
  });

  test("A child of B and B child of A is CYCLE", () => {
    const doc = docOf(
      [person("a", "A", "", "male"), person("b", "B", "", "female")],
      [union("u1", ["b"], ["a"], "partner"), union("u2", ["a"], ["b"], "partner")],
      "a",
    );
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("CYCLE");
    expect(new Set(issues[0]?.ids)).toEqual(new Set(["a", "b"]));
  });

  test("a person who is their own child is CYCLE", () => {
    const doc = docOf([person("a", "A", "", "male")], [union("u1", ["a"], ["a"], "partner")], "a");
    expect(validate(doc).map((i) => i.code)).toEqual(["CYCLE"]);
  });

  test("a longer cycle through three generations is one CYCLE", () => {
    const doc = docOf(
      [person("a", "A", "", "male"), person("b", "B", "", "male"), person("c", "C", "", "male")],
      [
        union("u1", ["a"], ["b"], "partner"),
        union("u2", ["b"], ["c"], "partner"),
        union("u3", ["c"], ["a"], "partner"),
      ],
      "a",
    );
    expect(validate(doc).map((i) => i.code)).toEqual(["CYCLE"]);
  });

  test("a union with no partners is EMPTY_UNION", () => {
    const doc = famSimple();
    doc.unions["u1"]!.partners = [] as unknown as [string];
    doc.unionOrder["dad"] = [];
    doc.unionOrder["mom"] = [];
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("EMPTY_UNION");
    expect(issues[0]?.ids).toEqual(["u1"]);
  });

  test("a rootPersonId that is not in persons is BAD_ROOT", () => {
    const doc = famSimple();
    doc.rootPersonId = "ghost";
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("BAD_ROOT");
  });

  test("a union missing from a partner's unionOrder is UNION_ORDER_MISMATCH", () => {
    const doc = famSimple();
    doc.unionOrder["mom"] = [];
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("UNION_ORDER_MISMATCH");
    expect(issues[0]?.ids).toContain("mom");
  });

  test("a unionOrder entry for a union the person is not in is UNION_ORDER_MISMATCH", () => {
    const doc = famSimple();
    doc.unionOrder["c1"] = ["u1"];
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("UNION_ORDER_MISMATCH");
  });

  test("a union listed twice in unionOrder is UNION_ORDER_MISMATCH", () => {
    const doc = famSimple();
    doc.unionOrder["dad"] = ["u1", "u1"];
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("UNION_ORDER_MISMATCH");
  });

  test("the same child twice in one union is DUPLICATE_CHILD", () => {
    const doc = famSimple();
    doc.unions["u1"]!.children.push({ personId: "c1", type: "biological" });
    const issues = validate(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("DUPLICATE_CHILD");
    expect(issues[0]?.ids).toEqual(["u1", "c1"]);
  });
});
