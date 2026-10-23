import type { Draft } from "immer";

import type { Person, TreeDocument, Union } from "@/core/model/types";

import { CommandError } from "./errors";

export function requirePerson(doc: Draft<TreeDocument>, personId: string): Draft<Person> {
  const person = Object.hasOwn(doc.persons, personId) ? doc.persons[personId] : undefined;
  if (!person) throw new CommandError("NOT_FOUND", `Person ${personId} does not exist`);
  return person;
}

export function requireUnion(doc: Draft<TreeDocument>, unionId: string): Draft<Union> {
  const union = Object.hasOwn(doc.unions, unionId) ? doc.unions[unionId] : undefined;
  if (!union) throw new CommandError("NOT_FOUND", `Union ${unionId} does not exist`);
  return union;
}
