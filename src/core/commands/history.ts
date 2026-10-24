import { applyPatches, enablePatches, type Patch } from "immer";

import { UNDO_LIMIT } from "@/config";
import type { TreeDocument } from "@/core/model/types";
import type { EntityChange } from "@/sync/revert";

enablePatches();

export type HistoryEntry = {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  /**
   * Cloud trees: what the edit did, entity by entity, for undo through the room (a revert, see
   * `src/sync/revert`). Patches cannot be used there: others' edits come in between.
   */
  entities?: EntityChange[];
};

/** Two edits as one: each entity's value before the first and after the last. */
function joinEntities(first: EntityChange[] = [], then: EntityChange[] = []): EntityChange[] {
  const joined = new Map(first.map((e) => [e.key, { ...e }]));
  for (const e of then) {
    const earlier = joined.get(e.key);
    joined.set(e.key, earlier ? { ...earlier, after: e.after } : { ...e });
  }
  return [...joined.values()];
}

/** Undo/redo as stacks of immer patches. It never holds a document, only the way between them. */
export class History {
  readonly #limit: number;
  #undoStack: HistoryEntry[] = [];
  #redoStack: HistoryEntry[] = [];

  constructor(limit: number = UNDO_LIMIT) {
    this.#limit = limit;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  /** Records a new edit. Anything that could have been redone is gone. */
  push(entry: HistoryEntry): void {
    this.#redoStack = [];
    this.#undoStack.push(entry);
    if (this.#undoStack.length > this.#limit) this.#undoStack.shift();
  }

  /**
   * Folds `entry` into the latest one, so a single undo reverts both. Used when a confirmed
   * inline edit belongs to the add that opened it. With nothing to amend it is a plain push.
   */
  amend(entry: HistoryEntry): void {
    const last = this.#undoStack.pop();
    if (!last) return this.push(entry);
    this.#redoStack = [];
    this.#undoStack.push({
      label: last.label,
      patches: [...last.patches, ...entry.patches],
      // Undo replays newest first: the amendment is reverted before the original edit.
      inversePatches: [...entry.inversePatches, ...last.inversePatches],
      ...(last.entities || entry.entities
        ? { entities: joinEntities(last.entities, entry.entities) }
        : {}),
    });
  }

  /** Reverts the latest edit. Returns the new document, or null when there is nothing to undo. */
  undo(doc: TreeDocument): TreeDocument | null {
    const entry = this.#undoStack.at(-1);
    if (!entry) return null;
    // Only move the entry once the patches applied, so a failure leaves both stacks intact.
    const next = applyPatches(doc, entry.inversePatches);
    this.#undoStack.pop();
    this.#redoStack.push(entry);
    return next;
  }

  /** Reapplies the latest undone edit. Returns the new document, or null when there is none. */
  redo(doc: TreeDocument): TreeDocument | null {
    const entry = this.#redoStack.at(-1);
    if (!entry) return null;
    const next = applyPatches(doc, entry.patches);
    this.#redoStack.pop();
    this.#undoStack.push(entry);
    return next;
  }

  /** The entry an undo (or redo) would use, without using it. */
  peek(move: "undo" | "redo"): HistoryEntry | null {
    return (move === "undo" ? this.#undoStack : this.#redoStack).at(-1) ?? null;
  }

  /** Moves that entry to the other stack, without applying anything (cloud trees revert it). */
  shift(move: "undo" | "redo"): HistoryEntry | null {
    const [from, to] =
      move === "undo" ? [this.#undoStack, this.#redoStack] : [this.#redoStack, this.#undoStack];
    const entry = from.pop();
    if (entry) to.push(entry);
    return entry ?? null;
  }

  /** Forgets everything that could be redone, e.g. after cancelling an add. */
  dropRedo(): void {
    this.#redoStack = [];
  }

  clear(): void {
    this.#undoStack = [];
    this.#redoStack = [];
  }
}
