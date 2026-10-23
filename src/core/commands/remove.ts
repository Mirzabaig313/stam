import type { Draft } from "immer";

import { childrenOf, descendantsOf, partnersOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import { requirePerson } from "./lookup";
import type { Handler } from "./types";

/** Old root's first remaining partner, else first remaining child, else first remaining person. */
function successorRoot(
  doc: Draft<TreeDocument>,
  oldRoot: string,
  removed: Set<string>,
): string | undefined {
  const remaining = (id: string) => !removed.has(id);
  return (
    partnersOf(doc, oldRoot).find(remaining) ??
    childrenOf(doc, oldRoot).find(remaining) ??
    Object.keys(doc.persons).find(remaining)
  );
}

export const deletePerson: Handler<"deletePerson"> = (doc, cmd) => {
  requirePerson(doc, cmd.personId);

  const removed = new Set([cmd.personId]);
  if (cmd.mode === "withDescendants") {
    for (const id of descendantsOf(doc, cmd.personId)) removed.add(id);
  }

  const rootRemoved = doc.rootPersonId !== undefined && removed.has(doc.rootPersonId);
  const nextRoot = rootRemoved ? successorRoot(doc, doc.rootPersonId!, removed) : doc.rootPersonId;

  for (const union of Object.values(doc.unions)) {
    const partners = union.partners.filter((id) => !removed.has(id));
    if (partners.length === 0) {
      // No partner left: the union goes, and its children lose that parent link.
      // Nobody else lists it in `unionOrder`, since only partners do.
      delete doc.unions[union.id];
      continue;
    }
    if (partners.length !== union.partners.length) {
      union.partners = partners as Draft<typeof union.partners>;
    }
    if (union.children.some((c) => removed.has(c.personId))) {
      union.children = union.children.filter((c) => !removed.has(c.personId));
    }
  }

  for (const id of removed) {
    delete doc.persons[id];
    delete doc.unionOrder[id];
  }
  doc.rootPersonId = nextRoot;
};
