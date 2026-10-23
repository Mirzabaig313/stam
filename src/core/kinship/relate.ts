import type { FuzzyDate, TreeDocument, Union, UnionStatus } from "@/core/model/types";

import type { RelationKind, Relationship } from "./types";

// How A is related to B. Blood relationships come from every pair of upward paths (A up to a
// common ancestor, B up to the same ancestor) that meet only at that ancestor, which is what
// lists both lines when there is pedigree collapse. Step and in-law relationships are built on
// top of those, through current partners only.
//
// Siblings are half only when they share exactly one parent and each has a second recorded
// parent, and those differ: a parent recorded alone says nothing about the other parent, and
// children of the same union are never half.

/** Upward paths kept per ancestor, and in total, so pedigree collapse can't blow up. */
const MAX_PATHS_PER_ANCESTOR = 16;
const MAX_PATHS = 20_000;
/**
 * At most this many relationships: an endogamous family can link two people in thousands of
 * ways. The search runs through the nearest common ancestors first and stops here.
 */
export const MAX_RESULTS = 50;

type Sex = "male" | "female";

type Index = {
  doc: TreeDocument;
  /** Biological and adoptive parents, in union partner order, biological first. */
  parents: Map<string, string[]>;
  /** `parent>child` for adoptive links that are not also biological. */
  adoptedLinks: Set<string>;
  partners: Map<string, { id: string; status: UnionStatus; unionId: string }[]>;
  /** Unions a person is a biological or adopted child of. */
  childOf: Map<string, string[]>;
  /** Partner lists of the unions a person is linked to as a step-child. */
  stepUnions: Map<string, string[][]>;
  paths: Map<string, Map<string, string[][]>>;
};

function push<T>(map: Map<string, T[]>, key: string, ...values: T[]): void {
  const list = map.get(key);
  if (list) list.push(...values);
  else map.set(key, [...values]);
}

function buildIndex(doc: TreeDocument): Index {
  const bio = new Map<string, string[]>();
  const adoptive = new Map<string, string[]>();
  const partners = new Map<string, { id: string; status: UnionStatus; unionId: string }[]>();
  const stepUnions = new Map<string, string[][]>();
  const childOf = new Map<string, string[]>();

  for (const union of Object.values(doc.unions)) {
    const [p1, p2] = union.partners;
    if (p2 !== undefined && p1 !== p2) {
      push(partners, p1, { id: p2, status: union.status, unionId: union.id });
      push(partners, p2, { id: p1, status: union.status, unionId: union.id });
    }
    for (const child of union.children) {
      if (child.type === "biological") push(bio, child.personId, ...union.partners);
      else if (child.type === "adopted") push(adoptive, child.personId, ...union.partners);
      else if (child.type === "step") push(stepUnions, child.personId, [...union.partners]);
      if (child.type === "biological" || child.type === "adopted") {
        push(childOf, child.personId, union.id);
      }
    }
  }

  const adoptedLinks = new Set<string>();
  for (const [child, adopters] of adoptive) {
    const birth = bio.get(child) ?? [];
    for (const parent of adopters) {
      if (!birth.includes(parent)) adoptedLinks.add(linkKey(parent, child));
    }
  }

  const parents = new Map<string, string[]>();
  for (const id of new Set([...bio.keys(), ...adoptive.keys()])) {
    const all = [...(bio.get(id) ?? []), ...(adoptive.get(id) ?? [])];
    parents.set(
      id,
      [...new Set(all)].filter((p) => p !== id),
    );
  }
  return { doc, parents, adoptedLinks, partners, childOf, stepUnions, paths: new Map() };
}

const linkKey = (parent: string, child: string) => `${parent}>${child}`;

const sexOf = (ix: Index, id: string): Sex => ix.doc.persons[id]?.gender ?? "male";
const sideOf = (ix: Index, id: string) => (sexOf(ix, id) === "male" ? "paternal" : "maternal");
const parentsOf = (ix: Index, id: string) => ix.parents.get(id) ?? [];

/** Every upward path from `start` (start first), grouped by the ancestor it ends at. */
function upPaths(ix: Index, start: string): Map<string, string[][]> {
  const cached = ix.paths.get(start);
  if (cached) return cached;
  const result = new Map<string, string[][]>();
  const stack: string[][] = [[start]];
  let total = 0;
  while (stack.length > 0 && total < MAX_PATHS) {
    const path = stack.pop()!;
    const top = path.at(-1)!;
    let list = result.get(top);
    if (!list) result.set(top, (list = []));
    if (list.length >= MAX_PATHS_PER_ANCESTOR) continue;
    list.push(path);
    total++;
    const parents = parentsOf(ix, top);
    for (let i = parents.length - 1; i >= 0; i--) {
      const parent = parents[i]!;
      if (!path.includes(parent)) stack.push([...path, parent]);
    }
  }
  ix.paths.set(start, result);
  return result;
}

/** True when A is born before B; undefined when their birth dates don't tell. */
function bornBefore(a: FuzzyDate | undefined, b: FuzzyDate | undefined): boolean | undefined {
  if (a?.year === undefined || b?.year === undefined) return undefined;
  if (a.qualifier !== undefined || b.qualifier !== undefined) {
    // "about 1960" against "1962" still tells; within a year or two it doesn't.
    if (Math.abs(a.year - b.year) < 3) return undefined;
  }
  if (a.year !== b.year) return a.year < b.year;
  if (a.month === undefined || b.month === undefined) return undefined;
  if (a.month !== b.month) return a.month < b.month;
  if (a.day === undefined || b.day === undefined || a.day === b.day) return undefined;
  return a.day < b.day;
}

/**
 * Whether two children of a common parent are half-siblings: they share exactly one parent, each
 * has a second recorded parent, and those differ. Children of one union never are.
 */
function halfSiblings(ix: Index, x: string, y: string): boolean {
  const unionsY = ix.childOf.get(y) ?? [];
  if ((ix.childOf.get(x) ?? []).some((u) => unionsY.includes(u))) return false;
  const px = parentsOf(ix, x);
  const py = parentsOf(ix, y);
  const shared = px.filter((p) => py.includes(p));
  if (shared.length !== 1) return false;
  return px.length > 1 && py.length > 1;
}

function classify(ix: Index, pa: string[], pb: string[]): Relationship {
  const a = pa[0]!;
  const up = pa.length - 1;
  const down = pb.length - 1;
  const half = up >= 1 && down >= 1 && halfSiblings(ix, pa[up - 1]!, pb[down - 1]!);

  const rel: Relationship = {
    kind: "self",
    greats: 0,
    half,
    sexOfA: sexOf(ix, a),
    path: [...pa, ...pb.slice(0, -1).toReversed()],
  };
  if (up === 0) {
    rel.kind = down === 1 ? "parent" : "grandparent";
    rel.greats = Math.max(0, down - 2);
    if (down === 1 && ix.adoptedLinks.has(linkKey(a, pb[0]!))) rel.adopted = true;
  } else if (down === 0) {
    rel.kind = up === 1 ? "child" : "grandchild";
    rel.greats = Math.max(0, up - 2);
    if (up === 1 && ix.adoptedLinks.has(linkKey(pa[1]!, a))) rel.adopted = true;
  } else if (up === 1 && down === 1) {
    rel.kind = "sibling";
  } else if (up === 1) {
    rel.kind = "auncle";
    rel.greats = down - 2;
  } else if (down === 1) {
    rel.kind = "nibling";
    rel.greats = up - 2;
  } else {
    rel.kind = "cousin";
    rel.degree = Math.min(up, down) - 1;
    rel.removal = Math.abs(up - down);
  }

  if (down >= 2 || (down === 1 && up >= 1 && half)) rel.side = sideOf(ix, pb[1]!);
  if (up >= 2) rel.viaSex = sexOf(ix, pa[1]!);
  if (rel.kind === "auncle" && rel.greats === 0) {
    const elder = bornBefore(ix.doc.persons[a]?.birth?.date, ix.doc.persons[pb[1]!]?.birth?.date);
    if (elder !== undefined) rel.elder = elder;
  }
  return rel;
}

const shortest = (paths: string[][]) => Math.min(...paths.map((p) => p.length));

/** Blood relationships of A to B, closest first; at most about `MAX_RESULTS`. */
function blood(ix: Index, a: string, b: string): Relationship[] {
  if (a === b) return [{ kind: "self", greats: 0, half: false, sexOfA: sexOf(ix, a), path: [a] }];
  const fromA = upPaths(ix, a);
  const fromB = upPaths(ix, b);
  // Nearest common ancestors first, so stopping early keeps the closest relationships.
  const apexes: [string[][], string[][], number][] = [];
  for (const [apex, pathsA] of fromA) {
    const pathsB = fromB.get(apex);
    if (pathsB) apexes.push([pathsA, pathsB, shortest(pathsA) + shortest(pathsB)]);
  }
  apexes.sort((x, y) => x[2] - y[2]);
  const seen = new Set<string>();
  const result: Relationship[] = [];
  for (const [pathsA, pathsB] of apexes) {
    if (result.length >= MAX_RESULTS) break;
    for (const pa of pathsA) {
      const below = new Set(pa.slice(0, -1));
      for (const pb of pathsB) {
        if (pb.slice(0, -1).some((id) => below.has(id))) continue;
        const rel = classify(ix, pa, pb);
        // Through either partner of a couple it is the same relationship: drop the apex.
        const key = [
          rel.kind,
          rel.greats,
          rel.degree,
          rel.removal,
          rel.half,
          rel.side,
          pa.slice(0, -1).join(","),
          pb.slice(0, -1).join(","),
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(rel);
      }
    }
  }
  return result.toSorted((x, y) => x.path.length - y.path.length);
}

/**
 * Unions that make in-laws and step-parents: a marriage, a partnership, or a marriage ended by
 * death. An engagement does not, nor does a divorce or separation.
 */
const isCurrent = (status: UnionStatus) =>
  status === "married" || status === "partner" || status === "widowed";

/** Current partners: in-law and step relationships run through these only. */
function currentPartners(ix: Index, id: string): string[] {
  const ids = (ix.partners.get(id) ?? []).filter((p) => isCurrent(p.status)).map((p) => p.id);
  return [...new Set(ids)].filter((p) => p !== id);
}

/**
 * Whether union `later` came after union `earlier` for `personId`: by their union order, else by
 * their start years. Unknown counts as not later.
 */
function cameAfter(ix: Index, personId: string, later: Union, earlier: Union): boolean {
  const order = ix.doc.unionOrder[personId] ?? [];
  const i = order.indexOf(later.id);
  const j = order.indexOf(earlier.id);
  if (i >= 0 && j >= 0) return i > j;
  const a = later.start?.year;
  const b = earlier.start?.year;
  return a !== undefined && b !== undefined && a > b;
}

/**
 * Whether `partner`, in union `unionId` with `parent`, is a step-parent of `child`: always, except
 * that a partner who died (a widowed union) is none to children of the parent's later unions.
 */
function stepThrough(ix: Index, parent: string, unionId: string, child: string): boolean {
  const union = ix.doc.unions[unionId];
  if (!union || union.status !== "widowed") return true;
  const own = (ix.childOf.get(child) ?? [])
    .map((id) => ix.doc.unions[id])
    .filter((u): u is Union => u !== undefined && u.partners.includes(parent));
  return own.length === 0 || own.some((u) => !cameAfter(ix, parent, u, union));
}

/** Step-parents of `id`, each with the path from them to `id`. */
function stepParents(ix: Index, id: string): Map<string, string[]> {
  const own = parentsOf(ix, id);
  const result = new Map<string, string[]>();
  for (const parent of own) {
    for (const { id: partner, status, unionId } of ix.partners.get(parent) ?? []) {
      if (!isCurrent(status) || partner === id || partner === parent) continue;
      if (own.includes(partner) || result.has(partner)) continue;
      if (stepThrough(ix, parent, unionId, id)) result.set(partner, [partner, parent, id]);
    }
  }
  for (const partners of ix.stepUnions.get(id) ?? []) {
    for (const partner of partners) {
      if (partner === id || own.includes(partner) || result.has(partner)) continue;
      const parent = partners.find((p) => p !== partner && own.includes(p));
      result.set(partner, parent === undefined ? [partner, id] : [partner, parent, id]);
    }
  }
  return result;
}

const hasRepeats = (path: string[]) => new Set(path).size !== path.length;

/** What A is to B when they have a union with each other, from the most binding of their unions. */
function coupleKind(statuses: UnionStatus[]): RelationKind | null {
  if (statuses.length === 0) return null;
  if (statuses.some((s) => s === "married" || s === "widowed")) return "spouse";
  if (statuses.includes("partner")) return "partner";
  if (statuses.includes("engaged")) return "fiance";
  return "exSpouse";
}

/** A's partner is B's blood relative `rel`: what that makes A to B. */
const BY_PARTNER: Partial<Record<RelationKind, RelationKind>> = {
  child: "childInLaw",
  sibling: "siblingInLaw",
  auncle: "auncleByMarriage",
  nibling: "niblingInLaw",
  grandchild: "grandchildInLaw",
};

/** A is a blood relative `rel` of B's partner: what that makes A to B. */
const OF_PARTNER: Partial<Record<RelationKind, RelationKind>> = {
  parent: "parentInLaw",
  sibling: "siblingInLaw",
  nibling: "niblingByMarriage",
  auncle: "auncleInLaw",
  grandparent: "grandparentInLaw",
};

/** The blood relationship's details that by-marriage terms need. */
function carried(rel: Relationship, partnerSex: Relationship["sexOfA"]): Partial<Relationship> {
  const extra: Partial<Relationship> = { greats: rel.greats, partnerSex };
  if (rel.side !== undefined) extra.side = rel.side;
  if (rel.elder !== undefined) extra.elder = rel.elder;
  if (rel.viaSex !== undefined) extra.viaSex = rel.viaSex;
  return extra;
}

function nonBlood(ix: Index, a: string, b: string): Relationship[] {
  const sexOfA = sexOf(ix, a);
  const found: Relationship[] = [];
  const add = (kind: RelationKind, path: string[], extra: Partial<Relationship> = {}) => {
    if (!hasRepeats(path)) found.push({ kind, greats: 0, half: false, sexOfA, path, ...extra });
  };

  const couple = coupleKind(
    (ix.partners.get(a) ?? []).filter((p) => p.id === b).map((p) => p.status),
  );
  if (couple) add(couple, [a, b]);

  const stepOfB = stepParents(ix, b).get(a);
  if (stepOfB) add("stepParent", stepOfB);
  const stepOfA = stepParents(ix, a).get(b);
  if (stepOfA) add("stepChild", stepOfA.toReversed());

  const parentsA = parentsOf(ix, a);
  const parentsB = parentsOf(ix, b);
  if (!parentsA.some((p) => parentsB.includes(p))) {
    for (const [parent, path] of stepParents(ix, b)) {
      if (parentsA.includes(parent)) add("stepSibling", [a, ...path]);
    }
    for (const [parent, path] of stepParents(ix, a)) {
      if (parentsB.includes(parent)) add("stepSibling", [...path.toReversed(), b]);
    }
  }

  // A is a blood relative of B's partner.
  for (const partner of currentPartners(ix, b)) {
    if (partner === a) continue;
    for (const rel of blood(ix, a, partner)) {
      // A child of B's partner is B's stepchild or nothing (see `stepParents`), never an in-law.
      if (rel.kind === "child") continue;
      const kind = OF_PARTNER[rel.kind];
      if (kind) add(kind, [...rel.path, b], carried(rel, sexOf(ix, partner)));
      else add("otherInLaw", [...rel.path, b]);
    }
  }
  // A is the partner of B's blood relative.
  const partnersA = currentPartners(ix, a);
  for (const partner of partnersA) {
    if (partner === b) continue;
    for (const rel of blood(ix, partner, b)) {
      // The partner of B's parent is B's step-parent or nothing, never an in-law.
      if (rel.kind === "parent") continue;
      const kind = BY_PARTNER[rel.kind];
      if (kind) add(kind, [a, ...rel.path], carried(rel, sexOf(ix, partner)));
      else add("otherInLaw", [a, ...rel.path]);
    }
  }
  // A's partner and B's partner are blood relatives.
  for (const partnerA of partnersA) {
    for (const partnerB of currentPartners(ix, b)) {
      if (partnerA === partnerB || partnerA === b || partnerB === a) continue;
      const [rel] = blood(ix, partnerA, partnerB);
      if (rel) add("otherInLaw", [a, ...rel.path, b]);
    }
  }

  // One of each kind, the shortest.
  const byKind = new Map<RelationKind, Relationship>();
  for (const rel of found) {
    const best = byKind.get(rel.kind);
    if (!best || rel.path.length < best.path.length) byKind.set(rel.kind, rel);
  }
  return [...byKind.values()].toSorted(
    (x, y) => x.path.length - y.path.length || ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind),
  );
}

const COUPLE: RelationKind[] = ["spouse", "partner", "fiance", "exSpouse"];

const ORDER: RelationKind[] = [
  ...COUPLE,
  "stepParent",
  "stepChild",
  "stepSibling",
  "parentInLaw",
  "childInLaw",
  "siblingInLaw",
  "auncleByMarriage",
  "niblingByMarriage",
  "auncleInLaw",
  "niblingInLaw",
  "grandparentInLaw",
  "grandchildInLaw",
  "otherInLaw",
];

/**
 * Every distinct relationship of A to B ("A is B's …"), closest first: a marriage or partnership
 * between the two, then blood, then step and in-law, each by path length. `[]` when they are
 * unrelated or either id is unknown. "Other in-law" (a relative by marriage) is listed only when
 * nothing closer connects them. At most `MAX_RESULTS`.
 */
export function relate(doc: TreeDocument, aId: string, bId: string): Relationship[] {
  if (!Object.hasOwn(doc.persons, aId) || !Object.hasOwn(doc.persons, bId)) return [];
  const ix = buildIndex(doc);
  const result = blood(ix, aId, bId);
  if (aId === bId) return result;
  const others = nonBlood(ix, aId, bId);
  const couple = others.filter((r) => COUPLE.includes(r.kind));
  const closer = others.filter((r) => r.kind !== "otherInLaw" && !COUPLE.includes(r.kind));
  const all =
    result.length > 0 || closer.length > 0 || couple.length > 0
      ? [...couple, ...result, ...closer]
      : others;
  return all.slice(0, MAX_RESULTS);
}
