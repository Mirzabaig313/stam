import { sameFuzzyDate } from "@/core/dates/fuzzy";
import type { Person, PersonInput } from "@/core/model/types";

import { CommandError } from "./errors";
import { requirePerson, requireUnion } from "./lookup";
import type { Handler } from "./types";
import { insertUnionInOrder } from "./unionOrder";

/** Fields every Person must keep: `undefined` for these means "no change", never "remove". */
const REQUIRED_PERSON_FIELDS: ReadonlySet<string> = new Set([
  "firstName",
  "lastName",
  "gender",
  "isLiving",
]);

/**
 * Applies a patch field by field. An `undefined` value removes the field, except for the
 * `required` ones, which it leaves alone.
 */
function assignPatch(
  target: object,
  patch: object,
  required: ReadonlySet<string> = new Set(),
): void {
  const record = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id") continue;
    if (value !== undefined) record[key] = value;
    else if (!required.has(key)) delete record[key];
  }
}

export function buildPerson(input: PersonInput, id: string): Person {
  const person: Person = {
    id,
    firstName: "",
    lastName: "",
    gender: input.gender,
    isLiving: true,
  };
  assignPatch(person, input, REQUIRED_PERSON_FIELDS);
  return person;
}

export const addPerson: Handler<"addPerson"> = (draft, cmd, ctx) => {
  const person = buildPerson(cmd.person, ctx.newId());
  draft.persons[person.id] = person;
  ctx.created.push(person.id);
  if (draft.rootPersonId === undefined) draft.rootPersonId = person.id;
};

export const updatePerson: Handler<"updatePerson"> = (draft, cmd) => {
  const person = requirePerson(draft, cmd.personId);
  const { patch } = cmd;
  const namesPlaceholder =
    person.isPlaceholder === true &&
    !("isPlaceholder" in patch) &&
    [patch.firstName, patch.lastName].some((name) => name !== undefined && name.trim() !== "");
  assignPatch(person, patch, REQUIRED_PERSON_FIELDS);
  if (namesPlaceholder) delete person.isPlaceholder;
};

export const updateUnion: Handler<"updateUnion"> = (draft, cmd) => {
  const union = requireUnion(draft, cmd.unionId);
  const { status, ...dates } = cmd.patch;
  const oldStart = union.start && { ...union.start };
  if (status !== undefined) union.status = status;
  assignPatch(union, dates);
  if (!sameFuzzyDate(oldStart, union.start)) {
    // FR-R9: unions are ordered by start date, so reposition this one for each partner.
    for (const partnerId of union.partners) {
      const order = draft.unionOrder[partnerId];
      const at = order?.indexOf(union.id) ?? -1;
      if (order && at >= 0) order.splice(at, 1);
      insertUnionInOrder(draft, partnerId, union.id);
    }
  }
};

export const setRoot: Handler<"setRoot"> = (draft, cmd) => {
  requirePerson(draft, cmd.personId);
  draft.rootPersonId = cmd.personId;
};

export const renameTree: Handler<"renameTree"> = (draft, cmd) => {
  const name = cmd.name.trim();
  if (name === "") throw new CommandError("INVALID", "A tree needs a name");
  draft.name = name;
};
