import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import { createTree, displayName } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import { applyChecked, expectCode, NOW } from "../../fixtures/commandHelpers";
import { docOf, famSimple, person, union } from "../../fixtures/families";

const expectInverseRestores = applyChecked;

describe("addPerson", () => {
  test("on an empty tree creates one person and makes it root", () => {
    const doc = createTree("T", NOW);
    const result = applyCommand(doc, { type: "addPerson", person: { gender: "male" } }, NOW);
    const ids = Object.keys(result.doc.persons);
    expect(ids).toHaveLength(1);
    expect(result.createdIds).toEqual(ids);
    expect(result.doc.rootPersonId).toBe(ids[0]!);
    expect(result.doc.persons[ids[0]!]).toMatchObject({
      id: ids[0]!,
      firstName: "",
      lastName: "",
      gender: "male",
      isLiving: true,
    });
  });

  test("keeps the provided fields", () => {
    const result = applyCommand(
      createTree("T", NOW),
      {
        type: "addPerson",
        person: {
          gender: "female",
          firstName: "Sara",
          lastName: "Khan",
          isLiving: false,
          birth: { date: { year: 1950 } },
        },
      },
      NOW,
    );
    const p = result.doc.persons[result.createdIds[0]!]!;
    expect(p).toMatchObject({ firstName: "Sara", lastName: "Khan", isLiving: false });
    expect(p.birth).toEqual({ date: { year: 1950 } });
  });

  test("undefined required fields fall back to their defaults", () => {
    const result = applyCommand(
      createTree("T", NOW),
      {
        type: "addPerson",
        person: { gender: "male", firstName: undefined, lastName: undefined, isLiving: undefined },
      },
      NOW,
    );
    const p = result.doc.persons[result.createdIds[0]!]!;
    expect(p).toMatchObject({ firstName: "", lastName: "", isLiving: true, gender: "male" });
    expect(displayName(p)).toBe("");
  });

  test("a second person leaves the root unchanged", () => {
    const first = applyCommand(
      createTree("T", NOW),
      { type: "addPerson", person: { gender: "male" } },
      NOW,
    );
    const second = applyCommand(
      first.doc,
      { type: "addPerson", person: { gender: "female" } },
      NOW,
    );
    expect(Object.keys(second.doc.persons)).toHaveLength(2);
    expect(second.doc.rootPersonId).toBe(first.createdIds[0]!);
    expect(second.createdIds).toHaveLength(1);
    expect(second.createdIds[0]).not.toBe(first.createdIds[0]!);
  });

  test("inverse patches restore the document", () => {
    expectInverseRestores(createTree("T", NOW), { type: "addPerson", person: { gender: "male" } });
    expectInverseRestores(famSimple(), { type: "addPerson", person: { gender: "female" } });
  });
});

describe("updatePerson", () => {
  test("changes the given fields only", () => {
    const result = expectInverseRestores(famSimple(), {
      type: "updatePerson",
      personId: "c1",
      patch: { nickname: "Ally", death: { date: { year: 2020 } }, isLiving: false },
    });
    expect(result.doc.persons["c1"]).toMatchObject({
      firstName: "Ali",
      nickname: "Ally",
      isLiving: false,
    });
  });

  test("an undefined value removes the field", () => {
    const doc = famSimple();
    doc.persons["c1"] = { ...doc.persons["c1"]!, nickname: "Ally" };
    const result = expectInverseRestores(doc, {
      type: "updatePerson",
      personId: "c1",
      patch: { nickname: undefined },
    });
    expect("nickname" in result.doc.persons["c1"]!).toBe(false);
  });

  test("an undefined value never removes a required field", () => {
    const result = applyChecked(famSimple(), {
      type: "updatePerson",
      personId: "c1",
      patch: { firstName: undefined, lastName: undefined, gender: undefined, isLiving: undefined },
    });
    expect(result.doc.persons["c1"]).toEqual(famSimple().persons["c1"]!);
    expect(displayName(result.doc.persons["c1"]!)).toBe("Ali Khan");
  });

  test("an undefined optional value is removed while required ones in the same patch apply", () => {
    const doc = famSimple();
    doc.persons["c1"] = { ...doc.persons["c1"]!, notes: "x", nickname: "Ally" };
    const result = applyCommand(
      doc,
      {
        type: "updatePerson",
        personId: "c1",
        patch: { notes: undefined, nickname: undefined, firstName: "Alee", lastName: undefined },
      },
      NOW,
    );
    const p = result.doc.persons["c1"]!;
    expect("notes" in p || "nickname" in p).toBe(false);
    expect(p).toMatchObject({ firstName: "Alee", lastName: "Khan" });
  });

  test("never changes the id", () => {
    const result = applyCommand(
      famSimple(),
      {
        type: "updatePerson",
        personId: "c1",
        patch: { id: "hacked", firstName: "X" } as never,
      },
      NOW,
    );
    expect(result.doc.persons["c1"]?.id).toBe("c1");
    expect(result.doc.persons["hacked"]).toBeUndefined();
  });

  test("editing a placeholder's name clears isPlaceholder", () => {
    const doc = famSimple();
    doc.persons["c1"] = person("c1", "", "", "male", { isPlaceholder: true });
    const result = expectInverseRestores(doc, {
      type: "updatePerson",
      personId: "c1",
      patch: { firstName: "Hamid" },
    });
    expect(result.doc.persons["c1"]?.firstName).toBe("Hamid");
    expect(result.doc.persons["c1"]?.isPlaceholder).toBeFalsy();
  });

  test("editing only the last name also clears isPlaceholder", () => {
    const doc = famSimple();
    doc.persons["c1"] = person("c1", "", "", "male", { isPlaceholder: true });
    const result = applyCommand(
      doc,
      { type: "updatePerson", personId: "c1", patch: { lastName: "Khan" } },
      NOW,
    );
    expect(result.doc.persons["c1"]?.isPlaceholder).toBeFalsy();
  });

  test("a blank name or an unrelated field keeps the placeholder", () => {
    const doc = famSimple();
    doc.persons["c1"] = person("c1", "", "", "male", { isPlaceholder: true });
    const blank = applyCommand(
      doc,
      { type: "updatePerson", personId: "c1", patch: { firstName: "  " } },
      NOW,
    );
    expect(blank.doc.persons["c1"]?.isPlaceholder).toBe(true);
    const notes = applyCommand(
      doc,
      { type: "updatePerson", personId: "c1", patch: { notes: "hello" } },
      NOW,
    );
    expect(notes.doc.persons["c1"]?.isPlaceholder).toBe(true);
  });

  test("unknown person is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "updatePerson", personId: "ghost", patch: { firstName: "X" } },
          NOW,
        ),
      "NOT_FOUND",
    );
  });
});

// a: u1 (1990, with b), u2 (2000, with c).  b: u1, u3 (1995, with d).
const twoSided = () =>
  docOf(
    [
      person("a", "A", "", "male"),
      person("b", "B", "", "female"),
      person("c", "C", "", "female"),
      person("d", "D", "", "male"),
    ],
    [
      union("u1", ["a", "b"], [], "married", { start: { year: 1990 } }),
      union("u2", ["a", "c"], [], "married", { start: { year: 2000 } }),
      union("u3", ["d", "b"], [], "married", { start: { year: 1995 } }),
    ],
    "a",
  );
const setStart = (doc: TreeDocument, unionId: string, start: { year: number } | undefined) =>
  applyChecked(doc, { type: "updateUnion", unionId, patch: { start } }).doc;

describe("updateUnion", () => {
  test("changes status, start and end", () => {
    const result = expectInverseRestores(famSimple(), {
      type: "updateUnion",
      unionId: "u1",
      patch: { status: "divorced", start: { year: 1975 }, end: { year: 1999 } },
    });
    expect(result.doc.unions["u1"]).toMatchObject({
      status: "divorced",
      start: { year: 1975 },
      end: { year: 1999 },
    });
    expect(result.doc.unions["u1"]?.children).toHaveLength(3);
  });

  test("an undefined date removes it", () => {
    const doc = famSimple();
    doc.unions["u1"] = { ...doc.unions["u1"]!, start: { year: 1975 } };
    const result = applyCommand(
      doc,
      { type: "updateUnion", unionId: "u1", patch: { start: undefined } },
      NOW,
    );
    expect("start" in result.doc.unions["u1"]!).toBe(false);
  });

  describe("FR-R9: union order follows the start date", () => {
    test("a later start moves the union after later-dated ones, in both partners' orders", () => {
      const doc = setStart(twoSided(), "u1", { year: 2010 });
      expect(doc.unionOrder["a"]).toEqual(["u2", "u1"]);
      expect(doc.unionOrder["b"]).toEqual(["u3", "u1"]);
    });

    test("an earlier start moves the union before the earlier-dated ones", () => {
      const start = twoSided();
      start.unionOrder["a"] = ["u2", "u1"];
      start.unionOrder["b"] = ["u3", "u1"];
      const doc = setStart(start, "u1", { year: 1980 });
      // moved before the first union that starts later
      expect(doc.unionOrder["a"]).toEqual(["u1", "u2"]);
      expect(doc.unionOrder["b"]).toEqual(["u1", "u3"]);
    });

    test("removing the start date moves the union last", () => {
      const doc = setStart(twoSided(), "u1", undefined);
      expect(doc.unionOrder["a"]).toEqual(["u2", "u1"]);
      expect(doc.unionOrder["b"]).toEqual(["u3", "u1"]);
    });

    test("an unchanged start, or no start in the patch, keeps the order (stable)", () => {
      const tied = twoSided();
      tied.unions["u2"] = { ...tied.unions["u2"]!, start: { year: 1990 } };
      expect(setStart(tied, "u1", { year: 1990 }).unionOrder["a"]).toEqual(["u1", "u2"]);
      expect(setStart(tied, "u2", { year: 1990 }).unionOrder["a"]).toEqual(["u1", "u2"]);
      const status = applyCommand(
        twoSided(),
        { type: "updateUnion", unionId: "u1", patch: { status: "divorced" } },
        NOW,
      );
      expect(status.doc.unionOrder).toEqual(twoSided().unionOrder);
    });

    test("a single-partner union is re-sorted too", () => {
      const doc = docOf(
        [person("a", "A", "", "male")],
        [
          union("x", ["a"], [], "partner", { start: { year: 1990 } }),
          union("y", ["a"], [], "partner", { start: { year: 2000 } }),
        ],
        "a",
      );
      expect(setStart(doc, "x", { year: 2005 }).unionOrder["a"]).toEqual(["y", "x"]);
    });
  });

  test("unknown union is NOT_FOUND", () => {
    expectCode(
      () =>
        applyCommand(
          famSimple(),
          { type: "updateUnion", unionId: "ghost", patch: { status: "partner" } },
          NOW,
        ),
      "NOT_FOUND",
    );
  });
});

describe("setRoot", () => {
  test("changes the root", () => {
    const result = expectInverseRestores(famSimple(), { type: "setRoot", personId: "c2" });
    expect(result.doc.rootPersonId).toBe("c2");
  });

  test("unknown person is NOT_FOUND", () => {
    expectCode(
      () => applyCommand(famSimple(), { type: "setRoot", personId: "ghost" }, NOW),
      "NOT_FOUND",
    );
  });
});

describe("renameTree", () => {
  test("trims the name", () => {
    const result = expectInverseRestores(famSimple(), { type: "renameTree", name: "  The Khans " });
    expect(result.doc.name).toBe("The Khans");
  });

  test("rejects an empty name", () => {
    expectCode(
      () => applyCommand(famSimple(), { type: "renameTree", name: "   " }, NOW),
      "INVALID",
    );
  });
});

describe("pipeline", () => {
  test("sets updatedAt and never touches createdAt", () => {
    const result = applyCommand(famSimple(), { type: "setRoot", personId: "c2" }, NOW);
    expect(result.doc.updatedAt).toBe("2026-05-06T07:08:09.000Z");
    expect(result.doc.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("the result is frozen and the input is not mutated", () => {
    const doc = famSimple();
    const snapshot = structuredClone(doc);
    const result = applyCommand(doc, { type: "setRoot", personId: "c2" }, NOW);
    expect(Object.isFrozen(result.doc)).toBe(true);
    expect(Object.isFrozen(result.doc.persons)).toBe(true);
    expect(doc).toEqual(snapshot);
  });

  test("a frozen input document is accepted", () => {
    const first = applyCommand(famSimple(), { type: "setRoot", personId: "c2" }, NOW);
    const second = applyCommand(first.doc, { type: "setRoot", personId: "c3" }, NOW);
    expect(second.doc.rootPersonId).toBe("c3");
    expect(first.doc.rootPersonId).toBe("c2");
  });

  test("a failing command leaves no trace", () => {
    const doc = famSimple();
    const snapshot = structuredClone(doc);
    expectCode(() => applyCommand(doc, { type: "setRoot", personId: "ghost" }, NOW), "NOT_FOUND");
    expect(doc).toEqual(snapshot);
  });

  test("CommandError carries its code and message", () => {
    const e = new CommandError("INVALID", "nope");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("CommandError");
    expect(e.code).toBe("INVALID");
    expect(e.message).toBe("nope");
  });

  test("the validity guard rejects a command that leaves an invalid document", () => {
    const doc = famSimple();
    doc.rootPersonId = "ghost"; // already broken before the command runs
    try {
      applyCommand(doc, { type: "renameTree", name: "X" }, NOW);
      throw new Error("expected the guard to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CommandError);
      expect((e as CommandError).code).toBe("INVALID");
      expect((e as CommandError).issues?.[0]?.code).toBe("BAD_ROOT");
    }
  });

  test("the guard also runs in production builds (I5)", () => {
    const doc = famSimple();
    doc.rootPersonId = "ghost";
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expectCode(() => applyCommand(doc, { type: "renameTree", name: "X" }, NOW), "INVALID");
    } finally {
      process.env.NODE_ENV = before;
    }
  });

  test("the production build keeps the guard", () => {
    // The bundler folds `process.env.NODE_ENV` to "production"; nothing may hang the check on it.
    const source = readFileSync("src/core/commands/apply.ts", "utf8");
    expect(source).not.toContain("NODE_ENV");
  });

  test("an unknown command type is rejected, not ignored", () => {
    expectCode(() => applyCommand(famSimple(), { type: "bogus" } as never, NOW), "INVALID");
  });
});
