import { newId } from "./ids";
import type { ChildType, Person, TreeDocument, Union } from "./types";

// Queries take a plain document. Commands also call them on immer drafts, so nothing here
// caches by document identity. Traversals are iterative: trees reach 5,000 people.

export function createTree(name: string, now: Date = new Date()): TreeDocument {
  const stamp = now.toISOString();
  return {
    id: newId(),
    name,
    schemaVersion: 1,
    rootPersonId: undefined,
    persons: {},
    unions: {},
    unionOrder: {},
    settings: { theme: "default", colorMode: "light", direction: "ltr" },
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** The person's unions, in `unionOrder` order. */
export function unionsOf(doc: TreeDocument, personId: string): Union[] {
  const result: Union[] = [];
  for (const unionId of doc.unionOrder[personId] ?? []) {
    const union = doc.unions[unionId];
    if (union) result.push(union);
  }
  return result;
}

/** The union the person is a child of with the given link type, if any. */
export function parentUnionOf(
  doc: TreeDocument,
  personId: string,
  type: ChildType = "biological",
): Union | undefined {
  for (const union of Object.values(doc.unions)) {
    if (union.children.some((c) => c.personId === personId && c.type === type)) return union;
  }
  return undefined;
}

/** Biological parents, in union partner order. */
export function parentsOf(doc: TreeDocument, personId: string): string[] {
  return [...(parentUnionOf(doc, personId)?.partners ?? [])];
}

/** Children from every union, any link type, without duplicates. */
export function childrenOf(doc: TreeDocument, personId: string): string[] {
  const seen = new Set<string>();
  for (const union of unionsOf(doc, personId)) {
    for (const child of union.children) seen.add(child.personId);
  }
  return [...seen];
}

export function partnersOf(doc: TreeDocument, personId: string): string[] {
  const seen = new Set<string>();
  for (const union of unionsOf(doc, personId)) {
    for (const partner of union.partners) if (partner !== personId) seen.add(partner);
  }
  return [...seen];
}

/**
 * Siblings are derived, never stored. A sibling is full when they share a union, or share both
 * parents through different unions; half when they share exactly one parent.
 */
export function siblingsOf(
  doc: TreeDocument,
  personId: string,
): { personId: string; half: boolean }[] {
  const myUnions = new Set<string>();
  const myParents = new Set<string>();
  for (const union of Object.values(doc.unions)) {
    if (!union.children.some((c) => c.personId === personId)) continue;
    myUnions.add(union.id);
    for (const partner of union.partners) myParents.add(partner);
  }

  const sharedParents = new Map<string, Set<string>>();
  const sharesUnion = new Set<string>();
  for (const parentId of myParents) {
    for (const union of unionsOf(doc, parentId)) {
      for (const child of union.children) {
        if (child.personId === personId) continue;
        let parents = sharedParents.get(child.personId);
        if (!parents) sharedParents.set(child.personId, (parents = new Set()));
        parents.add(parentId);
        if (myUnions.has(union.id)) sharesUnion.add(child.personId);
      }
    }
  }

  return [...sharedParents].map(([id, parents]) => ({
    personId: id,
    half: !sharesUnion.has(id) && parents.size < 2,
  }));
}

/** True when `ancestorId` is a proper ancestor of `personId` (any child type). */
export function isAncestor(doc: TreeDocument, ancestorId: string, personId: string): boolean {
  const seen = new Set<string>();
  const stack = [ancestorId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const union of unionsOf(doc, current)) {
      for (const child of union.children) {
        if (child.personId === personId) return true;
        if (!seen.has(child.personId)) {
          seen.add(child.personId);
          stack.push(child.personId);
        }
      }
    }
  }
  return false;
}

/** Every person above `personId`, any child type. Never includes `personId` itself. */
export function ancestorsOf(doc: TreeDocument, personId: string): Set<string> {
  const parentsByChild = new Map<string, string[]>();
  for (const union of Object.values(doc.unions)) {
    for (const child of union.children) {
      const list = parentsByChild.get(child.personId) ?? [];
      list.push(...union.partners);
      parentsByChild.set(child.personId, list);
    }
  }
  const seen = new Set<string>();
  const stack = [personId];
  while (stack.length > 0) {
    for (const parent of parentsByChild.get(stack.pop()!) ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent);
        stack.push(parent);
      }
    }
  }
  seen.delete(personId);
  return seen;
}

/** Every person below `personId`, any child type. Never includes `personId` itself. */
export function descendantsOf(doc: TreeDocument, personId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [personId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const union of unionsOf(doc, current)) {
      for (const child of union.children) {
        if (!seen.has(child.personId)) {
          seen.add(child.personId);
          stack.push(child.personId);
        }
      }
    }
  }
  seen.delete(personId);
  return seen;
}

/** Walks up through the first biological parent until a person has none. */
export function topmostAncestor(doc: TreeDocument, personId: string): string {
  const seen = new Set([personId]);
  let current = personId;
  for (;;) {
    const parent = parentUnionOf(doc, current)?.partners[0];
    if (parent === undefined || seen.has(parent)) return current;
    seen.add(parent);
    current = parent;
  }
}

/**
 * A tree with people needs a root to be drawn from. When it has none (an older or hand-made
 * file), it gets the topmost ancestor of its first person in insertion order.
 */
export function withRoot(doc: TreeDocument): TreeDocument {
  if (doc.rootPersonId !== undefined) return doc;
  const [first] = Object.keys(doc.persons);
  if (first === undefined) return doc;
  return { ...doc, rootPersonId: topmostAncestor(doc, first) };
}

/** "First Last". Unnamed placeholders give "": the UI supplies the translated label. */
export function displayName(p: Person): string {
  return [p.firstName, p.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}
