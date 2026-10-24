import type { Draft, Patch } from "immer";

import type {
  ChildType,
  Person,
  PersonInput,
  TreeDocument,
  Union,
  UnionStatus,
} from "@/core/model/types";

export type Command =
  | { type: "addPerson"; person: PersonInput }
  | { type: "updatePerson"; personId: string; patch: Partial<Omit<Person, "id">> }
  | {
      type: "updateUnion";
      unionId: string;
      patch: Partial<Pick<Union, "status" | "start" | "end">>;
    }
  | { type: "setRoot"; personId: string }
  | { type: "renameTree"; name: string }
  | {
      type: "addChild";
      parentId: string;
      unionId?: string;
      child: PersonInput;
      childType?: ChildType;
    }
  | { type: "addSpouse"; personId: string; spouse: PersonInput; status?: UnionStatus }
  | { type: "addParent"; childId: string; parent: PersonInput }
  /**
   * A new generation between a person and their parents: the new person takes the child's place
   * in its parent union (same position, same child type) and the child becomes the new person's
   * biological child. Without a parent union it is `addParent`.
   */
  | { type: "insertParent"; childId: string; parent: PersonInput; unionId?: string }
  | { type: "addSibling"; personId: string; sibling: PersonInput }
  | { type: "reorderChild"; unionId: string; personId: string; toIndex: number }
  | { type: "setChildType"; unionId: string; personId: string; childType: ChildType }
  | { type: "relinkAsChild"; personId: string; parentId: string; unionId?: string }
  | { type: "relinkAsSpouse"; personId: string; targetId: string }
  | { type: "relinkAsParent"; personId: string; childId: string }
  | { type: "deletePerson"; personId: string; mode: "person" | "withDescendants" };

export type CommandResult = {
  doc: TreeDocument;
  patches: Patch[];
  inversePatches: Patch[];
  /** Ids of the persons the command created, the one the user asked for first. */
  createdIds: string[];
};

export type HandlerContext = {
  created: string[];
  /** Where new person and union ids come from (see `ApplyOptions.opId`). */
  newId: () => string;
};

export type ApplyOptions = {
  /** Becomes the document's `updatedAt`; defaults to now. */
  now?: Date;
  /**
   * The op this command belongs to. With it, new ids derive from the op id (`opIdSource`), so
   * every machine that applies the op creates the same ids.
   */
  opId?: string;
};

export type Handler<T extends Command["type"]> = (
  draft: Draft<TreeDocument>,
  cmd: Extract<Command, { type: T }>,
  ctx: HandlerContext,
) => void;
