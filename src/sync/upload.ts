import { newId } from "@/core/model/ids";
import type { TreeDocument } from "@/core/model/types";
import { isIndexKey } from "@/io/json/parseTree";

/** Every string well-formed: a lone surrogate (which JSON.parse allows) becomes U+FFFD. */
function wellFormed<T>(value: T): T {
  if (typeof value === "string") return value.toWellFormed() as T;
  if (Array.isArray(value)) return value.map(wellFormed) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k.toWellFormed(), wellFormed(v)]),
    ) as T;
  }
  return value;
}

function illFormed(value: unknown): boolean {
  if (typeof value === "string") return !value.isWellFormed();
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => !k.isWellFormed() || illFormed(v));
}

/**
 * A local tree as the server accepts it: persons and unions with array-index ids ("7", which JS
 * orders first but Rust does not) get new ids, with every reference rewritten, and strings are
 * made well-formed. A tree that needs neither comes back unchanged.
 */
export function prepareForUpload(doc: TreeDocument): TreeDocument {
  const renamed = new Map<string, string>();
  for (const id of [...Object.keys(doc.persons), ...Object.keys(doc.unions)]) {
    if (isIndexKey(id)) renamed.set(id, newId());
  }
  if (renamed.size === 0 && !illFormed(doc)) return doc;
  const to = (id: string) => renamed.get(id) ?? id;
  const persons = Object.fromEntries(
    Object.entries(doc.persons).map(([id, p]) => [to(id), { ...p, id: to(id) }]),
  );
  const unions = Object.fromEntries(
    Object.entries(doc.unions).map(([id, u]) => [
      to(id),
      {
        ...u,
        id: to(id),
        partners: u.partners.map(to) as typeof u.partners,
        children: u.children.map((c) => ({ ...c, personId: to(c.personId) })),
      },
    ]),
  );
  const unionOrder = Object.fromEntries(
    Object.entries(doc.unionOrder).map(([id, order]) => [to(id), order.map(to)]),
  );
  return wellFormed({
    ...doc,
    rootPersonId: doc.rootPersonId === undefined ? undefined : to(doc.rootPersonId),
    persons,
    unions,
    unionOrder,
  });
}
