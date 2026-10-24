import { CommandError } from "@/core/commands/errors";
import type { TreeDocument } from "@/core/model/types";
import { validate } from "@/core/model/validate";

import { applyMap, type Changes, diffDocs, sameValue } from "./changes";

export type EntityKey =
  | `persons/${string}`
  | `unions/${string}`
  | `unionOrder/${string}`
  | "tree/name"
  | "tree/rootPersonId";

/** One entity an edit touched, with its value before and after; null means absent. */
export type EntityChange = { key: EntityKey; before: unknown; after: unknown };

const MAPS = ["persons", "unions", "unionOrder"] as const;

/** The entities `changes` touched, with their values in `before` (the document it was taken from). */
export function entityChanges(changes: Changes, before: TreeDocument): EntityChange[] {
  const out: EntityChange[] = [];
  for (const map of MAPS) {
    const old = before[map] as Record<string, unknown>;
    for (const [id, after] of Object.entries(changes[map])) {
      out.push({
        key: `${map}/${id}`,
        before: Object.hasOwn(old, id) ? old[id] : null,
        after,
      });
    }
  }
  if (changes.tree.name !== undefined) {
    out.push({ key: "tree/name", before: before.name, after: changes.tree.name });
  }
  if (changes.tree.rootPersonId !== undefined) {
    out.push({
      key: "tree/rootPersonId",
      before: before.rootPersonId ?? null,
      after: changes.tree.rootPersonId,
    });
  }
  return out;
}

function current(doc: TreeDocument, key: EntityKey): unknown {
  if (key === "tree/name") return doc.name;
  if (key === "tree/rootPersonId") return doc.rootPersonId ?? null;
  const slash = key.indexOf("/");
  const map = doc[key.slice(0, slash) as (typeof MAPS)[number]] as Record<string, unknown>;
  const id = key.slice(slash + 1);
  return Object.hasOwn(map, id) ? map[id] : null;
}

/**
 * Collaborative undo (or redo) of one's own edit: every entity must still hold the value the edit
 * left (undo) or found (redo); then each gets the other value. Refuses the whole revert with
 * CONFLICT (naming the entity) when one changed since, and with INVALID when the result breaks the
 * tree. The Rust room applies the same rules.
 */
export function applyRevert(
  doc: TreeDocument,
  entries: readonly EntityChange[],
  direction: "undo" | "redo",
  now: Date,
): { doc: TreeDocument; changes: Changes } {
  const writes: Record<(typeof MAPS)[number], Record<string, unknown>> = {
    persons: {},
    unions: {},
    unionOrder: {},
  };
  let next: TreeDocument = { ...doc, updatedAt: now.toISOString() };
  for (const entry of entries) {
    const expected = direction === "undo" ? entry.after : entry.before;
    const value = direction === "undo" ? entry.before : entry.after;
    if (!sameValue(current(doc, entry.key), expected)) {
      throw new CommandError("CONFLICT", `${entry.key} changed since`, undefined, entry.key);
    }
    if (entry.key === "tree/name") next.name = value as string;
    else if (entry.key === "tree/rootPersonId")
      next.rootPersonId = (value as string | null) ?? undefined;
    else {
      const slash = entry.key.indexOf("/");
      writes[entry.key.slice(0, slash) as (typeof MAPS)[number]][entry.key.slice(slash + 1)] =
        value;
    }
  }
  next = {
    ...next,
    persons: applyMap(doc.persons, writes.persons as Changes["persons"]),
    unions: applyMap(doc.unions, writes.unions as Changes["unions"]),
    unionOrder: applyMap(doc.unionOrder, writes.unionOrder as Changes["unionOrder"]),
  };
  const issues = validate(next);
  if (issues.length > 0) {
    throw new CommandError("INVALID", "The revert would leave an invalid tree", issues);
  }
  return { doc: next, changes: diffDocs(doc, next) };
}
