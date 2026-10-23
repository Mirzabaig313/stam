import { isAncestor, parentUnionOf, partnersOf, unionsOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

/** What dropping `dragged` on `target` can mean (FR-D3). */
export type DropAction = "child" | "spouse" | "parent";

const ACTIONS: DropAction[] = ["child", "spouse", "parent"];

export type DropBlocker = "CYCLE" | "ALREADY_LINKED" | "PARENTS_FULL";

// The two predicates below decide, for the commands and for the drop menu alike, whether a new
// parent -> child link would close a loop. They are the only place that logic lives.

/**
 * True when `childId` may become a child of a union with these partners: every partner becomes
 * a parent of `childId`, so none may be `childId` or descend from it.
 */
export function unionAcceptsChild(
  doc: TreeDocument,
  partners: readonly string[],
  childId: string,
): boolean {
  return partners.every((p) => p !== childId && !isAncestor(doc, childId, p));
}

/**
 * True when `parentId` may become a biological parent of `childId`: it joins the child's parent
 * union (or a new one) and so parents all of that union's children, none of whom may be
 * `parentId` or above it.
 */
export function parentCanJoin(doc: TreeDocument, childId: string, parentId: string): boolean {
  const union = parentUnionOf(doc, childId);
  const children = union ? union.children.map((c) => c.personId) : [childId];
  return children.every((id) => id !== parentId && !isAncestor(doc, id, parentId));
}

/**
 * The unions of `parentId` that `draggedId` can join as a child without a cycle, in
 * `unionOrder` order. Feeds the union chooser (FR-E4); a parent without unions gives [].
 */
export function usableUnionsForChild(
  doc: TreeDocument,
  draggedId: string,
  parentId: string,
): string[] {
  return unionsOf(doc, parentId)
    .filter((u) => unionAcceptsChild(doc, u.partners, draggedId))
    .map((u) => u.id);
}

/**
 * Why an action is not allowed: it would create a cycle, or the link already exists.
 * `null` means the action is valid. Both people must exist.
 */
export function dropBlocker(
  doc: TreeDocument,
  action: DropAction,
  draggedId: string,
  targetId: string,
): DropBlocker | null {
  if (draggedId === targetId) return "CYCLE";

  switch (action) {
    case "child": {
      // dragged becomes a child of target, inside one of target's unions (or a new one).
      const targetUnions = unionsOf(doc, targetId);
      const possible =
        targetUnions.length === 0
          ? unionAcceptsChild(doc, [targetId], draggedId)
          : usableUnionsForChild(doc, draggedId, targetId).length > 0;
      if (!possible) return "CYCLE";
      if (targetUnions.some((u) => u.children.some((c) => c.personId === draggedId))) {
        return "ALREADY_LINKED";
      }
      return null;
    }
    case "spouse": {
      if (isAncestor(doc, draggedId, targetId) || isAncestor(doc, targetId, draggedId)) {
        return "CYCLE";
      }
      return partnersOf(doc, targetId).includes(draggedId) ? "ALREADY_LINKED" : null;
    }
    case "parent": {
      // dragged becomes a (biological) parent of target. Most specific reason first.
      if (!parentCanJoin(doc, targetId, draggedId)) return "CYCLE";
      const alreadyParent = unionsOf(doc, draggedId).some((u) =>
        u.children.some((c) => c.personId === targetId),
      );
      if (alreadyParent) return "ALREADY_LINKED";
      if ((parentUnionOf(doc, targetId)?.partners.length ?? 0) >= 2) return "PARENTS_FULL";
      return null;
    }
  }
}

/** The actions FR-D3 may offer when `dragged` is dropped on `target`, in menu order. */
export function validDropActions(
  doc: TreeDocument,
  draggedId: string,
  targetId: string,
): DropAction[] {
  if (!Object.hasOwn(doc.persons, draggedId) || !Object.hasOwn(doc.persons, targetId)) return [];
  return ACTIONS.filter((action) => dropBlocker(doc, action, draggedId, targetId) === null);
}
