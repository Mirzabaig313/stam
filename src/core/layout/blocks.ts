import type { TreeDocument, Union } from "@/core/model/types";

import type { Block, BlockMember, BlockUnion } from "./types";

export type BlockTree = {
  root: Block;
  /** personId -> nodeId of the person's primary (first) placement. */
  primaryNode: Record<string, string>;
  /**
   * Persons the root does not reach, in document order. Someone hidden only by a collapse is
   * still connected and is not listed.
   */
  unreachable: string[];
};

type Visit = { personId: string; depth: number; into: Block[] };

/**
 * Walks the family below `rootId` depth-first in child order and groups each blood person with
 * their partners. Iterative: trees reach 5,000 people.
 *
 * - A person's first placement is primary; every later one is a `linked` leaf, so the result is
 *   a tree even with pedigree collapse.
 * - Blood beats spouse (R15): a blood relative is primary only at a blood position. Where they
 *   first show up as someone's partner, that card is a linked copy, so their own unions and
 *   children are still drawn under their blood position.
 * - Each union is laid out once, in the block of the first blood partner reached.
 * - Collapsing a person hides the children of all their unions.
 *
 * Reads `unionOrder` and union children directly (both O(1) per person) rather than the model
 * queries, which scan every union.
 */
export function buildBlockTree(
  doc: TreeDocument,
  rootId: string,
  collapsed: ReadonlySet<string>,
): BlockTree {
  if (!Object.hasOwn(doc.persons, rootId)) {
    throw new Error(`Layout root ${rootId} is not in the document`);
  }

  const isHidden = (union: Union) => union.partners.some((p) => collapsed.has(p));
  const blood = bloodSet(doc, rootId, isHidden);
  const primary = new Set<string>();
  const copies = new Map<string, number>();
  const laidOut = new Set<string>();
  const hiddenIn: [Block, Union[]][] = [];

  const place = (personId: string, kind: "blood" | "spouse"): BlockMember => {
    const takenElsewhere = kind === "spouse" && blood.has(personId);
    if (!takenElsewhere && !primary.has(personId)) {
      primary.add(personId);
      return { nodeId: personId, personId, kind };
    }
    const n = (copies.get(personId) ?? 0) + 1;
    copies.set(personId, n);
    return { nodeId: `${personId}~${n}`, personId, kind: "linked" };
  };

  const top: Block[] = [];
  const stack: Visit[] = [{ personId: rootId, depth: 0, into: top }];

  while (stack.length > 0) {
    const { personId, depth, into } = stack.pop()!;
    const self = place(personId, "blood");
    const block: Block = {
      bloodNodeId: self.nodeId,
      members: [self],
      unions: [],
      hiddenCount: 0,
      depth,
    };
    into.push(block);
    if (self.kind === "linked") continue;

    const unions: Union[] = [];
    for (const unionId of doc.unionOrder[personId] ?? []) {
      const union = doc.unions[unionId];
      if (union && !laidOut.has(unionId)) {
        laidOut.add(unionId);
        unions.push(union);
      }
    }
    layOutMembers(block, personId, unions, place);

    const hidden = unions.filter(isHidden);
    if (hidden.length > 0) hiddenIn.push([block, hidden]);
    // Pushed in reverse so they pop in union order, then child order.
    for (let u = block.unions.length - 1; u >= 0; u--) {
      if (isHidden(unions[u]!)) continue;
      const entry = block.unions[u]!;
      const children = unions[u]!.children;
      for (let c = children.length - 1; c >= 0; c--) {
        stack.push({ personId: children[c]!.personId, depth: depth + 1, into: entry.children });
      }
    }
  }

  for (const [block, unions] of hiddenIn) {
    block.hiddenCount = countHidden(doc, unions, primary);
  }

  const primaryNode: Record<string, string> = {};
  for (const personId of primary) primaryNode[personId] = personId;
  // With nothing collapsed, everyone connected is placed; otherwise ask who would be.
  const connected = collapsed.size === 0 ? primary : connectedSet(doc, rootId);
  return {
    root: top[0]!,
    primaryNode,
    unreachable: Object.keys(doc.persons).filter((id) => !connected.has(id)),
  };
}

/**
 * Everyone the walk places when nothing is collapsed: the root's blood line and the partners in
 * their unions (a partner's other family is not drawn).
 */
function connectedSet(doc: TreeDocument, rootId: string): Set<string> {
  const blood = bloodSet(doc, rootId, () => false);
  const connected = new Set(blood);
  for (const personId of blood) {
    for (const unionId of doc.unionOrder[personId] ?? []) {
      for (const partner of doc.unions[unionId]?.partners ?? []) connected.add(partner);
    }
  }
  return connected;
}

/** The root and everyone below them through unions that are not hidden by a collapse. */
function bloodSet(
  doc: TreeDocument,
  rootId: string,
  isHidden: (union: Union) => boolean,
): Set<string> {
  const blood = new Set([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const personId = stack.pop()!;
    for (const unionId of doc.unionOrder[personId] ?? []) {
      const union = doc.unions[unionId];
      if (!union || isHidden(union)) continue;
      for (const child of union.children) {
        if (blood.has(child.personId)) continue;
        blood.add(child.personId);
        stack.push(child.personId);
      }
    }
  }
  return blood;
}

/**
 * One partner: `[P, S1]`. Several: `[S1, P, S2, …, Sn]`. Union i ≥ 2 anchors to the gap left of
 * its partner, union 1 to the gap between S1 and P. Single-parent unions add no card and anchor
 * on P itself.
 */
function layOutMembers(
  block: Block,
  personId: string,
  unions: Union[],
  place: (personId: string, kind: "spouse") => BlockMember,
): void {
  const partners = unions.map((u) => u.partners.find((p) => p !== personId));
  const spouseCount = partners.filter((p) => p !== undefined).length;
  const self = block.members[0]!;
  const selfIndex = spouseCount >= 2 ? 1 : 0;
  const members: BlockMember[] = [self];
  let spouseNumber = 0;

  block.unions = unions.map((union, i): BlockUnion => {
    const partnerId = partners[i];
    if (partnerId === undefined) {
      return { unionId: union.id, anchorBetween: [selfIndex, selfIndex], children: [] };
    }
    const member = place(partnerId, "spouse");
    spouseNumber++;
    if (spouseNumber === 1 && spouseCount >= 2) {
      members.unshift(member);
      return { unionId: union.id, anchorBetween: [0, 1], children: [] };
    }
    members.push(member);
    const at = members.length - 1;
    return { unionId: union.id, anchorBetween: [at - 1, at], children: [] };
  });
  block.members = members;
}

/** Everyone below the hidden unions' children (any child type) who was never placed. */
function countHidden(doc: TreeDocument, unions: Union[], placed: ReadonlySet<string>): number {
  const seen = new Set<string>();
  const stack: string[] = [];
  let hidden = 0;
  const visit = (personId: string) => {
    if (seen.has(personId)) return;
    seen.add(personId);
    stack.push(personId);
    if (!placed.has(personId)) hidden++;
  };
  for (const union of unions) for (const child of union.children) visit(child.personId);
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const unionId of doc.unionOrder[current] ?? []) {
      for (const child of doc.unions[unionId]?.children ?? []) visit(child.personId);
    }
  }
  return hidden;
}
