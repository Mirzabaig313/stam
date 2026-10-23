import type { Command } from "@/core/commands/types";
import { parentsOf, topmostAncestor } from "@/core/model/tree";
import type { Gender, TreeDocument } from "@/core/model/types";
import type { EditorStore } from "@/ui/store/editorStore";

import { type AddRole, defaultGender } from "./nameEntry";

/** The gender the person whose handle was used suggests for the new one (clarification 7). */
export function suggestedGender(
  doc: TreeDocument,
  role: AddRole,
  fromId: string | undefined,
  newId?: string,
): Gender | null {
  const from = fromId ? doc.persons[fromId] : undefined;
  const existingParent =
    role === "parent" && fromId
      ? parentsOf(doc, fromId).find((id) => id !== newId && doc.persons[id])
      : undefined;
  return defaultGender(role, {
    partnerGender: role === "spouse" ? from?.gender : undefined,
    existingParentGender: existingParent ? doc.persons[existingParent]!.gender : undefined,
  });
}

function addCommand(
  role: AddRole,
  fromId: string,
  gender: Gender,
  unionId: string | undefined,
): Command {
  // The name comes later, from the inline editor, as an amendment of this same history entry.
  const person = { gender };
  switch (role) {
    case "first":
      return { type: "addPerson", person };
    case "child":
      return { type: "addChild", parentId: fromId, unionId, child: person };
    case "spouse":
      return { type: "addSpouse", personId: fromId, spouse: person };
    case "parent":
      return { type: "addParent", childId: fromId, parent: person };
    case "sibling":
      return { type: "addSibling", personId: fromId, sibling: person };
  }
}

const LABELS: Record<AddRole, string> = {
  first: "Add person",
  child: "Add child",
  spouse: "Add spouse",
  parent: "Add parent",
  sibling: "Add sibling",
};

/**
 * Inline add (clarification 5): dispatches the add at once with an empty name and opens the
 * inline editor on the new person. Returns the new person's id, or null when the model refused
 * the add; the reason is then in the store's `error` and no editor opens.
 *
 * An add still being named is cancelled first. A child's collapsed parents are expanded, and a
 * new person outside the current view moves the view root, so the new card is always drawn.
 */
export function startAdd(
  store: EditorStore,
  role: AddRole,
  fromId?: string,
  unionId?: string,
): string | null {
  const before = store.getState();
  if (before.editing) {
    before.cancelLastAdd();
    before.stopEditing();
  }
  const doc = store.getState().doc;
  if (!doc || (role !== "first" && (!fromId || !doc.persons[fromId]))) return null;
  const from = fromId ?? "";

  if (role === "child") {
    const union = unionId ? doc.unions[unionId] : undefined;
    for (const id of new Set([from, ...(union?.partners ?? [])])) {
      if (store.getState().collapsed.has(id)) store.getState().toggleCollapse(id);
    }
  }

  // A gender the user must choose still needs a value in the model until they do.
  const gender = suggestedGender(doc, role, fromId) ?? "male";
  const created = store.getState().dispatch(addCommand(role, from, gender, unionId), LABELS[role]);
  const personId = created?.[0];
  if (!personId) return null;

  const after = store.getState();
  if (after.layout && after.layout.primaryNode[personId] === undefined && after.doc) {
    after.setViewRoot(topmostAncestor(after.doc, personId));
  }
  store.getState().startEditing({ personId, role, ...(fromId ? { fromId } : {}) });
  return personId;
}
