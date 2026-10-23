import { describe, expect, test } from "bun:test";

import { produce } from "immer";

import { applyCommand } from "@/core/commands/apply";
import { insertUnionInOrder } from "@/core/commands/unionOrder";
import { parentUnionOf, unionsOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import { applyChecked, expectCode, NOW } from "../../fixtures/commandHelpers";
import {
  docOf,
  famAdoption,
  famHalfSiblings,
  famRemarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";

const childIds = (doc: TreeDocument, unionId: string) =>
  doc.unions[unionId]!.children.map((c) => c.personId);

/** Parent `p` with one union holding children born in the given years (undefined = no date). */
function famBirths(years: (number | undefined)[]): TreeDocument {
  const kids = years.map((y, i) =>
    person(`k${i}`, `Kid${i}`, "", "male", y === undefined ? {} : { birth: { date: { year: y } } }),
  );
  return docOf(
    [person("p", "P", "", "female"), ...kids],
    [
      union(
        "u",
        ["p"],
        kids.map((k) => k.id),
        "partner",
      ),
    ],
    "p",
  );
}

describe("addChild", () => {
  test("a parent without unions gets a new single-parent union", () => {
    const doc = docOf([person("p", "P", "", "female")], [], "p");
    const result = applyChecked(doc, {
      type: "addChild",
      parentId: "p",
      child: { gender: "male", firstName: "Kid" },
    });
    const [kidId] = result.createdIds;
    expect(result.createdIds).toHaveLength(1);
    const unions = unionsOf(result.doc, "p");
    expect(unions).toHaveLength(1);
    expect(unions[0]).toMatchObject({
      partners: ["p"],
      status: "partner",
      children: [{ personId: kidId, type: "biological" }],
    });
    expect(result.doc.persons[kidId!]).toMatchObject({ firstName: "Kid", gender: "male" });
  });

  test("a parent with one union uses it", () => {
    const result = applyChecked(famSimple(), {
      type: "addChild",
      parentId: "dad",
      child: { gender: "female" },
    });
    expect(Object.keys(result.doc.unions)).toEqual(["u1"]);
    expect(childIds(result.doc, "u1")).toEqual(["c1", "c2", "c3", result.createdIds[0]!]);
  });

  test("a parent with two unions needs a choice", () => {
    expectCode(
      () =>
        applyCommand(
          famRemarriage(),
          { type: "addChild", parentId: "ali", child: { gender: "male" } },
          NOW,
        ),
      "AMBIGUOUS_UNION",
    );
  });

  test("an explicit union resolves the choice", () => {
    const result = applyChecked(famRemarriage(), {
      type: "addChild",
      parentId: "ali",
      unionId: "m2",
      child: { gender: "male" },
    });
    expect(childIds(result.doc, "m2")).toEqual(["a3", result.createdIds[0]!]);
    expect(childIds(result.doc, "m1")).toEqual(["a1", "a2"]);
  });

  test("a union that does not contain the parent is INVALID", () => {
    expectCode(
      () =>
        applyCommand(
          famRemarriage(),
          { type: "addChild", parentId: "wife1", unionId: "m2", child: { gender: "male" } },
          NOW,
        ),
      "INVALID",
    );
  });

  test("unknown parent or union is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "addChild", parentId: "ghost", child: { gender: "male" } },
          NOW,
        ),
      "NOT_FOUND",
    );
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "addChild", parentId: "dad", unionId: "ghost", child: { gender: "male" } },
          NOW,
        ),
      "NOT_FOUND",
    );
  });

  test("child type defaults to biological and can be set", () => {
    const bio = applyCommand(
      famSimple(),
      { type: "addChild", parentId: "dad", child: { gender: "male" } },
      NOW,
    );
    expect(bio.doc.unions["u1"]!.children.at(-1)?.type).toBe("biological");
    const adopted = applyChecked(famSimple(), {
      type: "addChild",
      parentId: "dad",
      child: { gender: "male" },
      childType: "adopted",
    });
    expect(adopted.doc.unions["u1"]!.children.at(-1)?.type).toBe("adopted");
    expect(parentUnionOf(adopted.doc, adopted.createdIds[0]!)).toBeUndefined();
  });

  test("a child born 1955 lands between siblings born 1950 and 1960", () => {
    const doc = famBirths([1950, 1960, undefined]);
    const result = applyChecked(doc, {
      type: "addChild",
      parentId: "p",
      child: { gender: "female", birth: { date: { year: 1955 } } },
    });
    expect(childIds(result.doc, "u").indexOf(result.createdIds[0]!)).toBe(1);
    expect(childIds(result.doc, "u")).toHaveLength(4);
  });

  test("a child born before everyone goes first", () => {
    const result = applyCommand(
      famBirths([1950, 1960]),
      {
        type: "addChild",
        parentId: "p",
        child: { gender: "male", birth: { date: { year: 1940 } } },
      },
      NOW,
    );
    expect(childIds(result.doc, "u")[0]).toBe(result.createdIds[0]!);
  });

  test("a child born after everyone dated goes after the dated and undated siblings", () => {
    const result = applyCommand(
      famBirths([1950, 1960, undefined]),
      {
        type: "addChild",
        parentId: "p",
        child: { gender: "male", birth: { date: { year: 1999 } } },
      },
      NOW,
    );
    expect(childIds(result.doc, "u").at(-1)).toBe(result.createdIds[0]!);
  });

  test("a child without a birth date goes last", () => {
    const result = applyCommand(
      famBirths([1950, 1960]),
      { type: "addChild", parentId: "p", child: { gender: "male" } },
      NOW,
    );
    expect(childIds(result.doc, "u").at(-1)).toBe(result.createdIds[0]!);
  });

  test("a birth date with no year counts as undated", () => {
    const result = applyCommand(
      famBirths([1950, 1960]),
      { type: "addChild", parentId: "p", child: { gender: "male", birth: { date: {} } } },
      NOW,
    );
    expect(childIds(result.doc, "u").at(-1)).toBe(result.createdIds[0]!);
  });
});

describe("addSpouse", () => {
  test("creates a married union listed by both partners", () => {
    const doc = docOf([person("a", "A", "", "male")], [], "a");
    const result = applyChecked(doc, {
      type: "addSpouse",
      personId: "a",
      spouse: { gender: "female" },
    });
    const spouseId = result.createdIds[0]!;
    expect(result.createdIds).toHaveLength(1);
    const [u] = unionsOf(result.doc, "a");
    expect(u).toMatchObject({ partners: ["a", spouseId], status: "married", children: [] });
    expect(result.doc.unionOrder[spouseId]).toEqual([u!.id]);
  });

  test("honours the requested status", () => {
    const doc = docOf([person("a", "A", "", "male")], [], "a");
    const result = applyCommand(
      doc,
      { type: "addSpouse", personId: "a", spouse: { gender: "female" }, status: "engaged" },
      NOW,
    );
    expect(unionsOf(result.doc, "a")[0]?.status).toBe("engaged");
  });

  test("fills the second slot of a single-parent union and keeps its children", () => {
    const doc = docOf(
      [person("a", "A", "", "female"), person("k", "K", "", "male")],
      [union("u", ["a"], ["k"], "partner")],
      "a",
    );
    const result = applyChecked(doc, {
      type: "addSpouse",
      personId: "a",
      spouse: { gender: "male" },
    });
    const spouseId = result.createdIds[0]!;
    expect(Object.keys(result.doc.unions)).toEqual(["u"]);
    expect(result.doc.unions["u"]).toMatchObject({
      partners: ["a", spouseId],
      status: "married",
      children: [{ personId: "k", type: "biological" }],
    });
    expect(result.doc.unionOrder[spouseId]).toEqual(["u"]);
    expect(result.doc.unionOrder["a"]).toEqual(["u"]);
  });

  test("a person with a complete union gets an additional one at the end", () => {
    const result = applyChecked(famRemarriage(), {
      type: "addSpouse",
      personId: "ali",
      spouse: { gender: "female" },
    });
    const ids = result.doc.unionOrder["ali"]!;
    expect(ids).toHaveLength(3);
    expect(ids.slice(0, 2)).toEqual(["m1", "m2"]);
    expect(result.doc.unions[ids[2]!]?.partners).toEqual(["ali", result.createdIds[0]!]);
  });

  test("unknown person is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "addSpouse", personId: "ghost", spouse: { gender: "female" } },
          NOW,
        ),
      "NOT_FOUND",
    );
  });
});

const insertWithStart = (start?: { year: number }) =>
  produce(famRemarriage(), (draft) => {
    // ali: m1 (1975), m2 (1990)
    draft.persons["x"] = person("x", "X", "", "female");
    draft.unions["new"] = { id: "new", partners: ["ali", "x"], status: "married", children: [] };
    if (start) draft.unions["new"].start = start;
    insertUnionInOrder(draft, "ali", "new");
  }).unionOrder["ali"];

describe("insertUnionInOrder", () => {
  test("goes before the first union with a later start date", () => {
    expect(insertWithStart({ year: 1980 })).toEqual(["m1", "new", "m2"]);
    expect(insertWithStart({ year: 1960 })).toEqual(["new", "m1", "m2"]);
  });

  test("goes last when nothing starts later, or when it has no start date", () => {
    expect(insertWithStart({ year: 2000 })).toEqual(["m1", "m2", "new"]);
    expect(insertWithStart()).toEqual(["m1", "m2", "new"]);
  });
});

describe("addParent", () => {
  test("a child without parents gets a single-parent union", () => {
    const doc = docOf([person("k", "K", "", "male")], [], "k");
    const result = applyChecked(doc, {
      type: "addParent",
      childId: "k",
      parent: { gender: "male", firstName: "Dad" },
    });
    const parentId = result.createdIds[0]!;
    expect(result.createdIds).toHaveLength(1);
    expect(parentUnionOf(result.doc, "k")).toMatchObject({
      partners: [parentId],
      status: "partner",
    });
    expect(result.doc.unionOrder[parentId]).toHaveLength(1);
  });

  test("a second parent joins the union and makes it married", () => {
    const doc = docOf(
      [person("k", "K", "", "male"), person("m", "M", "", "female")],
      [union("u", ["m"], ["k"], "partner")],
      undefined,
    );
    const result = applyChecked(doc, {
      type: "addParent",
      childId: "k",
      parent: { gender: "male" },
    });
    const parentId = result.createdIds[0]!;
    expect(result.doc.unions["u"]).toMatchObject({ partners: ["m", parentId], status: "married" });
    expect(result.doc.unionOrder[parentId]).toEqual(["u"]);
  });

  test("a third parent is PARENTS_FULL", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "addParent", childId: "c1", parent: { gender: "male" } },
          NOW,
        ),
      "PARENTS_FULL",
    );
  });

  test("giving the root a parent moves the root to the new parent", () => {
    const doc = docOf([person("k", "K", "", "male")], [], "k");
    const result = applyChecked(doc, {
      type: "addParent",
      childId: "k",
      parent: { gender: "male" },
    });
    expect(result.doc.rootPersonId).toBe(result.createdIds[0]!);
  });

  test("adding a second parent to the root moves it to the union's first partner", () => {
    const doc = docOf(
      [person("k", "K", "", "male"), person("m", "M", "", "female")],
      [union("u", ["m"], ["k"], "partner")],
      "k",
    );
    const result = applyCommand(
      doc,
      { type: "addParent", childId: "k", parent: { gender: "male" } },
      NOW,
    );
    expect(result.doc.rootPersonId).toBe("m");
  });

  test("a non-root child leaves the root alone", () => {
    const doc = docOf([person("r", "R", "", "male"), person("k", "K", "", "male")], [], "r");
    const result = applyCommand(
      doc,
      { type: "addParent", childId: "k", parent: { gender: "male" } },
      NOW,
    );
    expect(result.doc.rootPersonId).toBe("r");
  });

  test("a child with only an adopted parent union gets a separate biological union", () => {
    const adoptedKid = applyChecked(
      docOf(
        [person("a", "A", "", "male"), person("k", "K", "", "male")],
        [union("u", ["a"], [["k", "adopted"]], "partner")],
        "a",
      ),
      { type: "addParent", childId: "k", parent: { gender: "female" } },
    );
    expect(parentUnionOf(adoptedKid.doc, "k")?.id).not.toBe("u");
    expect(parentUnionOf(adoptedKid.doc, "k", "adopted")?.id).toBe("u");
  });

  test("unknown child is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "addParent", childId: "ghost", parent: { gender: "male" } },
          NOW,
        ),
      "NOT_FOUND",
    );
  });
});

describe("addSibling", () => {
  test("appends to the biological parent union", () => {
    const result = applyChecked(famSimple(), {
      type: "addSibling",
      personId: "c2",
      sibling: { gender: "female" },
    });
    expect(result.createdIds).toHaveLength(1);
    expect(childIds(result.doc, "u1")).toEqual(["c1", "c2", "c3", result.createdIds[0]!]);
    expect(Object.keys(result.doc.unions)).toEqual(["u1"]);
  });

  test("works for a half-sibling's union too", () => {
    const result = applyCommand(
      famHalfSiblings(),
      { type: "addSibling", personId: "k3", sibling: { gender: "male" } },
      NOW,
    );
    expect(childIds(result.doc, "u2")).toEqual(["k3", result.createdIds[0]!]);
  });

  test("a parentless root gets Unknown father and Unknown mother placeholders", () => {
    const doc = docOf([person("r", "Root", "Person", "male")], [], "r");
    const result = applyChecked(doc, {
      type: "addSibling",
      personId: "r",
      sibling: { gender: "female", firstName: "Sis" },
    });
    expect(result.createdIds).toHaveLength(3);
    const [siblingId, fatherId, motherId] = result.createdIds as [string, string, string];
    expect(result.doc.persons[fatherId]).toMatchObject({
      firstName: "",
      lastName: "",
      gender: "male",
      isPlaceholder: true,
    });
    expect(result.doc.persons[motherId]).toMatchObject({
      firstName: "",
      lastName: "",
      gender: "female",
      isPlaceholder: true,
    });
    expect(result.doc.persons[fatherId]?.isLiving).toBe(true);
    expect(result.doc.persons[motherId]?.isLiving).toBe(true);
    expect(result.doc.persons[siblingId]).toMatchObject({ firstName: "Sis" });
    expect(result.doc.persons[siblingId]?.isPlaceholder).toBeFalsy();
    expect(parentUnionOf(result.doc, "r")).toMatchObject({
      partners: [fatherId, motherId],
      children: [
        { personId: "r", type: "biological" },
        { personId: siblingId, type: "biological" },
      ],
    });
    expect(result.doc.rootPersonId).toBe(fatherId);
    expect(result.doc.unionOrder[fatherId]).toHaveLength(1);
    expect(result.doc.unionOrder[motherId]).toHaveLength(1);
  });

  test("a parentless non-root person leaves the root alone", () => {
    const doc = docOf([person("r", "R", "", "male"), person("p", "P", "", "male")], [], "r");
    const result = applyCommand(
      doc,
      { type: "addSibling", personId: "p", sibling: { gender: "female" } },
      NOW,
    );
    expect(result.doc.rootPersonId).toBe("r");
  });

  test("unknown person is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "addSibling", personId: "ghost", sibling: { gender: "male" } },
          NOW,
        ),
      "NOT_FOUND",
    );
  });
});

const reorder = (personId: string, toIndex: number) =>
  applyChecked(famSimple(), { type: "reorderChild", unionId: "u1", personId, toIndex });

describe("reorderChild", () => {
  test("moves a child within the union", () => {
    expect(childIds(reorder("c3", 0).doc, "u1")).toEqual(["c3", "c1", "c2"]);
    expect(childIds(reorder("c1", 1).doc, "u1")).toEqual(["c2", "c1", "c3"]);
    expect(childIds(reorder("c2", 1).doc, "u1")).toEqual(["c1", "c2", "c3"]);
  });

  test("clamps toIndex to the valid range", () => {
    expect(childIds(reorder("c1", 99).doc, "u1")).toEqual(["c2", "c3", "c1"]);
    expect(childIds(reorder("c3", -5).doc, "u1")).toEqual(["c3", "c1", "c2"]);
  });

  test("keeps link types", () => {
    const doc = famAdoption();
    const result = applyCommand(
      doc,
      { type: "reorderChild", unionId: "ua", personId: "k2", toIndex: 0 },
      NOW,
    );
    expect(result.doc.unions["ua"]?.children).toEqual([
      { personId: "k2", type: "adopted" },
      { personId: "k1", type: "biological" },
    ]);
  });

  test("a person who is not a child of the union is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "reorderChild", unionId: "u1", personId: "dad", toIndex: 0 },
          NOW,
        ),
      "NOT_FOUND",
    );
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "reorderChild", unionId: "ghost", personId: "c1", toIndex: 0 },
          NOW,
        ),
      "NOT_FOUND",
    );
  });

  test("a non-numeric toIndex is INVALID", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "reorderChild", unionId: "u1", personId: "c1", toIndex: Number.NaN },
          NOW,
        ),
      "INVALID",
    );
  });
});

describe("setChildType", () => {
  test("changes the link type", () => {
    const result = applyChecked(famSimple(), {
      type: "setChildType",
      unionId: "u1",
      personId: "c1",
      childType: "step",
    });
    expect(result.doc.unions["u1"]?.children[0]).toEqual({ personId: "c1", type: "step" });
  });

  test("becoming biological while biological elsewhere is INVALID", () => {
    expectCode(
      () =>
        applyCommand(
          famAdoption(),
          { type: "setChildType", unionId: "ua", personId: "k2", childType: "biological" },
          NOW,
        ),
      "INVALID",
    );
  });

  test("becoming biological with no other biological parents is fine", () => {
    const doc = docOf(
      [person("a", "A", "", "male"), person("k", "K", "", "male")],
      [union("u", ["a"], [["k", "adopted"]], "partner")],
      "a",
    );
    const result = applyChecked(doc, {
      type: "setChildType",
      unionId: "u",
      personId: "k",
      childType: "biological",
    });
    expect(parentUnionOf(result.doc, "k")?.id).toBe("u");
  });

  test("setting the type a child already has is a no-op change", () => {
    const result = applyCommand(
      famSimple(),
      { type: "setChildType", unionId: "u1", personId: "c1", childType: "biological" },
      NOW,
    );
    expect(result.doc.unions["u1"]).toEqual(famSimple().unions["u1"]!);
  });

  test("a person who is not a child of the union is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "setChildType", unionId: "u1", personId: "dad", childType: "step" },
          NOW,
        ),
      "NOT_FOUND",
    );
  });
});
