import type { TreeDocument } from "@/core/model/types";

/** Plain JSON with sorted object keys and no undefined values; arrays keep their order. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

const entries = (map: Record<string, unknown>) =>
  Object.keys(map).map((id) => [id, sorted(map[id])]);

/**
 * A document as comparable text. `persons`, `unions` and `unionOrder` become `[id, value]` lists in
 * map order, because the commands depend on that order; everything else ignores key order.
 */
export function canonicalDoc(doc: TreeDocument): string {
  const { persons, unions, unionOrder, ...rest } = doc;
  return JSON.stringify({
    ...(sorted(rest) as object),
    persons: entries(persons),
    unions: entries(unions),
    unionOrder: entries(unionOrder),
  });
}

/** The document's content, ignoring map order and `updatedAt`. */
export function contentOf(doc: TreeDocument): string {
  const { updatedAt: _updatedAt, ...rest } = doc;
  return JSON.stringify(sorted(rest));
}
