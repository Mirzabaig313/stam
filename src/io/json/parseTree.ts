import type { FuzzyDate } from "@/core/dates/fuzzy";
import { withRoot } from "@/core/model/tree";
import type { Person, TreeDocument, Union } from "@/core/model/types";
import { validate } from "@/core/model/validate";

import { ImportError } from "./errors";
import {
  CURRENT_SCHEMA_VERSION,
  migrations as defaultMigrations,
  type TreeMigration,
} from "./migrations";

/**
 * Turns untrusted data (an imported file or a stored record) into a valid `TreeDocument`:
 * migrate to the current schema, check every field's type by hand, rebuild the document from the
 * checked fields only, then run `validate()`. Throws `ImportError` (`INVALID_TREE` or
 * `FUTURE_VERSION`); never returns an unchecked value and never mutates `raw`.
 */
export function parseTreeDocument(
  raw: unknown,
  opts: { migrations?: Record<number, TreeMigration> } = {},
): TreeDocument {
  if (!isRecord(raw)) throw invalid("The tree is not an object");

  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw invalid("The tree has no valid schema version");
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ImportError(
      "FUTURE_VERSION",
      `This tree was made by a newer version of the app (schema ${version})`,
    );
  }

  const table = opts.migrations ?? defaultMigrations;
  let tree: Record<string, unknown> = raw;
  for (let from = version; from < CURRENT_SCHEMA_VERSION; from++) {
    const step = Object.hasOwn(table, from) ? table[from] : undefined;
    if (!step) throw invalid(`No migration from schema ${from}`);
    try {
      tree = { ...step(tree), schemaVersion: from + 1 };
    } catch {
      throw invalid(`The migration from schema ${from} failed`);
    }
  }

  const doc = withRoot(readTree(tree));

  let issues: ReturnType<typeof validate>;
  try {
    issues = validate(doc);
  } catch {
    throw invalid("The tree could not be validated");
  }
  if (issues.length > 0) throw invalid(issues.map((issue) => issue.message).join("; "));
  return doc;
}

/** Ids become object keys, so they must be plain and never name a built-in property. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value) && !(value in Object.prototype);
}

/**
 * A key JS objects order before all others, in numeric order ("7", "123"), whatever the insertion
 * order. Rust keeps insertion order, so shared trees and commands never use such ids.
 */
export function isIndexKey(value: string): boolean {
  return /^(0|[1-9][0-9]{0,9})$/.test(value) && Number(value) <= 4294967294;
}

/** An id that may be used in a shared (cloud) tree: safe, and ordered the same in JS and Rust. */
export function isSharedId(value: unknown): value is string {
  return isSafeId(value) && !isIndexKey(value);
}

function invalid(message: string): ImportError {
  return new ImportError("INVALID_TREE", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readId(value: unknown, what: string): string {
  if (!isSafeId(value)) throw invalid(`${what} is not a valid id`);
  return value;
}

function readString(value: unknown, what: string): string {
  if (typeof value !== "string") throw invalid(`${what} is not a string`);
  return value;
}

function readOptional<T>(value: unknown, read: (v: unknown) => T): T | undefined {
  return value === undefined ? undefined : read(value);
}

function readInt(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw invalid(`${what} is not a whole number`);
  return value;
}

function readOneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw invalid(`${what} is not one of ${allowed.join(", ")}`);
  }
  return value as T;
}

/** Drops keys whose value is undefined, so optional fields are absent rather than undefined. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function readRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${what} is malformed`);
  return value;
}

function readFuzzyDate(value: unknown, what: string): FuzzyDate {
  const v = readRecord(value, what);
  return compact({
    qualifier: readOptional(v.qualifier, (q) =>
      readOneOf(q, ["about", "before", "after", "between"] as const, `${what} qualifier`),
    ),
    year: readOptional(v.year, (n) => readInt(n, `${what} year`)),
    month: readOptional(v.month, (n) => readInt(n, `${what} month`)),
    day: readOptional(v.day, (n) => readInt(n, `${what} day`)),
    toYear: readOptional(v.toYear, (n) => readInt(n, `${what} toYear`)),
  });
}

function readEvent(value: unknown, what: string): { date?: FuzzyDate; place?: string } {
  const v = readRecord(value, what);
  return compact({
    date: readOptional(v.date, (d) => readFuzzyDate(d, `${what} date`)),
    place: readOptional(v.place, (p) => readString(p, `${what} place`)),
  });
}

function readPerson(key: string, value: unknown): Person {
  const what = `Person ${key}`;
  const v = readRecord(value, what);
  if (readId(v.id, `${what} id`) !== key) throw invalid(`${what} has a different id from its key`);
  if (typeof v.isLiving !== "boolean") throw invalid(`${what} isLiving is not a boolean`);
  return compact<Person>({
    id: key,
    firstName: readString(v.firstName, `${what} firstName`),
    lastName: readString(v.lastName, `${what} lastName`),
    nickname: readOptional(v.nickname, (s) => readString(s, `${what} nickname`)),
    nativeName: readOptional(v.nativeName, (s) => readString(s, `${what} nativeName`)),
    gender: readOneOf(v.gender, ["male", "female"] as const, `${what} gender`),
    isPlaceholder: readOptional(v.isPlaceholder, (b) => {
      if (typeof b !== "boolean") throw invalid(`${what} isPlaceholder is not a boolean`);
      return b;
    }),
    isLiving: v.isLiving,
    birth: readOptional(v.birth, (e) => readEvent(e, `${what} birth`)),
    death: readOptional(v.death, (e) => readEvent(e, `${what} death`)),
    photoId: readOptional(v.photoId, (id) => readId(id, `${what} photoId`)),
    notes: readOptional(v.notes, (s) => readString(s, `${what} notes`)),
  });
}

function readUnion(key: string, value: unknown): Union {
  const what = `Union ${key}`;
  const v = readRecord(value, what);
  if (readId(v.id, `${what} id`) !== key) throw invalid(`${what} has a different id from its key`);
  if (!Array.isArray(v.partners) || v.partners.length < 1 || v.partners.length > 2) {
    throw invalid(`${what} must have one or two partners`);
  }
  const partners = v.partners.map((p) => readId(p, `${what} partner`));
  if (!Array.isArray(v.children)) throw invalid(`${what} children is not a list`);
  const children = v.children.map((child) => {
    const c = readRecord(child, `${what} child`);
    return {
      personId: readId(c.personId, `${what} child id`),
      type: readOneOf(
        c.type,
        ["biological", "adopted", "step", "foster"] as const,
        `${what} child type`,
      ),
    };
  });
  return compact<Union>({
    id: key,
    partners: partners as Union["partners"],
    status: readOneOf(
      v.status,
      ["married", "partner", "engaged", "divorced", "separated", "widowed"] as const,
      `${what} status`,
    ),
    start: readOptional(v.start, (d) => readFuzzyDate(d, `${what} start`)),
    end: readOptional(v.end, (d) => readFuzzyDate(d, `${what} end`)),
    children,
  });
}

/** Rebuilds a document from checked fields only; unknown fields are dropped. */
function readTree(tree: Record<string, unknown>): TreeDocument {
  if (tree.schemaVersion !== CURRENT_SCHEMA_VERSION)
    throw invalid("The tree has the wrong schema version");

  const persons: Record<string, Person> = {};
  for (const [key, value] of Object.entries(readRecord(tree.persons, "The people"))) {
    persons[readId(key, "A person key")] = readPerson(key, value);
  }

  const unions: Record<string, Union> = {};
  for (const [key, value] of Object.entries(readRecord(tree.unions, "The unions"))) {
    unions[readId(key, "A union key")] = readUnion(key, value);
  }

  const unionOrder: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(readRecord(tree.unionOrder, "The union order"))) {
    if (!Array.isArray(value)) throw invalid(`The union order of ${key} is not a list`);
    unionOrder[readId(key, "A union order key")] = value.map((id) =>
      readId(id, "A union order entry"),
    );
  }

  const settings = readRecord(tree.settings, "The tree settings");
  return compact<TreeDocument>({
    id: readString(tree.id, "The tree id"),
    name: readString(tree.name, "The tree name"),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootPersonId: readOptional(tree.rootPersonId, (id) => readId(id, "The root person id")),
    persons,
    unions,
    unionOrder,
    settings: {
      theme: readString(settings.theme, "The theme"),
      colorMode: readString(settings.colorMode, "The color mode"),
      direction: readOneOf(settings.direction, ["ltr", "rtl"] as const, "The direction"),
    },
    createdAt: readString(tree.createdAt, "createdAt"),
    updatedAt: readString(tree.updatedAt, "updatedAt"),
  });
}
