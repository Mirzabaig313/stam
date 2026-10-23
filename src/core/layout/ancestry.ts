import type { TreeDocument, Union } from "@/core/model/types";

// Ancestor lookups shared by the pedigree, hourglass and fan layouts.

/** The union a person's ancestors are drawn through, and how the person is linked to it. */
export type ParentLink = { union: Union; childType: "biological" | "adopted" };

/**
 * childId -> the parent union the ancestor views follow: the biological one, or, for someone
 * with no biological parents, the adoptive one (the calculator counts adopted children as
 * children too). One pass over the unions, so each lookup is O(1) instead of a scan; the first
 * union of each type wins, as in `parentUnionOf`.
 */
export function viewParentUnions(doc: TreeDocument): Map<string, ParentLink> {
  const bio = new Map<string, ParentLink>();
  const adopted = new Map<string, ParentLink>();
  for (const union of Object.values(doc.unions)) {
    for (const { personId, type } of union.children) {
      if (type !== "biological" && type !== "adopted") continue;
      const index = type === "biological" ? bio : adopted;
      if (!index.has(personId)) index.set(personId, { union, childType: type });
    }
  }
  for (const [personId, link] of adopted) if (!bio.has(personId)) bio.set(personId, link);
  return bio;
}

/**
 * A parent union's partners as `[father slot, mother slot]`: the man first when the union has a
 * man and a woman, otherwise partner order. A lone parent takes the slot of their gender.
 */
export function parentSlots(
  doc: TreeDocument,
  union: Union,
): [string | undefined, string | undefined] {
  const [a, b] = union.partners;
  const isFemale = (id: string) => doc.persons[id]?.gender === "female";
  if (b === undefined) return isFemale(a) ? [undefined, a] : [a, undefined];
  return isFemale(a) && !isFemale(b) ? [b, a] : [a, b];
}

/** The person and all their ancestors, following `parents` (see `viewParentUnions`). */
export function ancestorSet(
  personId: string,
  parents: ReadonlyMap<string, ParentLink>,
): Set<string> {
  const seen = new Set([personId]);
  const stack = [personId];
  while (stack.length > 0) {
    for (const parent of parents.get(stack.pop()!)?.union.partners ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      stack.push(parent);
    }
  }
  return seen;
}
