import type { Draft } from "immer";

import { parentUnionOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import { CommandError } from "./errors";
import { requirePerson } from "./lookup";
import { linkChild, linkParent, linkSpouse, moveRootUp } from "./relations";
import type { Handler } from "./types";
import { type DropAction, dropBlocker } from "./validActions";

/** Same rules the drop menu uses, so a command can never do what the menu would not offer. */
function assertDropAllowed(
  doc: Draft<TreeDocument>,
  action: DropAction,
  draggedId: string,
  targetId: string,
): void {
  requirePerson(doc, draggedId);
  requirePerson(doc, targetId);
  const blocker = dropBlocker(doc, action, draggedId, targetId);
  if (blocker) {
    throw new CommandError(blocker, `${draggedId} cannot be made ${action} of ${targetId}`);
  }
}

export const relinkAsChild: Handler<"relinkAsChild"> = (doc, cmd, ctx) => {
  assertDropAllowed(doc, "child", cmd.personId, cmd.parentId);
  // Only the biological link moves; adopted, step and foster links stay where they are.
  const old = parentUnionOf(doc, cmd.personId);
  if (old) {
    const index = old.children.findIndex(
      (c) => c.personId === cmd.personId && c.type === "biological",
    );
    old.children.splice(index, 1);
  }
  const union = linkChild(doc, cmd.parentId, cmd.unionId, cmd.personId, "biological", ctx.newId);
  moveRootUp(doc, cmd.personId, union);
};

export const relinkAsSpouse: Handler<"relinkAsSpouse"> = (doc, cmd, ctx) => {
  assertDropAllowed(doc, "spouse", cmd.personId, cmd.targetId);
  linkSpouse(doc, cmd.targetId, cmd.personId, "married", false, ctx.newId);
};

export const relinkAsParent: Handler<"relinkAsParent"> = (doc, cmd, ctx) => {
  assertDropAllowed(doc, "parent", cmd.personId, cmd.childId);
  linkParent(doc, cmd.childId, cmd.personId, ctx.newId);
};
