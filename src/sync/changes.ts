import type { Person, TreeDocument, Union } from "@/core/model/types";

/**
 * What one op did to a tree, entity by entity: the wire format for edits (spec §5.2). `null`
 * removes the entity. The Rust room produces exactly this shape.
 */
export type Changes = {
  persons: Record<string, Person | null>;
  unions: Record<string, Union | null>;
  unionOrder: Record<string, string[] | null>;
  tree: { name?: string; rootPersonId?: string | null; updatedAt: string };
};

/** JSON with sorted object keys and no undefined values, for comparing values. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .toSorted()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

/** Same value, ignoring key order and undefined fields. */
export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || canonicalJson(a) === canonicalJson(b);
}

function diffMap<T>(before: Record<string, T>, after: Record<string, T>): Record<string, T | null> {
  const out: Record<string, T | null> = {};
  for (const id of Object.keys(after)) {
    const old = Object.hasOwn(before, id) ? before[id] : undefined;
    // Immer gives every touched entity a new reference, even when an array is reassigned with
    // equal contents; only a different value counts.
    if (old === undefined || !sameValue(old, after[id])) out[id] = after[id]!;
  }
  for (const id of Object.keys(before)) {
    if (!Object.hasOwn(after, id)) out[id] = null;
  }
  return out;
}

/** The changes that turn `before` into `after`; new entities in `after`'s order, then removals. */
export function diffDocs(before: TreeDocument, after: TreeDocument): Changes {
  const tree: Changes["tree"] = { updatedAt: after.updatedAt };
  if (after.name !== before.name) tree.name = after.name;
  if (after.rootPersonId !== before.rootPersonId) tree.rootPersonId = after.rootPersonId ?? null;
  return {
    persons: diffMap(before.persons, after.persons),
    unions: diffMap(before.unions, after.unions),
    unionOrder: diffMap(before.unionOrder, after.unionOrder),
    tree,
  };
}

/**
 * Writes `changes` into a copy of the map: `null` deletes, an existing key is replaced in place, a
 * new key is appended in the order `changes` lists it. That keeps map order identical to the
 * document the changes were taken from, which later commands depend on.
 */
export function applyMap<T>(
  map: Record<string, T>,
  changes: Record<string, T | null>,
): Record<string, T> {
  const out = { ...map };
  for (const [id, value] of Object.entries(changes)) {
    if (value === null) delete out[id];
    else out[id] = value;
  }
  return out;
}

export function applyChanges(doc: TreeDocument, changes: Changes): TreeDocument {
  const next: TreeDocument = {
    ...doc,
    persons: applyMap(doc.persons, changes.persons),
    unions: applyMap(doc.unions, changes.unions),
    unionOrder: applyMap(doc.unionOrder, changes.unionOrder),
    updatedAt: changes.tree.updatedAt,
  };
  if (changes.tree.name !== undefined) next.name = changes.tree.name;
  if (changes.tree.rootPersonId !== undefined) {
    next.rootPersonId = changes.tree.rootPersonId ?? undefined;
  }
  return next;
}
