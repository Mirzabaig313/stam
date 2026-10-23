import { describe, expect, test } from "bun:test";

import { applyCommand } from "@/core/commands/apply";
import { usableUnionsForChild, validDropActions } from "@/core/commands/validActions";
import { descendantsOf, parentUnionOf, partnersOf, unionsOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

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

const childIds = (doc: TreeDocument, unionId: string) =>
  doc.unions[unionId]!.children.map((c) => c.personId);

describe("validDropActions", () => {
  test("unrelated people allow all three actions, in order", () => {
    expect(validDropActions(famRemarriage(), "wife1", "wife2")).toEqual([
      "child",
      "spouse",
      "parent",
    ]);
  });

  test("siblings can be made children or spouses, but a full target takes no third parent", () => {
    expect(validDropActions(famSimple(), "c1", "c2")).toEqual(["child", "spouse"]);
  });

  test("dropping a person on themselves allows nothing", () => {
    expect(validDropActions(famSimple(), "c1", "c1")).toEqual([]);
  });

  test("unknown people allow nothing", () => {
    expect(validDropActions(famSimple(), "c1", "ghost")).toEqual([]);
    expect(validDropActions(famSimple(), "ghost", "c1")).toEqual([]);
  });

  test("dragging a grandparent onto a grandchild yields no child action", () => {
    const actions = validDropActions(famCousinMarriage(), "g1", "kid");
    expect(actions).not.toContain("child");
    expect(actions).toEqual([]);
  });

  test("dragging a grandchild onto a grandparent only allows child", () => {
    expect(validDropActions(famCousinMarriage(), "kid", "g1")).toEqual(["child"]);
  });

  test("a parent and child cannot be spouses or swap roles", () => {
    expect(validDropActions(famSimple(), "dad", "c1")).toEqual([]);
    expect(validDropActions(famSimple(), "c1", "dad")).toEqual([]);
  });

  test("already-linked partners cannot become spouses again, or children of each other", () => {
    expect(validDropActions(famSimple(), "dad", "mom")).toEqual(["parent"]);
  });

  test("an adopted child is already a child of the adopter", () => {
    expect(validDropActions(famAdoption(), "k2", "a")).toEqual([]);
  });

  test("a target with two biological parents cannot get a third", () => {
    expect(validDropActions(famRemarriage(), "wife1", "a3")).not.toContain("parent");
    expect(validDropActions(famRemarriage(), "wife1", "a3")).toEqual(["child", "spouse"]);
  });

  test("a target with one biological parent can get a second", () => {
    const doc = docOf(
      [person("a", "A", "", "female"), person("k", "K", "", "male"), person("x", "X", "", "male")],
      [union("u", ["a"], ["k"], "partner")],
      "a",
    );
    expect(validDropActions(doc, "x", "k")).toContain("parent");
  });

  test("a person who is already the target's parent cannot be dropped as parent again", () => {
    const doc = docOf(
      [person("a", "A", "", "female"), person("k", "K", "", "male")],
      [union("u", ["a"], ["k"], "partner")],
      "a",
    );
    expect(validDropActions(doc, "a", "k")).toEqual([]);
  });

  test("a spouse whose partner has other unions can still be made a child of the other union", () => {
    // wife1 is a partner of ali only through m1; ali has two unions, so child stays possible.
    expect(validDropActions(famRemarriage(), "wife1", "ali")).toContain("child");
  });
});

describe("relinkAsChild", () => {
  test("moves a subtree and keeps the moved person's descendants linked", () => {
    const before = descendantsOf(famCousinMarriage(), "p2");
    const result = applyChecked(famCousinMarriage(), {
      type: "relinkAsChild",
      personId: "p2",
      parentId: "p1",
    });
    expect(childIds(result.doc, "ug")).toEqual(["p1"]);
    expect(childIds(result.doc, "up1")).toEqual(["cousin1", "p2"]);
    expect(parentUnionOf(result.doc, "p2")?.id).toBe("up1");
    expect(descendantsOf(result.doc, "p2")).toEqual(before);
    expect(childIds(result.doc, "up2")).toEqual(["cousin2"]);
    expect(result.createdIds).toEqual([]);
  });

  test("making the root a child moves the root up to the new parent union's first partner", () => {
    const doc = docOf(
      [person("r", "R", "", "male"), person("p", "P", "", "female"), person("q", "Q", "", "male")],
      [union("u", ["p", "q"])],
      "r",
    );
    const result = applyChecked(doc, { type: "relinkAsChild", personId: "r", parentId: "p" });
    expect(result.doc.rootPersonId).toBe("p");
    expect(parentUnionOf(result.doc, "r")?.id).toBe("u");
  });

  test("making a non-root person a child leaves the root alone", () => {
    const result = applyCommand(
      famRemarriage(),
      { type: "relinkAsChild", personId: "wife2", parentId: "a1" },
      NOW,
    );
    expect(result.doc.rootPersonId).toBe("ali");
  });

  test("a parent without unions gets a new single-parent union", () => {
    const doc = docOf([person("p", "P", "", "female"), person("x", "X", "", "male")], [], "p");
    const result = applyChecked(doc, { type: "relinkAsChild", personId: "x", parentId: "p" });
    const [created] = unionsOf(result.doc, "p");
    expect(created).toMatchObject({ partners: ["p"], status: "partner" });
    expect(created?.children).toEqual([{ personId: "x", type: "biological" }]);
  });

  test("uses the same ordering rule as addChild", () => {
    const doc = famSimple();
    doc.persons["x"] = person("x", "X", "", "male", { birth: { date: { year: 1981 } } });
    const result = applyCommand(
      doc,
      { type: "relinkAsChild", personId: "x", parentId: "dad" },
      NOW,
    );
    expect(childIds(result.doc, "u1")).toEqual(["c1", "x", "c2", "c3"]);
  });

  test("only the biological link is replaced, other link types stay", () => {
    const result = applyChecked(famAdoption(), {
      type: "relinkAsChild",
      personId: "k2",
      parentId: "k1",
    });
    expect(childIds(result.doc, "un")).toEqual([]);
    expect(result.doc.unions["ua"]?.children).toContainEqual({ personId: "k2", type: "adopted" });
    expect(parentUnionOf(result.doc, "k2")?.partners).toEqual(["k1"]);
  });

  test("a parent with several unions needs a choice, an explicit union resolves it", () => {
    const doc = famRemarriage();
    doc.persons["x"] = person("x", "X", "", "male");
    expectCode(
      () => applyCommand(doc, { type: "relinkAsChild", personId: "x", parentId: "ali" }, NOW),
      "AMBIGUOUS_UNION",
    );
    const result = applyChecked(doc, {
      type: "relinkAsChild",
      personId: "x",
      parentId: "ali",
      unionId: "m2",
    });
    expect(childIds(result.doc, "m2")).toEqual(["a3", "x"]);
  });

  test("into an own descendant is CYCLE", () => {
    expectCode(
      () =>
        applyCommand(
          famCousinMarriage(),
          { type: "relinkAsChild", personId: "g1", parentId: "kid" },
          NOW,
        ),
      "CYCLE",
    );
    expectCode(
      () =>
        applyCommand(famSimple(), { type: "relinkAsChild", personId: "c1", parentId: "c1" }, NOW),
      "CYCLE",
    );
  });

  test("into the own union of a partner is CYCLE", () => {
    expectCode(
      () =>
        applyCommand(famSimple(), { type: "relinkAsChild", personId: "dad", parentId: "mom" }, NOW),
      "CYCLE",
    );
  });

  test("when already a child of the target is ALREADY_LINKED", () => {
    expectCode(
      () =>
        applyCommand(famSimple(), { type: "relinkAsChild", personId: "c1", parentId: "dad" }, NOW),
      "ALREADY_LINKED",
    );
  });

  test("unknown ids are NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "relinkAsChild", personId: "ghost", parentId: "dad" },
          NOW,
        ),
      "NOT_FOUND",
    );
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "relinkAsChild", personId: "c1", parentId: "ghost" },
          NOW,
        ),
      "NOT_FOUND",
    );
  });
});

describe("relinkAsSpouse", () => {
  test("creates a new married union", () => {
    const result = applyChecked(famRemarriage(), {
      type: "relinkAsSpouse",
      personId: "wife1",
      targetId: "wife2",
    });
    const created = unionsOf(result.doc, "wife2").at(-1)!;
    expect(created).toMatchObject({
      partners: ["wife2", "wife1"],
      status: "married",
      children: [],
    });
    expect(result.doc.unionOrder["wife1"]).toEqual(["m1", created.id]);
    expect(partnersOf(result.doc, "wife1")).toEqual(["ali", "wife2"]);
  });

  test("never fills a single-parent union (that is addSpouse's job)", () => {
    const doc = docOf(
      [person("a", "A", "", "female"), person("k", "K", "", "male"), person("x", "X", "", "male")],
      [union("u", ["a"], ["k"], "partner")],
      "a",
    );
    const result = applyChecked(doc, { type: "relinkAsSpouse", personId: "x", targetId: "a" });
    expect(Object.keys(result.doc.unions)).toHaveLength(2);
    expect(result.doc.unions["u"]?.partners).toEqual(["a"]);
  });

  test("ancestors and descendants are CYCLE, partners are ALREADY_LINKED", () => {
    expectCode(
      () =>
        applyCommand(famSimple(), { type: "relinkAsSpouse", personId: "dad", targetId: "c1" }, NOW),
      "CYCLE",
    );
    expectCode(
      () =>
        applyCommand(
          famCousinMarriage(),
          { type: "relinkAsSpouse", personId: "kid", targetId: "g1" },
          NOW,
        ),
      "CYCLE",
    );
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "relinkAsSpouse", personId: "dad", targetId: "mom" },
          NOW,
        ),
      "ALREADY_LINKED",
    );
    expectCode(
      () =>
        applyCommand(famSimple(), { type: "relinkAsSpouse", personId: "c1", targetId: "c1" }, NOW),
      "CYCLE",
    );
  });
});

describe("relinkAsParent", () => {
  test("a person without parents gets the dragged person as single parent", () => {
    const result = applyChecked(famRemarriage(), {
      type: "relinkAsParent",
      personId: "wife2",
      childId: "wife1",
    });
    expect(parentUnionOf(result.doc, "wife1")).toMatchObject({
      partners: ["wife2"],
      status: "partner",
    });
    expect(result.createdIds).toEqual([]);
  });

  test("becomes the second parent of a single-parent child", () => {
    const doc = docOf(
      [person("a", "A", "", "female"), person("k", "K", "", "male"), person("x", "X", "", "male")],
      [union("u", ["a"], ["k"], "partner")],
      "a",
    );
    const result = applyChecked(doc, { type: "relinkAsParent", personId: "x", childId: "k" });
    expect(result.doc.unions["u"]).toMatchObject({ partners: ["a", "x"], status: "married" });
    expect(result.doc.unionOrder["x"]).toEqual(["u"]);
  });

  test("the root moves up to the new parent union's first partner", () => {
    const doc = docOf([person("r", "R", "", "male"), person("x", "X", "", "female")], [], "r");
    const result = applyChecked(doc, { type: "relinkAsParent", personId: "x", childId: "r" });
    expect(result.doc.rootPersonId).toBe("x");
  });

  test("a descendant cannot become the parent of an ancestor (CYCLE)", () => {
    expectCode(
      () =>
        applyCommand(
          famCousinMarriage(),
          { type: "relinkAsParent", personId: "kid", childId: "g1" },
          NOW,
        ),
      "CYCLE",
    );
  });

  test("a third parent is PARENTS_FULL", () => {
    expectCode(
      () =>
        applyCommand(
          famRemarriage(),
          { type: "relinkAsParent", personId: "wife1", childId: "a3" },
          NOW,
        ),
      "PARENTS_FULL",
    );
  });

  test("an existing parent is ALREADY_LINKED, even when the child has two parents", () => {
    expectCode(
      () =>
        applyCommand(famSimple(), { type: "relinkAsParent", personId: "dad", childId: "c1" }, NOW),
      "ALREADY_LINKED",
    );
  });

  test("a cycle wins over a full parent union", () => {
    // cousin1 already has two parents, and kid descends from cousin1
    expectCode(
      () =>
        applyCommand(
          famCousinMarriage(),
          { type: "relinkAsParent", personId: "kid", childId: "cousin1" },
          NOW,
        ),
      "CYCLE",
    );
  });
});

/** p is the parent of r; r is married to w. */
const parentOfRoot = () =>
  docOf(
    [person("p", "P", "", "female"), person("r", "R", "", "male"), person("w", "W", "", "female")],
    [union("up", ["p"], ["r"], "partner"), union("ur", ["r", "w"])],
    "p",
  );

/** m has children k and s; s has child x. */
const nephewOfChild = () =>
  docOf(
    [
      person("m", "M", "", "female"),
      person("k", "K", "", "male"),
      person("s", "S", "", "male"),
      person("x", "X", "", "male"),
    ],
    [union("um", ["m"], ["k", "s"], "partner"), union("us", ["s"], ["x"], "partner")],
    "m",
  );

// Found by the property tests: the new links also reach the other people in the union.
describe("regressions: cycles through a union's other members", () => {
  test("making someone a child of their descendant's spouse is CYCLE", () => {
    // w's only union is shared with r, who descends from p: p would become r's child.
    expect(validDropActions(parentOfRoot(), "p", "w")).not.toContain("child");
    expectCode(
      () =>
        applyCommand(parentOfRoot(), { type: "relinkAsChild", personId: "p", parentId: "w" }, NOW),
      "CYCLE",
    );
  });

  test("an explicit union with a descendant of the dragged person is CYCLE", () => {
    expectCode(
      () =>
        applyCommand(
          parentOfRoot(),
          { type: "relinkAsChild", personId: "p", parentId: "w", unionId: "ur" },
          NOW,
        ),
      "CYCLE",
    );
  });

  test("a spouse with another, usable union still accepts the drop", () => {
    const doc = parentOfRoot();
    doc.persons["z"] = person("z", "Z", "", "male");
    doc.unions["uw"] = union("uw", ["w", "z"]);
    doc.unionOrder["w"] = ["ur", "uw"];
    doc.unionOrder["z"] = ["uw"];
    expect(validDropActions(doc, "p", "w")).toContain("child");
    const result = applyChecked(doc, {
      type: "relinkAsChild",
      personId: "p",
      parentId: "w",
      unionId: "uw",
    });
    expect(parentUnionOf(result.doc, "p")?.id).toBe("uw");
  });

  test("making someone the parent of a person whose sibling is their ancestor is CYCLE", () => {
    // x would parent k, and with it k's sibling s, who is x's own parent.
    expect(validDropActions(nephewOfChild(), "x", "k")).not.toContain("parent");
    expectCode(
      () =>
        applyCommand(nephewOfChild(), { type: "relinkAsParent", personId: "x", childId: "k" }, NOW),
      "CYCLE",
    );
  });

  test("making someone the parent of their own sibling is CYCLE", () => {
    expect(validDropActions(nephewOfChild(), "s", "k")).not.toContain("parent");
    expectCode(
      () =>
        applyCommand(nephewOfChild(), { type: "relinkAsParent", personId: "s", childId: "k" }, NOW),
      "CYCLE",
    );
  });
});

/** w has two unions: ur with r (a descendant of p), and uw with z. */
const wTwoUnions = () => {
  const doc = parentOfRoot();
  doc.persons["z"] = person("z", "Z", "", "male");
  doc.unions["uw"] = union("uw", ["w", "z"]);
  doc.unionOrder["w"] = ["ur", "uw"];
  doc.unionOrder["z"] = ["uw"];
  return doc;
};

describe("usableUnionsForChild", () => {
  test("leaves out unions with a partner who descends from the dragged person", () => {
    expect(usableUnionsForChild(wTwoUnions(), "p", "w")).toEqual(["uw"]);
  });

  test("lists every usable union in unionOrder order", () => {
    expect(usableUnionsForChild(famRemarriage(), "wife1", "a1")).toEqual([]);
    const doc = famRemarriage();
    doc.persons["x"] = person("x", "X", "", "male");
    expect(usableUnionsForChild(doc, "x", "ali")).toEqual(["m1", "m2"]);
    doc.unionOrder["ali"] = ["m2", "m1"];
    expect(usableUnionsForChild(doc, "x", "ali")).toEqual(["m2", "m1"]);
  });

  test("leaves out unions the dragged person is a partner of", () => {
    expect(usableUnionsForChild(famRemarriage(), "wife1", "ali")).toEqual(["m2"]);
  });

  test("is empty when every union is unusable, and then child is not offered", () => {
    expect(usableUnionsForChild(parentOfRoot(), "p", "w")).toEqual([]);
    expect(validDropActions(parentOfRoot(), "p", "w")).not.toContain("child");
  });

  test("a target without unions has none to list, but still accepts a child", () => {
    expect(usableUnionsForChild(famSimple(), "dad", "c1")).toEqual([]);
    expect(validDropActions(famRemarriage(), "wife2", "a1")).toContain("child");
  });
});
