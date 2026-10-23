import { describe, expect, test } from "bun:test";

import { applyCommand } from "@/core/commands/apply";
import { parentUnionOf, unionsOf } from "@/core/model/tree";

import { applyChecked, expectCode, NOW } from "../../fixtures/commandHelpers";
import {
  docOf,
  famAdoption,
  famCousinMarriage,
  famRemarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";

describe("deletePerson (person)", () => {
  test("deleting the sole partner removes the union and keeps the children", () => {
    const doc = docOf(
      [
        person("p", "P", "", "female"),
        person("k1", "K1", "", "male"),
        person("k2", "K2", "", "male"),
      ],
      [union("u", ["p"], ["k1", "k2"], "partner")],
      "p",
    );
    const result = applyChecked(doc, { type: "deletePerson", personId: "p", mode: "person" });
    expect(Object.keys(result.doc.persons).toSorted()).toEqual(["k1", "k2"]);
    expect(result.doc.unions).toEqual({});
    expect(result.doc.unionOrder).toEqual({});
    expect(parentUnionOf(result.doc, "k1")).toBeUndefined();
    expect(parentUnionOf(result.doc, "k2")).toBeUndefined();
  });

  test("deleting one partner keeps the union for the other", () => {
    const result = applyChecked(famSimple(), {
      type: "deletePerson",
      personId: "mom",
      mode: "person",
    });
    expect(result.doc.persons["mom"]).toBeUndefined();
    expect(result.doc.unions["u1"]?.partners).toEqual(["dad"]);
    expect(result.doc.unions["u1"]?.children).toHaveLength(3);
    expect(result.doc.unionOrder["mom"]).toBeUndefined();
    expect(result.doc.unionOrder["dad"]).toEqual(["u1"]);
    expect(result.doc.rootPersonId).toBe("dad");
  });

  test("deleting the root reassigns it to the first remaining partner", () => {
    const result = applyChecked(famSimple(), {
      type: "deletePerson",
      personId: "dad",
      mode: "person",
    });
    expect(result.doc.rootPersonId).toBe("mom");
    expect(result.doc.unions["u1"]?.partners).toEqual(["mom"]);
  });

  test("a root with two unions falls back to the first partner in union order", () => {
    const result = applyChecked(famRemarriage(), {
      type: "deletePerson",
      personId: "ali",
      mode: "person",
    });
    expect(result.doc.rootPersonId).toBe("wife1");
    expect(result.doc.unions["m1"]?.partners).toEqual(["wife1"]);
    expect(result.doc.unions["m2"]?.partners).toEqual(["wife2"]);
    expect(result.doc.unions["m1"]?.children).toHaveLength(2);
  });

  test("a root without partners falls back to the first remaining child", () => {
    const doc = docOf(
      [
        person("p", "P", "", "female"),
        person("k1", "K1", "", "male"),
        person("k2", "K2", "", "male"),
      ],
      [union("u", ["p"], ["k1", "k2"], "partner")],
      "p",
    );
    const result = applyCommand(doc, { type: "deletePerson", personId: "p", mode: "person" }, NOW);
    expect(result.doc.rootPersonId).toBe("k1");
  });

  test("a root without partners or children falls back to the first remaining person", () => {
    const doc = docOf(
      [person("r", "R", "", "male"), person("a", "A", "", "male"), person("b", "B", "", "male")],
      [],
      "r",
    );
    const result = applyCommand(doc, { type: "deletePerson", personId: "r", mode: "person" }, NOW);
    expect(result.doc.rootPersonId).toBe("a");
  });

  test("deleting the last person leaves no root", () => {
    const doc = docOf([person("r", "R", "", "male")], [], "r");
    const result = applyChecked(doc, { type: "deletePerson", personId: "r", mode: "person" });
    expect(result.doc.persons).toEqual({});
    expect(result.doc.rootPersonId).toBeUndefined();
  });

  test("deleting someone other than the root keeps the root", () => {
    const result = applyChecked(famSimple(), {
      type: "deletePerson",
      personId: "c2",
      mode: "person",
    });
    expect(result.doc.rootPersonId).toBe("dad");
    expect(result.doc.unions["u1"]?.children.map((c) => c.personId)).toEqual(["c1", "c3"]);
  });

  test("a person's own unions and their children links are cleaned up", () => {
    const result = applyChecked(famCousinMarriage(), {
      type: "deletePerson",
      personId: "cousin1",
      mode: "person",
    });
    expect(result.doc.unions["uc"]?.partners).toEqual(["cousin2"]);
    expect(result.doc.unions["up1"]?.children).toEqual([]);
    expect(unionsOf(result.doc, "cousin2").map((u) => u.id)).toEqual(["uc"]);
  });

  test("a union that loses every partner is dropped from the remaining people's order", () => {
    const doc = docOf(
      [person("a", "A", "", "male"), person("b", "B", "", "female")],
      [union("u", ["a", "b"])],
      "a",
    );
    const afterA = applyCommand(doc, { type: "deletePerson", personId: "a", mode: "person" }, NOW);
    expect(afterA.doc.unions["u"]?.partners).toEqual(["b"]);
    const afterB = applyChecked(afterA.doc, {
      type: "deletePerson",
      personId: "b",
      mode: "person",
    });
    expect(afterB.doc.unions).toEqual({});
    expect(afterB.doc.unionOrder).toEqual({});
  });

  test("unknown person is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(famSimple(), { type: "deletePerson", personId: "ghost", mode: "person" }, NOW),
      "NOT_FOUND",
    );
  });
});

describe("deletePerson (withDescendants)", () => {
  test("a grandparent takes their descendants with them, but not in-laws", () => {
    const result = applyChecked(famCousinMarriage(), {
      type: "deletePerson",
      personId: "g1",
      mode: "withDescendants",
    });
    expect(Object.keys(result.doc.persons).toSorted()).toEqual(["g2", "s1", "s2"]);
    expect(result.doc.unions["ug"]?.partners).toEqual(["g2"]);
    expect(result.doc.unions["up1"]?.partners).toEqual(["s1"]);
    expect(result.doc.unions["up2"]?.partners).toEqual(["s2"]);
    expect(result.doc.unions["uc"]).toBeUndefined();
    expect(result.doc.rootPersonId).toBe("g2");
  });

  test("adopted and biological descendants are both removed", () => {
    const result = applyChecked(famAdoption(), {
      type: "deletePerson",
      personId: "a",
      mode: "withDescendants",
    });
    expect(Object.keys(result.doc.persons).toSorted()).toEqual(["b", "n1", "n2"]);
    expect(result.doc.unions["un"]).toMatchObject({ partners: ["n1", "n2"], children: [] });
    expect(result.doc.rootPersonId).toBe("b");
  });

  test("a leaf behaves like a plain delete", () => {
    const result = applyChecked(famSimple(), {
      type: "deletePerson",
      personId: "c3",
      mode: "withDescendants",
    });
    expect(Object.keys(result.doc.persons)).toHaveLength(4);
  });

  test("deleting everyone leaves an empty tree", () => {
    const result = applyChecked(
      docOf(
        [person("a", "A", "", "male"), person("k", "K", "", "male")],
        [union("u", ["a"], ["k"], "partner")],
        "a",
      ),
      { type: "deletePerson", personId: "a", mode: "withDescendants" },
    );
    expect(result.doc.persons).toEqual({});
    expect(result.doc.unions).toEqual({});
    expect(result.doc.rootPersonId).toBeUndefined();
  });

  test("unknown person is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "deletePerson", personId: "ghost", mode: "withDescendants" },
          NOW,
        ),
      "NOT_FOUND",
    );
  });
});
