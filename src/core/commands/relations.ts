import type { Draft } from "immer";

import { compareFuzzyDate } from "@/core/dates/fuzzy";
import { newId } from "@/core/model/ids";
import { parentUnionOf, unionsOf } from "@/core/model/tree";
import type { ChildType, PersonInput, TreeDocument, Union, UnionStatus } from "@/core/model/types";

import { CommandError } from "./errors";
import { requirePerson, requireUnion } from "./lookup";
import { buildPerson } from "./people";
import type { Handler, HandlerContext } from "./types";
import { datedYear, insertUnionInOrder } from "./unionOrder";
import { parentCanJoin, unionAcceptsChild } from "./validActions";

type Doc = Draft<TreeDocument>;

// The helpers below are shared with relink.ts, which links people that already exist.

export function createUnion(
  doc: Doc,
  partners: [string] | [string, string],
  status: UnionStatus,
  children: Union["children"] = [],
): Draft<Union> {
  const id = newId();
  doc.unions[id] = { id, partners, status, children };
  for (const partnerId of partners) insertUnionInOrder(doc, partnerId, id);
  return doc.unions[id]!;
}

/** FR-R8: before the first sibling born later; undated children go last. */
function childInsertIndex(doc: Doc, union: Draft<Union>, childId: string): number {
  const born = datedYear(doc.persons[childId]?.birth?.date);
  if (!born) return union.children.length;
  const later = union.children.findIndex((c) => {
    const other = datedYear(doc.persons[c.personId]?.birth?.date);
    return other !== undefined && compareFuzzyDate(other, born) > 0;
  });
  return later < 0 ? union.children.length : later;
}

function resolveParentUnion(doc: Doc, parentId: string, unionId?: string): Draft<Union> {
  if (unionId !== undefined) {
    const union = requireUnion(doc, unionId);
    if (!(union.partners as string[]).includes(parentId)) {
      throw new CommandError("INVALID", `Union ${unionId} does not include ${parentId}`);
    }
    return union;
  }
  const unions = unionsOf(doc, parentId) as Draft<Union>[];
  if (unions.length === 0) return createUnion(doc, [parentId], "partner");
  if (unions.length === 1) return unions[0]!;
  throw new CommandError("AMBIGUOUS_UNION", `${parentId} has several unions: choose one`);
}

/** Makes an existing person a child of `parentId` (in `unionId`, or the only/new union). */
export function linkChild(
  doc: Doc,
  parentId: string,
  unionId: string | undefined,
  childId: string,
  type: ChildType = "biological",
): Draft<Union> {
  requirePerson(doc, parentId);
  requirePerson(doc, childId);
  const union = resolveParentUnion(doc, parentId, unionId);
  // Every partner of the union becomes a parent, so none may be the child or descend from it.
  if (!unionAcceptsChild(doc, union.partners, childId)) {
    throw new CommandError("CYCLE", "A person cannot be a child of their own descendant");
  }
  if (union.children.some((c) => c.personId === childId)) {
    throw new CommandError("ALREADY_LINKED", `${childId} is already a child of this union`);
  }
  if (type === "biological" && parentUnionOf(doc, childId)) {
    throw new CommandError("INVALID", `${childId} already has biological parents`);
  }
  union.children.splice(childInsertIndex(doc, union, childId), 0, { personId: childId, type });
  return union;
}

export function linkSpouse(
  doc: Doc,
  personId: string,
  spouseId: string,
  status: UnionStatus,
  fillSingleParentUnion: boolean,
): void {
  const single = fillSingleParentUnion
    ? (unionsOf(doc, personId) as Draft<Union>[]).find((u) => u.partners.length === 1)
    : undefined;
  if (single) {
    single.partners = [personId, spouseId];
    single.status = status;
    insertUnionInOrder(doc, spouseId, single.id);
  } else {
    createUnion(doc, [personId, spouseId], status);
  }
}

/** Root stays on top (clarification 2): the root moves to the new parent union's first partner. */
export function moveRootUp(doc: Doc, childId: string, union: Draft<Union>): void {
  if (doc.rootPersonId === childId) doc.rootPersonId = union.partners[0];
}

/** Makes an existing person a biological parent of `childId`. */
export function linkParent(doc: Doc, childId: string, parentId: string): void {
  requirePerson(doc, childId);
  requirePerson(doc, parentId);
  if (!parentCanJoin(doc, childId, parentId)) {
    throw new CommandError("CYCLE", "A person cannot be a parent of their own ancestor");
  }
  let union = parentUnionOf(doc, childId) as Draft<Union> | undefined;
  if (!union) {
    union = createUnion(doc, [parentId], "partner", [{ personId: childId, type: "biological" }]);
  } else {
    if ((union.partners as string[]).includes(parentId)) {
      throw new CommandError("ALREADY_LINKED", `${parentId} is already a parent of ${childId}`);
    }
    if (union.partners.length >= 2) {
      throw new CommandError("PARENTS_FULL", `${childId} already has two biological parents`);
    }
    union.partners = [union.partners[0]!, parentId];
    union.status = "married";
    insertUnionInOrder(doc, parentId, union.id);
  }
  moveRootUp(doc, childId, union);
}

function addNewPerson(doc: Doc, input: PersonInput, ctx: HandlerContext): string {
  const person = buildPerson(input);
  doc.persons[person.id] = person;
  ctx.created.push(person.id);
  return person.id;
}

export const addChild: Handler<"addChild"> = (doc, cmd, ctx) => {
  requirePerson(doc, cmd.parentId);
  const childId = addNewPerson(doc, cmd.child, ctx);
  linkChild(doc, cmd.parentId, cmd.unionId, childId, cmd.childType ?? "biological");
};

export const addSpouse: Handler<"addSpouse"> = (doc, cmd, ctx) => {
  requirePerson(doc, cmd.personId);
  const spouseId = addNewPerson(doc, cmd.spouse, ctx);
  linkSpouse(doc, cmd.personId, spouseId, cmd.status ?? "married", true);
};

export const addParent: Handler<"addParent"> = (doc, cmd, ctx) => {
  requirePerson(doc, cmd.childId);
  const parentId = addNewPerson(doc, cmd.parent, ctx);
  linkParent(doc, cmd.childId, parentId);
};

export const insertParent: Handler<"insertParent"> = (doc, cmd, ctx) => {
  requirePerson(doc, cmd.childId);
  const union =
    cmd.unionId !== undefined
      ? requireUnion(doc, cmd.unionId)
      : (parentUnionOf(doc, cmd.childId) as Draft<Union> | undefined);
  const index = union ? union.children.findIndex((c) => c.personId === cmd.childId) : -1;
  if (union && index < 0) {
    throw new CommandError("NOT_FOUND", `${cmd.childId} is not a child of union ${union.id}`);
  }
  // No parents yet (the root, for one): there is nothing to go between, so it is addParent.
  if (!union) {
    const parentId = addNewPerson(doc, cmd.parent, ctx);
    linkParent(doc, cmd.childId, parentId);
    return;
  }
  const link = union.children[index]!;
  // The child's own biological parents become the new person's: it can only move from there.
  if (link.type !== "biological" && parentUnionOf(doc, cmd.childId)) {
    throw new CommandError("INVALID", `${cmd.childId} already has biological parents elsewhere`);
  }
  const parentId = addNewPerson(doc, cmd.parent, ctx);
  union.children[index] = { personId: parentId, type: link.type };
  createUnion(doc, [parentId], "partner", [{ personId: cmd.childId, type: "biological" }]);
};

export const addSibling: Handler<"addSibling"> = (doc, cmd, ctx) => {
  requirePerson(doc, cmd.personId);
  const siblingId = addNewPerson(doc, cmd.sibling, ctx);
  const union = parentUnionOf(doc, cmd.personId) as Draft<Union> | undefined;
  if (union) {
    union.children.push({ personId: siblingId, type: "biological" });
    return;
  }
  // FR-R5/R6: no parents yet, so stand-ins hold the family together until the user names them.
  const placeholder = { isPlaceholder: true, isLiving: true } as const;
  const fatherId = addNewPerson(doc, { ...placeholder, gender: "male" }, ctx);
  const motherId = addNewPerson(doc, { ...placeholder, gender: "female" }, ctx);
  const created = createUnion(doc, [fatherId, motherId], "married", [
    { personId: cmd.personId, type: "biological" },
    { personId: siblingId, type: "biological" },
  ]);
  moveRootUp(doc, cmd.personId, created);
};

export const reorderChild: Handler<"reorderChild"> = (doc, cmd) => {
  const union = requireUnion(doc, cmd.unionId);
  if (!Number.isFinite(cmd.toIndex)) {
    throw new CommandError("INVALID", "toIndex must be a number");
  }
  const from = union.children.findIndex((c) => c.personId === cmd.personId);
  if (from < 0) throw new CommandError("NOT_FOUND", `${cmd.personId} is not a child of this union`);
  const to = Math.min(Math.max(Math.trunc(cmd.toIndex), 0), union.children.length - 1);
  const [moved] = union.children.splice(from, 1);
  union.children.splice(to, 0, moved!);
};

export const setChildType: Handler<"setChildType"> = (doc, cmd) => {
  const union = requireUnion(doc, cmd.unionId);
  const link = union.children.find((c) => c.personId === cmd.personId);
  if (!link) throw new CommandError("NOT_FOUND", `${cmd.personId} is not a child of this union`);
  if (cmd.childType === "biological") {
    const bio = parentUnionOf(doc, cmd.personId);
    if (bio && bio.id !== union.id) {
      throw new CommandError("INVALID", `${cmd.personId} is already a biological child elsewhere`);
    }
  }
  link.type = cmd.childType;
};
