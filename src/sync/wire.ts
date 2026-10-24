import { CommandError } from "@/core/commands/errors";
import type { Command } from "@/core/commands/types";
import type { FuzzyDate } from "@/core/dates/fuzzy";
import type { ChildType, Person, PersonInput, Union, UnionStatus } from "@/core/model/types";
import { isSafeId } from "@/io/json/parseTree";

// Commands travel as JSON, which has no `undefined`. In a patch, "remove this field" is
// `undefined`, so it is sent as `null` and read back as `undefined`. The Rust room reads the same
// shape and refuses what `decodeCommand` refuses.

/** A JSON-safe copy of the command: patch removals become null, other undefined fields go. */
export function encodeCommand(cmd: Command): unknown {
  if (cmd.type === "updatePerson" || cmd.type === "updateUnion") {
    const patch = Object.fromEntries(
      Object.entries(cmd.patch).map(([k, v]) => [k, v === undefined ? null : v]),
    );
    return JSON.parse(JSON.stringify({ ...cmd, patch }));
  }
  return JSON.parse(JSON.stringify(cmd));
}

const GENDERS = ["male", "female"] as const;
const STATUSES = ["married", "partner", "engaged", "divorced", "separated", "widowed"] as const;
const CHILD_TYPES = ["biological", "adopted", "step", "foster"] as const;
const QUALIFIERS = ["about", "before", "after", "between"] as const;
const MODES = ["person", "withDescendants"] as const;

function bad(what: string): CommandError {
  return new CommandError("INVALID", `The command's ${what} is malformed`);
}

type Obj = Record<string, unknown>;

function obj(value: unknown, what: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw bad(what);
  return value as Obj;
}

function id(value: unknown, what: string): string {
  if (!isSafeId(value)) throw bad(what);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string") throw bad(what);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") throw bad(what);
  return value;
}

function int(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw bad(what);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw bad(what);
  return value as T;
}

/** Absent and null optional fields are both "not given". */
function opt<T>(value: unknown, read: (v: unknown) => T): T | undefined {
  return value === undefined || value === null ? undefined : read(value);
}

/** Copies only the defined fields, so the result has no undefined keys. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function fuzzyDate(value: unknown, what: string): FuzzyDate {
  const v = obj(value, what);
  return compact({
    qualifier: opt(v.qualifier, (q) => oneOf(q, QUALIFIERS, what)),
    year: opt(v.year, (n) => int(n, what)),
    month: opt(v.month, (n) => int(n, what)),
    day: opt(v.day, (n) => int(n, what)),
    toYear: opt(v.toYear, (n) => int(n, what)),
  });
}

function event(value: unknown, what: string): { date?: FuzzyDate; place?: string } {
  const v = obj(value, what);
  return compact({
    date: opt(v.date, (d) => fuzzyDate(d, what)),
    place: opt(v.place, (p) => str(p, what)),
  });
}

/** Readers for each person field (never `id`: commands do not choose ids). */
const PERSON_FIELDS: Record<keyof Omit<Person, "id">, (v: unknown) => unknown> = {
  firstName: (v) => str(v, "firstName"),
  lastName: (v) => str(v, "lastName"),
  nickname: (v) => str(v, "nickname"),
  nativeName: (v) => str(v, "nativeName"),
  gender: (v) => oneOf(v, GENDERS, "gender"),
  isPlaceholder: (v) => bool(v, "isPlaceholder"),
  isLiving: (v) => bool(v, "isLiving"),
  birth: (v) => event(v, "birth"),
  death: (v) => event(v, "death"),
  photoId: (v) => id(v, "photoId"),
  notes: (v) => str(v, "notes"),
};

function personInput(value: unknown): PersonInput {
  const v = obj(value, "person");
  const out: Obj = {};
  for (const [key, read] of Object.entries(PERSON_FIELDS)) {
    const field = opt(v[key], read);
    if (field !== undefined) out[key] = field;
  }
  if (out.gender === undefined) throw bad("gender");
  return out as PersonInput;
}

/** A patch keeps null fields as present-but-undefined: that is what removes them. */
function patchOf(value: unknown, readers: Record<string, (v: unknown) => unknown>): Obj {
  const v = obj(value, "patch");
  const out: Obj = {};
  for (const [key, read] of Object.entries(readers)) {
    if (!Object.hasOwn(v, key) || v[key] === undefined) continue;
    out[key] = v[key] === null ? undefined : read(v[key]);
  }
  return out;
}

const UNION_PATCH: Record<keyof Pick<Union, "status" | "start" | "end">, (v: unknown) => unknown> =
  {
    status: (v) => oneOf<UnionStatus>(v, STATUSES, "status"),
    start: (v) => fuzzyDate(v, "start"),
    end: (v) => fuzzyDate(v, "end"),
  };

const childType = (v: unknown) => oneOf<ChildType>(v, CHILD_TYPES, "childType");

/**
 * Reads a command from untrusted JSON: checks every field it uses, drops unknown fields, turns
 * patch nulls back into removals. Throws CommandError INVALID.
 */
export function decodeCommand(raw: unknown): Command {
  const c = obj(raw, "body");
  const optId = (key: string) => opt(c[key], (v) => id(v, key));
  switch (c.type) {
    case "addPerson":
      return { type: "addPerson", person: personInput(c.person) };
    case "updatePerson": {
      const patch = patchOf(c.patch, PERSON_FIELDS);
      return { type: "updatePerson", personId: id(c.personId, "personId"), patch };
    }
    case "updateUnion": {
      const patch = patchOf(c.patch, UNION_PATCH);
      if (Object.hasOwn(patch, "status") && patch.status === undefined) delete patch.status;
      return { type: "updateUnion", unionId: id(c.unionId, "unionId"), patch };
    }
    case "setRoot":
      return { type: "setRoot", personId: id(c.personId, "personId") };
    case "renameTree":
      return { type: "renameTree", name: str(c.name, "name") };
    case "addChild":
      return compact({
        type: "addChild" as const,
        parentId: id(c.parentId, "parentId"),
        unionId: optId("unionId"),
        child: personInput(c.child),
        childType: opt(c.childType, childType),
      });
    case "addSpouse":
      return compact({
        type: "addSpouse" as const,
        personId: id(c.personId, "personId"),
        spouse: personInput(c.spouse),
        status: opt(c.status, (v) => oneOf<UnionStatus>(v, STATUSES, "status")),
      });
    case "addParent":
      return {
        type: "addParent",
        childId: id(c.childId, "childId"),
        parent: personInput(c.parent),
      };
    case "insertParent":
      return compact({
        type: "insertParent" as const,
        childId: id(c.childId, "childId"),
        parent: personInput(c.parent),
        unionId: optId("unionId"),
      });
    case "addSibling":
      return {
        type: "addSibling",
        personId: id(c.personId, "personId"),
        sibling: personInput(c.sibling),
      };
    case "reorderChild":
      if (typeof c.toIndex !== "number") throw bad("toIndex");
      return {
        type: "reorderChild",
        unionId: id(c.unionId, "unionId"),
        personId: id(c.personId, "personId"),
        toIndex: c.toIndex,
      };
    case "setChildType":
      return {
        type: "setChildType",
        unionId: id(c.unionId, "unionId"),
        personId: id(c.personId, "personId"),
        childType: childType(c.childType),
      };
    case "relinkAsChild":
      return compact({
        type: "relinkAsChild" as const,
        personId: id(c.personId, "personId"),
        parentId: id(c.parentId, "parentId"),
        unionId: optId("unionId"),
      });
    case "relinkAsSpouse":
      return {
        type: "relinkAsSpouse",
        personId: id(c.personId, "personId"),
        targetId: id(c.targetId, "targetId"),
      };
    case "relinkAsParent":
      return {
        type: "relinkAsParent",
        personId: id(c.personId, "personId"),
        childId: id(c.childId, "childId"),
      };
    case "deletePerson":
      return {
        type: "deletePerson",
        personId: id(c.personId, "personId"),
        mode: oneOf(c.mode, MODES, "mode"),
      };
    default:
      throw bad("type");
  }
}
