// The sample family the landing page builds, chapter by chapter, with the real commands.
// Every person and union gets a stable key, because the engine's ids are random and the
// prerendered HTML must match what the browser computes.

import { applyCommand } from "@/core/commands/apply";
import type { Command } from "@/core/commands/types";
import { createTree } from "@/core/model/tree";
import type {
  ChildType,
  FuzzyDate,
  Gender,
  PersonInput,
  TreeDocument,
  UnionStatus,
} from "@/core/model/types";

/** A fixed clock: the same document on the server and in the browser. */
const STAMP = new Date("2026-10-23T00:00:00Z");

const year = (y: number): FuzzyDate => ({ year: y });

type PersonSpec = {
  first: string;
  last: string;
  gender: Gender;
  born: number;
  died?: number;
};

/** Invented people. The page labels them as a sample family. */
export const PEOPLE = {
  ada: { first: "Ada", last: "Linden", gender: "female", born: 1921, died: 2009 },
  tomas: { first: "Tomas", last: "Linden", gender: "male", born: 1918, died: 1994 },
  clara: { first: "Clara", last: "Haddad", gender: "female", born: 1946 },
  henrik: { first: "Henrik", last: "Linden", gender: "male", born: 1949 },
  ines: { first: "Ines", last: "Linden", gender: "female", born: 1953 },
  omar: { first: "Omar", last: "Haddad", gender: "male", born: 1944, died: 2021 },
  mei: { first: "Mei", last: "Tanaka", gender: "female", born: 1951 },
  noor: { first: "Noor", last: "Haddad", gender: "female", born: 1972 },
  adam: { first: "Adam", last: "Haddad", gender: "male", born: 1975 },
  sami: { first: "Sami", last: "Linden", gender: "male", born: 1978 },
  hana: { first: "Hana", last: "Okafor", gender: "female", born: 1979 },
  lena: { first: "Lena", last: "Linden", gender: "female", born: 2004 },
  elif: { first: "Elif", last: "Demir", gender: "female", born: 1981 },
  theo: { first: "Theo", last: "Linden", gender: "male", born: 2013 },
} as const satisfies Record<string, PersonSpec>;

export type PersonKey = keyof typeof PEOPLE;

/** One step of the story: a command in terms of keys, plus the key of the person it creates. */
type Step =
  | { kind: "root"; key: PersonKey }
  | { kind: "spouse"; key: PersonKey; of: PersonKey; status?: UnionStatus; since?: number }
  | { kind: "child"; key: PersonKey; of: [PersonKey, PersonKey]; type?: ChildType }
  | { kind: "status"; of: [PersonKey, PersonKey]; status: UnionStatus; until?: number };

export type ChapterSpec = { steps: Step[] };

/** I one person, II a spouse, III children, IV grandchildren, V remarriage and adoption. */
export const CHAPTER_STEPS: ChapterSpec[] = [
  { steps: [{ kind: "root", key: "ada" }] },
  { steps: [{ kind: "spouse", key: "tomas", of: "ada", since: 1944 }] },
  {
    steps: [
      { kind: "child", key: "clara", of: ["ada", "tomas"] },
      { kind: "child", key: "henrik", of: ["ada", "tomas"] },
      { kind: "child", key: "ines", of: ["ada", "tomas"] },
    ],
  },
  {
    steps: [
      { kind: "spouse", key: "omar", of: "clara", since: 1970 },
      { kind: "spouse", key: "mei", of: "henrik", since: 1976 },
      { kind: "child", key: "noor", of: ["clara", "omar"] },
      { kind: "child", key: "adam", of: ["clara", "omar"] },
      { kind: "child", key: "sami", of: ["henrik", "mei"] },
    ],
  },
  {
    steps: [
      { kind: "spouse", key: "hana", of: "sami", since: 2002 },
      { kind: "child", key: "lena", of: ["sami", "hana"] },
      { kind: "status", of: ["sami", "hana"], status: "divorced", until: 2008 },
      { kind: "spouse", key: "elif", of: "sami", since: 2011 },
      { kind: "child", key: "theo", of: ["sami", "elif"], type: "adopted" },
    ],
  },
];

export type SampleDoc = {
  doc: TreeDocument;
  /** key -> engine person id, and back. */
  ids: Record<string, string>;
  keyOf: Record<string, string>;
  /** engine union id -> stable union key ("ada+tomas"). */
  unionKeyOf: Record<string, string>;
};

function personInput(key: PersonKey): PersonInput {
  const p: PersonSpec = PEOPLE[key];
  const input: PersonInput = {
    firstName: p.first,
    lastName: p.last,
    gender: p.gender,
    isLiving: p.died === undefined,
    birth: { date: year(p.born) },
  };
  if (p.died !== undefined) input.death = { date: year(p.died) };
  return input;
}

const unionKey = (a: string, b: string) => [a, b].toSorted().join("+");

function unionIdOf(state: SampleDoc, [a, b]: [PersonKey, PersonKey]): string {
  const id = Object.entries(state.unionKeyOf).find(([, k]) => k === unionKey(a, b))?.[0];
  if (!id) throw new Error(`No union for ${a} and ${b}`);
  return id;
}

function toCommand(state: SampleDoc, step: Step): Command {
  const id = (key: PersonKey) => state.ids[key]!;
  switch (step.kind) {
    case "root":
      return { type: "addPerson", person: personInput(step.key) };
    case "spouse":
      return {
        type: "addSpouse",
        personId: id(step.of),
        spouse: personInput(step.key),
        status: step.status ?? "married",
      };
    case "child":
      return {
        type: "addChild",
        parentId: id(step.of[0]),
        unionId: unionIdOf(state, step.of),
        child: personInput(step.key),
        childType: step.type ?? "biological",
      };
    case "status": {
      const patch: { status: UnionStatus; end?: FuzzyDate } = { status: step.status };
      if (step.until !== undefined) patch.end = year(step.until);
      return { type: "updateUnion", unionId: unionIdOf(state, step.of), patch };
    }
  }
}

function apply(state: SampleDoc, step: Step): SampleDoc {
  const result = applyCommand(state.doc, toCommand(state, step), STAMP);
  let next: SampleDoc = { ...state, doc: result.doc };
  if (step.kind !== "status") {
    const created = result.createdIds[0]!;
    next = {
      ...next,
      ids: { ...next.ids, [step.key]: created },
      keyOf: { ...next.keyOf, [created]: step.key },
    };
  }
  // Name every new union after its partners, so edges get stable ids.
  const unionKeyOf = { ...next.unionKeyOf };
  for (const union of Object.values(next.doc.unions)) {
    if (unionKeyOf[union.id]) continue;
    const [a, b] = union.partners.map((p) => next.keyOf[p]!);
    unionKeyOf[union.id] = b === undefined ? a! : unionKey(a!, b);
  }
  next = { ...next, unionKeyOf };
  if (step.kind === "spouse" && step.since !== undefined) {
    const result2 = applyCommand(
      next.doc,
      {
        type: "updateUnion",
        unionId: unionIdOf(next, [step.of, step.key]),
        patch: { start: year(step.since) },
      },
      STAMP,
    );
    next = { ...next, doc: result2.doc };
  }
  return next;
}

/** The document at the end of each chapter, built with applyCommand only. */
export function buildChapterDocs(): SampleDoc[] {
  let state: SampleDoc = {
    doc: { ...createTree("The Linden family", STAMP), id: "sample" },
    ids: {},
    keyOf: {},
    unionKeyOf: {},
  };
  const docs: SampleDoc[] = [];
  for (const chapter of CHAPTER_STEPS) {
    for (const step of chapter.steps) state = apply(state, step);
    docs.push(state);
  }
  return docs;
}

export type SamplePerson = {
  key: PersonKey;
  name: string;
  first: string;
  initials: string;
  gender: Gender;
  born: number;
  died?: number;
};

export function samplePerson(key: string): SamplePerson {
  const p: PersonSpec = PEOPLE[key as PersonKey];
  const person: SamplePerson = {
    key: key as PersonKey,
    name: `${p.first} ${p.last}`,
    first: p.first,
    initials: `${p.first[0]}${p.last[0]}`,
    gender: p.gender,
    born: p.born,
  };
  if (p.died !== undefined) person.died = p.died;
  return person;
}
