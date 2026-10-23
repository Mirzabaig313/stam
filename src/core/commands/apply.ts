import { enablePatches, produceWithPatches } from "immer";
import type { Draft } from "immer";

import type { TreeDocument } from "@/core/model/types";
import { validate } from "@/core/model/validate";

import { CommandError } from "./errors";
import { addPerson, renameTree, setRoot, updatePerson, updateUnion } from "./people";
import {
  addChild,
  addParent,
  addSibling,
  addSpouse,
  insertParent,
  reorderChild,
  setChildType,
} from "./relations";
import { relinkAsChild, relinkAsParent, relinkAsSpouse } from "./relink";
import { deletePerson } from "./remove";
import type { Command, CommandResult, HandlerContext } from "./types";

enablePatches();

function dispatch(draft: Draft<TreeDocument>, cmd: Command, ctx: HandlerContext): void {
  switch (cmd.type) {
    case "addPerson":
      return addPerson(draft, cmd, ctx);
    case "updatePerson":
      return updatePerson(draft, cmd, ctx);
    case "updateUnion":
      return updateUnion(draft, cmd, ctx);
    case "setRoot":
      return setRoot(draft, cmd, ctx);
    case "renameTree":
      return renameTree(draft, cmd, ctx);
    case "addChild":
      return addChild(draft, cmd, ctx);
    case "addSpouse":
      return addSpouse(draft, cmd, ctx);
    case "addParent":
      return addParent(draft, cmd, ctx);
    case "insertParent":
      return insertParent(draft, cmd, ctx);
    case "addSibling":
      return addSibling(draft, cmd, ctx);
    case "reorderChild":
      return reorderChild(draft, cmd, ctx);
    case "setChildType":
      return setChildType(draft, cmd, ctx);
    case "relinkAsChild":
      return relinkAsChild(draft, cmd, ctx);
    case "relinkAsSpouse":
      return relinkAsSpouse(draft, cmd, ctx);
    case "relinkAsParent":
      return relinkAsParent(draft, cmd, ctx);
    case "deletePerson":
      return deletePerson(draft, cmd, ctx);
    default:
      throw new CommandError("INVALID", `Unknown command ${(cmd as { type: string }).type}`);
  }
}

/**
 * The single way to change a TreeDocument. Returns the new frozen document plus the immer
 * patches that redo and undo the change. Throws CommandError and leaves `doc` untouched, also
 * when the result would fail `validate` (code INVALID).
 */
export function applyCommand(
  doc: TreeDocument,
  cmd: Command,
  now: Date = new Date(),
): CommandResult {
  const ctx: HandlerContext = { created: [] };
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    dispatch(draft, cmd, ctx);
    draft.updatedAt = now.toISOString();
  });

  // Always on, production too (about 2.5 ms at 5,000 people): a command that would leave a broken
  // tree is refused rather than saved.
  const issues = validate(next);
  if (issues.length > 0) {
    throw new CommandError(
      "INVALID",
      `${cmd.type} left an invalid document: ${issues.map((i) => i.message).join("; ")}`,
      issues,
    );
  }

  return { doc: next, patches, inversePatches, createdIds: ctx.created };
}
