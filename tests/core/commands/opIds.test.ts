import { describe, expect, test } from "bun:test";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import { isOpId, opIdSource } from "@/core/commands/opIds";
import type { Command } from "@/core/commands/types";
import { createTree } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import { NOW } from "../../fixtures/commandHelpers";
import { docOf, person, union } from "../../fixtures/families";

function oneRoot(): TreeDocument {
  return applyCommand(
    createTree("T", NOW),
    {
      type: "addPerson",
      person: { gender: "male", firstName: "Root" },
    },
    { now: NOW, opId: "rootrootro" },
  ).doc;
}

describe("op-derived ids", () => {
  test("an opId gives the same ids on every run", () => {
    const doc = oneRoot();
    const cmd: Command = {
      type: "addSibling",
      personId: doc.rootPersonId!,
      sibling: { gender: "female" },
    };
    const a = applyCommand(doc, cmd, { now: NOW, opId: "abcdefghij" });
    const b = applyCommand(doc, cmd, { now: NOW, opId: "abcdefghij" });
    expect(a.createdIds).toEqual(["abcdefghijAA", "abcdefghijAB", "abcdefghijAC"]);
    expect(Object.keys(a.doc.unions)).toEqual(["abcdefghijAD"]);
    expect(a.doc).toEqual(b.doc);
  });

  test("opIdSource counts through 4096 ids and then throws", () => {
    const next = opIdSource("abcdefghij");
    const ids = Array.from({ length: 4096 }, () => next());
    expect(ids[0]).toBe("abcdefghijAA");
    expect(ids[62]).toBe("abcdefghijA-");
    expect(ids[63]).toBe("abcdefghijA_");
    expect(ids[64]).toBe("abcdefghijBA");
    expect(new Set(ids).size).toBe(4096);
    expect(() => next()).toThrow(CommandError);
  });

  test("isOpId accepts exactly ten id characters", () => {
    expect(isOpId("abcdefghij")).toBe(true);
    expect(isOpId("ABC_-12345")).toBe(true);
    expect(isOpId("short")).toBe(false);
    expect(isOpId("abcdefghijk")).toBe(false);
    expect(isOpId("abcdefgh/j")).toBe(false);
  });

  test("applyCommand rejects a malformed opId", () => {
    const doc = oneRoot();
    expect(() =>
      applyCommand(doc, { type: "renameTree", name: "X" }, { now: NOW, opId: "short" }),
    ).toThrow(CommandError);
  });

  test("without an opId, ids stay random", () => {
    const doc = oneRoot();
    const cmd: Command = { type: "addPerson", person: { gender: "male" } };
    const a = applyCommand(doc, cmd, { now: NOW });
    const b = applyCommand(doc, cmd, { now: NOW });
    expect(a.createdIds[0]).not.toBe(b.createdIds[0]);
  });

  test("now sets updatedAt", () => {
    const later = new Date("2030-01-02T03:04:05.006Z");
    const result = applyCommand(oneRoot(), { type: "renameTree", name: "Y" }, { now: later });
    expect(result.doc.updatedAt).toBe("2030-01-02T03:04:05.006Z");
  });
});

describe("updateUnion compares start dates by value", () => {
  test("an equal start in another key order keeps the union order", () => {
    const doc = docOf(
      [
        person("a", "A", "", "male"),
        person("b", "B", "", "female"),
        person("c", "C", "", "female"),
      ],
      [
        union("u1", ["a", "b"], [], "married", { start: { year: 1990, month: 1 } }),
        union("u2", ["a", "c"], [], "married", { start: { year: 1990, month: 1 } }),
      ],
      "a",
    );
    const result = applyCommand(
      doc,
      { type: "updateUnion", unionId: "u1", patch: { start: { month: 1, year: 1990 } } },
      { now: NOW },
    );
    expect(result.doc.unionOrder["a"]).toEqual(["u1", "u2"]);
  });
});
