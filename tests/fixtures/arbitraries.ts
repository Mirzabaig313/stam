import * as fc from "fast-check";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import type { Command } from "@/core/commands/types";
import { createTree, unionsOf } from "@/core/model/tree";
import type { ChildType, PersonInput, TreeDocument, UnionStatus } from "@/core/model/types";

/** Number of property-test runs: 1000 by default, `bun run verify` sets 10000. */
export function runs(): number {
  return Number(process.env.PROPERTY_RUNS ?? 1000);
}

const STAMP = new Date("2026-01-01T00:00:00.000Z");

export type OpKind =
  | "addChild"
  | "addSpouse"
  | "addParent"
  | "addSibling"
  | "reorderChild"
  | "relinkAsChild"
  | "relinkAsSpouse"
  | "relinkAsParent"
  | "setChildType"
  | "deletePerson"
  | "addPerson"
  | "updatePerson"
  | "updateUnion"
  | "setRoot"
  | "renameTree";

/**
 * An abstract command. Its numbers are selectors, resolved against the document the op is
 * replayed on, so shrinking works even though real ids are random.
 */
export type FamilyOp = {
  kind: OpKind;
  a: number;
  b: number;
  c: number;
  flag: boolean;
  /** Birth year for people the op creates; undefined means no date. */
  year: number | undefined;
};

/** The commands that build families. */
export const BUILD_KINDS: readonly OpKind[] = [
  "addChild",
  "addSpouse",
  "addParent",
  "addSibling",
  "reorderChild",
  "relinkAsChild",
  "relinkAsSpouse",
  "relinkAsParent",
  "setChildType",
  "deletePerson",
];

export const ALL_KINDS: readonly OpKind[] = [
  ...BUILD_KINDS,
  "addPerson",
  "updatePerson",
  "updateUnion",
  "setRoot",
  "renameTree",
];

const WEIGHTS: Record<OpKind, number> = {
  addChild: 8,
  addSpouse: 4,
  addParent: 3,
  addSibling: 3,
  reorderChild: 3,
  relinkAsChild: 3,
  relinkAsSpouse: 2,
  relinkAsParent: 2,
  setChildType: 2,
  deletePerson: 2,
  addPerson: 1,
  updatePerson: 2,
  updateUnion: 1,
  setRoot: 1,
  renameTree: 1,
};

/** Picks op kinds by weight, so deletes do not dominate. */
export function arbOp(kinds: readonly OpKind[] = BUILD_KINDS): fc.Arbitrary<FamilyOp> {
  const kind = fc.oneof(
    ...kinds.map((k) => ({ weight: WEIGHTS[k], arbitrary: fc.constant<OpKind>(k) })),
  );
  return fc.record({
    kind,
    a: fc.nat(1000),
    b: fc.nat(1000),
    c: fc.nat(1000),
    flag: fc.boolean(),
    year: fc.option(fc.integer({ min: 1900, max: 2000 }), { nil: undefined }),
  });
}

const pick = <T>(items: readonly T[], n: number): T => items[n % items.length]!;

const STATUSES: UnionStatus[] = [
  "married",
  "partner",
  "engaged",
  "divorced",
  "separated",
  "widowed",
];

function childTypeOf(n: number): ChildType {
  return (["biological", "biological", "biological", "adopted", "step", "foster"] as const)[n % 6]!;
}

function personInput(op: FamilyOp): PersonInput {
  return {
    gender: op.flag ? "male" : "female",
    firstName: `P${op.a}`,
    ...(op.year === undefined ? {} : { birth: { date: { year: op.year } } }),
  };
}

/** Maps an op to a real command on `doc`, or null when `doc` has nothing it could apply to. */
export function resolveOp(doc: TreeDocument, op: FamilyOp): Command | null {
  const people = Object.keys(doc.persons);
  if (people.length === 0) {
    return op.kind === "renameTree"
      ? { type: "renameTree", name: `Tree ${op.a}` }
      : { type: "addPerson", person: personInput(op) };
  }
  const a = pick(people, op.a);
  const b = pick(people, op.b);
  // Mostly name a union explicitly, sometimes leave it out to exercise AMBIGUOUS_UNION.
  const unionOf = (personId: string): string | undefined => {
    const unions = unionsOf(doc, personId);
    return unions.length > 0 && op.c % 4 !== 0 ? pick(unions, op.c).id : undefined;
  };
  const unionsWithChildren = Object.values(doc.unions).filter((u) => u.children.length > 0);

  switch (op.kind) {
    case "addChild":
      return {
        type: "addChild",
        parentId: a,
        unionId: unionOf(a),
        child: personInput(op),
        childType: childTypeOf(op.b),
      };
    case "addSpouse":
      return {
        type: "addSpouse",
        personId: a,
        spouse: personInput(op),
        status: op.c % 3 === 0 ? pick(STATUSES, op.b) : undefined,
      };
    case "addParent":
      return { type: "addParent", childId: a, parent: personInput(op) };
    case "addSibling":
      return { type: "addSibling", personId: a, sibling: personInput(op) };
    case "reorderChild": {
      if (unionsWithChildren.length === 0) return null;
      const union = pick(unionsWithChildren, op.a);
      return {
        type: "reorderChild",
        unionId: union.id,
        personId: pick(union.children, op.b).personId,
        toIndex: (op.c % (union.children.length + 2)) - 1,
      };
    }
    case "relinkAsChild":
      return { type: "relinkAsChild", personId: a, parentId: b, unionId: unionOf(b) };
    case "relinkAsSpouse":
      return { type: "relinkAsSpouse", personId: a, targetId: b };
    case "relinkAsParent":
      return { type: "relinkAsParent", personId: a, childId: b };
    case "setChildType": {
      if (unionsWithChildren.length === 0) return null;
      const union = pick(unionsWithChildren, op.a);
      return {
        type: "setChildType",
        unionId: union.id,
        personId: pick(union.children, op.b).personId,
        childType: childTypeOf(op.c),
      };
    }
    case "deletePerson":
      return { type: "deletePerson", personId: a, mode: op.flag ? "withDescendants" : "person" };
    case "addPerson":
      return { type: "addPerson", person: personInput(op) };
    case "updatePerson":
      return {
        type: "updatePerson",
        personId: a,
        patch: op.c % 2 === 0 ? { firstName: `Name${op.b}` } : { isLiving: op.flag, notes: "n" },
      };
    case "updateUnion": {
      const unions = Object.values(doc.unions);
      if (unions.length === 0) return null;
      return {
        type: "updateUnion",
        unionId: pick(unions, op.a).id,
        patch: {
          status: pick(STATUSES, op.b),
          start: op.year === undefined ? undefined : { year: op.year },
        },
      };
    }
    case "setRoot":
      return { type: "setRoot", personId: a };
    case "renameTree":
      return { type: "renameTree", name: `Tree ${op.a}` };
  }
}

/**
 * Applies a command; returns null when it is rejected with an ordinary CommandError. A command
 * that leaves an invalid document (the debug guard, which sets `issues`) is a real bug, so it
 * is rethrown for the property test to report and shrink.
 */
export function tryApply(doc: TreeDocument, cmd: Command) {
  try {
    return applyCommand(doc, cmd, STAMP);
  } catch (e) {
    if (e instanceof CommandError && e.issues === undefined) return null;
    throw e;
  }
}

/** How many commands of each type were actually applied. */
export type AppliedCounts = Partial<Record<Command["type"], number>>;

/**
 * Replays ops on a fresh one-person tree, skipping commands that are rejected. `applied`, when
 * given, is incremented per command type for every command that went through.
 */
export function buildFamily(ops: readonly FamilyOp[], applied?: AppliedCounts): TreeDocument {
  let doc = createTree("Random family", STAMP);
  doc = tryApply(doc, { type: "addPerson", person: { gender: "male", firstName: "Root" } })!.doc;
  for (const op of ops) {
    const cmd = resolveOp(doc, op);
    const result = cmd && tryApply(doc, cmd);
    if (result) {
      doc = result.doc;
      if (applied && cmd) applied[cmd.type] = (applied[cmd.type] ?? 0) + 1;
    }
  }
  return doc;
}

/** The op list behind `arbFamily`, for shrinking and for replaying with History. */
export function arbFamilyOps(opts: { maxOps?: number } = {}): fc.Arbitrary<FamilyOp[]> {
  return fc.array(arbOp(BUILD_KINDS), { maxLength: opts.maxOps ?? 60, size: "max" });
}

export function arbFamily(opts: { maxOps?: number } = {}): fc.Arbitrary<TreeDocument> {
  return arbFamilyOps(opts).map(buildFamily);
}
