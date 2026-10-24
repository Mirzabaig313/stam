import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import type { Command } from "@/core/commands/types";
import { decodeCommand, encodeCommand } from "@/sync/wire";

import { ALL_KINDS, arbOp, buildFamily, resolveOp, runs } from "../fixtures/arbitraries";
import { NOW } from "../fixtures/commandHelpers";
import { famSimple } from "../fixtures/families";

const viaJson = (cmd: Command) => JSON.parse(JSON.stringify(encodeCommand(cmd)));

describe("command wire encoding", () => {
  test("encode then decode returns the same command, removals included", () => {
    const doc = famSimple();
    const personId = Object.keys(doc.persons)[0]!;
    const cmd: Command = {
      type: "updatePerson",
      personId,
      patch: { nickname: undefined, notes: undefined, firstName: "A" },
    };
    const wire = viaJson(cmd);
    expect(wire.patch).toEqual({ nickname: null, notes: null, firstName: "A" });
    expect(applyCommand(doc, decodeCommand(wire), NOW).doc).toEqual(
      applyCommand(doc, cmd, NOW).doc,
    );
  });

  test("an updateUnion date removal travels as null", () => {
    const wire = viaJson({ type: "updateUnion", unionId: "u1", patch: { start: undefined } });
    expect(wire.patch).toEqual({ start: null });
    const back = decodeCommand(wire);
    expect(back.type === "updateUnion" && "start" in back.patch).toBe(true);
  });

  test("every generated command survives the round trip", () => {
    fc.assert(
      fc.property(fc.array(arbOp(ALL_KINDS), { maxLength: 30 }), arbOp(ALL_KINDS), (ops, op) => {
        const doc = buildFamily(ops);
        const cmd = resolveOp(doc, op);
        if (!cmd) return;
        const back = decodeCommand(viaJson(cmd));
        expect(encodeCommand(back)).toEqual(encodeCommand(cmd));
      }),
      { numRuns: runs() },
    );
  });

  test.each([
    ["an unknown type", { type: "explode" }],
    ["a bad id", { type: "setRoot", personId: "a/b" }],
    ["a missing id", { type: "setRoot" }],
    [
      "a non-integer year",
      { type: "addPerson", person: { gender: "male", birth: { date: { year: 1990.5 } } } },
    ],
    ["a bad gender", { type: "addPerson", person: { gender: "other" } }],
    [
      "a bad child type",
      { type: "addChild", parentId: "p", child: { gender: "male" }, childType: "x" },
    ],
    ["a non-number index", { type: "reorderChild", unionId: "u", personId: "p", toIndex: "1" }],
    ["a non-object", 7],
  ])("decodeCommand refuses %s", (_name, raw) => {
    expect(() => decodeCommand(raw)).toThrow(CommandError);
  });

  test("decodeCommand drops unknown fields and treats null optionals as absent", () => {
    const cmd = decodeCommand({
      type: "addChild",
      parentId: "p",
      unionId: null,
      child: { gender: "male", id: "sneaky", extra: 1 },
      extra: true,
    });
    expect(cmd).toEqual({ type: "addChild", parentId: "p", child: { gender: "male" } });
  });
});
