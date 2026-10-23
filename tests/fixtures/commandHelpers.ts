import { expect } from "bun:test";

import { applyPatches } from "immer";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import type { Command } from "@/core/commands/types";
import type { TreeDocument } from "@/core/model/types";

export const NOW = new Date("2026-05-06T07:08:09.000Z");

export function expectCode(fn: () => unknown, code: CommandError["code"]): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CommandError);
    expect((e as CommandError).code).toBe(code);
    return;
  }
  throw new Error(`expected CommandError ${code}, nothing was thrown`);
}

/** Applies the command and checks that patches replay it and inverse patches undo it. */
export function applyChecked(doc: TreeDocument, cmd: Command) {
  const snapshot = structuredClone(doc);
  const result = applyCommand(doc, cmd, NOW);
  expect(doc).toEqual(snapshot);
  expect(applyPatches(doc, result.patches)).toEqual(result.doc);
  expect(applyPatches(result.doc, result.inversePatches)).toEqual(snapshot);
  return result;
}
