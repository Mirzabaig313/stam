import { describe, expect, test } from "bun:test";

import { CommandError } from "@/core/commands/errors";
import { validate } from "@/core/model/validate";
import { isIndexKey } from "@/io/json/parseTree";
import { applyRevert } from "@/sync/revert";
import { prepareForUpload } from "@/sync/upload";
import { decodeCommand } from "@/sync/wire";

import { docOf, famSimple, person, union } from "../fixtures/families";

const LATER = new Date("2026-06-01T00:00:00.000Z");

describe("ids shared trees may use", () => {
  test("array-index keys are recognised", () => {
    for (const k of ["0", "7", "123", "4294967294"]) expect(isIndexKey(k)).toBe(true);
    for (const k of ["07", "-1", "4294967295", "12345678901", "a7", "I7", ""])
      expect(isIndexKey(k)).toBe(false);
  });

  test("commands naming an index-shaped id are refused", () => {
    expect(() => decodeCommand({ type: "setRoot", personId: "7" })).toThrow(CommandError);
  });

  test("prepareForUpload re-ids index-shaped persons and unions everywhere", () => {
    const doc = docOf(
      [
        person("7", "Seven", "", "male"),
        person("b", "B", "", "female"),
        person("12", "Kid", "", "male"),
      ],
      [union("3", ["7", "b"], ["12"])],
      "7",
    );
    const out = prepareForUpload(doc);
    const ids = [
      ...Object.keys(out.persons),
      ...Object.keys(out.unions),
      ...Object.keys(out.unionOrder),
    ];
    expect(ids.some(isIndexKey)).toBe(false);
    expect(validate(out)).toEqual([]);
    expect(Object.keys(out.persons)).toHaveLength(3);
    expect(out.persons[out.rootPersonId!]!.firstName).toBe("Seven");
    expect(out.persons["b"]).toEqual(doc.persons["b"]!);
    const u = Object.values(out.unions)[0]!;
    expect(out.persons[u.children[0]!.personId]!.firstName).toBe("Kid");
  });

  test("prepareForUpload keeps a tree without index ids as it is, and makes strings well-formed", () => {
    const doc = famSimple();
    expect(prepareForUpload(doc)).toEqual(doc);
    const id = Object.keys(doc.persons)[0]!;
    const broken = {
      ...doc,
      persons: { ...doc.persons, [id]: { ...doc.persons[id]!, notes: "bad \ud800 end" } },
    };
    expect(prepareForUpload(broken).persons[id]!.notes).toBe("bad � end");
  });
});

describe("revert entries", () => {
  test("an empty revert is refused", () => {
    expect(() => applyRevert(famSimple(), [], "undo", LATER)).toThrow(CommandError);
  });

  test("a key listed twice is refused", () => {
    const doc = famSimple();
    const id = Object.keys(doc.persons)[0]!;
    const p = doc.persons[id]!;
    const entries = [
      { key: `persons/${id}` as const, before: p, after: p },
      { key: `persons/${id}` as const, before: p, after: p },
    ];
    expect(() => applyRevert(doc, entries, "undo", LATER)).toThrow(CommandError);
  });
});
