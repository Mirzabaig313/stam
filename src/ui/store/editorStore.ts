import { createStore, type StoreApi } from "zustand/vanilla";

import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import { History } from "@/core/commands/history";
import type { Command, CommandResult } from "@/core/commands/types";
import { layoutFamily } from "@/core/layout/family";
import type { LayoutResult } from "@/core/layout/types";
import { ancestorsOf, partnersOf, topmostAncestor } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import type { Autosaver } from "@/storage/autosave";
import type { Journal } from "@/storage/journal";
import type { SaveGuard } from "@/storage/saveGuard";
import type { TreeRepo } from "@/storage/treeRepo";

/** While edits keep arriving, the tree is snapshotted at most this often. */
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

export type EditingRole = "first" | "child" | "spouse" | "parent" | "sibling";

export type EditorState = {
  /** `loading` until `load` settles; `failed` when the tree is missing or unreadable. */
  status: "idle" | "loading" | "ready" | "failed";
  /** True when the stored record was damaged and the newest snapshot was opened instead. */
  recoveredFromSnapshot: boolean;
  doc: TreeDocument | null;
  /** The person the family view starts from; null means `doc.rootPersonId`. */
  viewRootId: string | null;
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  focusMode: boolean;
  editing: { personId: string; role: EditingRole; fromId?: string } | null;
  /** Null while nothing is loaded or the tree has no root person yet. */
  layout: LayoutResult | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Code of the last command the model refused; cleared by the next command that works. */
  error: string | null;
  /**
   * Read-only, for good, because another tab changed (`changed`) or deleted (`deleted`) the tree:
   * this copy is stale and saving it would overwrite newer work. Only a reload edits again.
   */
  locked: "changed" | "deleted" | null;
};

export type EditorActions = {
  load(treeId: string): Promise<void>;
  /** Applies the command as one undo step. Returns the created ids, or null when refused. */
  dispatch(cmd: Command, label: string): string[] | null;
  /**
   * Confirms an inline add: folds the edit into the add's undo step, so one undo removes the whole
   * addition. Only while that add is still the newest history entry and unconfirmed; otherwise it
   * behaves exactly like `dispatch`. A refused command leaves the add pending.
   */
  amendLast(cmd: Command, label: string): string[] | null;
  /**
   * Cancels an inline add (Esc, or confirming an empty name): undoes it and drops the redo entry.
   * Does nothing unless the add is still the newest history entry and unconfirmed, so it can never
   * undo someone else's edit or wipe the redo stack.
   */
  cancelLastAdd(): void;
  /** While an inline add is pending, undo and redo both act as `cancelLastAdd` + `stopEditing`. */
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  /** Null shows the tree from `doc.rootPersonId` again. */
  setViewRoot(id: string | null): void;
  toggleCollapse(personId: string): void;
  /**
   * Makes sure the person has a card (a search pick): expands every collapsed ancestor of theirs
   * (and of their partners, for someone shown as a spouse) first, and only if they are still not
   * placed moves the view root to their topmost ancestor. False when they can't be shown.
   */
  revealPerson(personId: string): boolean;
  setFocusMode(on: boolean): void;
  startEditing(editing: NonNullable<EditorState["editing"]>): void;
  stopEditing(): void;
  /**
   * Makes the editor read-only (see `locked`): stops the autosaver and the journal (its entry
   * stays, for recovery to judge against the stored save), closes any inline edit. `deleted` is final; a later `changed` does not replace it.
   */
  lock(reason: "changed" | "deleted"): void;
};

export type EditorStore = StoreApi<EditorState & EditorActions>;

export type EditorDeps = {
  repo: TreeRepo;
  autosaver: Autosaver;
  /** Write-ahead journal for unsaved edits (see `storage/journal`); optional in tests. */
  journal?: Journal;
  /** Compare-and-swap saves (see `storage/saveGuard`); the editor page's autosaver uses it too. */
  guard?: SaveGuard;
  now?: () => Date;
};

const INITIAL: EditorState = {
  status: "idle",
  recoveredFromSnapshot: false,
  doc: null,
  viewRootId: null,
  selectedId: null,
  collapsed: new Set(),
  focusMode: false,
  editing: null,
  layout: null,
  canUndo: false,
  canRedo: false,
  error: null,
  locked: null,
};

function computeLayout(
  doc: TreeDocument | null,
  viewRootId: string | null,
  collapsed: ReadonlySet<string>,
): LayoutResult | null {
  const rootId = viewRootId ?? doc?.rootPersonId;
  if (!doc || rootId === undefined) return null;
  return layoutFamily(doc, { rootId, collapsed });
}

export function createEditorStore({
  repo,
  autosaver,
  journal,
  guard,
  now = () => new Date(),
}: EditorDeps) {
  const history = new History();
  let lastSnapshotAt = 0;
  let loadSeq = 0;
  /**
   * True while the newest history entry is an add that an inline edit has not confirmed or
   * cancelled yet. Any other edit, undo, redo or load makes it stale.
   */
  let pendingAdd = false;

  /** Snapshots the document when ten minutes passed since the last one. */
  function snapshotIfDue(doc: TreeDocument): void {
    const at = now().getTime();
    if (at - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
    lastSnapshotAt = at;
    // A failed snapshot must never get in the way of editing.
    repo.takeSnapshot(doc, { ifChanged: true }).catch(() => {});
  }

  const store = createStore<EditorState & EditorActions>()((set, get) => {
    /** Installs a changed document: drops references to people who are gone, re-lays out, saves. */
    function commit(doc: TreeDocument): void {
      const s = get();
      const alive = (id: string | null) => (id !== null && doc.persons[id] ? id : null);
      const viewRootId = alive(s.viewRootId);
      const editing = s.editing && doc.persons[s.editing.personId] ? s.editing : null;
      set({
        doc,
        viewRootId,
        selectedId: alive(s.selectedId),
        editing,
        layout: computeLayout(doc, viewRootId, s.collapsed),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
      });
      // The journal is a synchronous copy that survives a page closing mid-debounce.
      journal?.touch(doc);
      autosaver.schedule(doc);
      snapshotIfDue(doc);
    }

    /** Runs the command; a refusal becomes `error` and a null result, anything else is a bug. */
    function run(cmd: Command): CommandResult | null {
      const doc = get().doc;
      if (!doc) return null;
      try {
        return applyCommand(doc, cmd, now());
      } catch (e) {
        if (e instanceof CommandError) {
          set({ error: e.code });
          return null;
        }
        throw e;
      }
    }

    function record(cmd: Command, label: string, write: "push" | "amend"): string[] | null {
      if (get().locked) return null;
      const result = run(cmd);
      if (!result) return null;
      history[write]({ label, patches: result.patches, inversePatches: result.inversePatches });
      // Only a plain dispatch that created people opens an add; an amendment closes it.
      pendingAdd = write === "push" && result.createdIds.length > 0;
      set({ error: null });
      commit(result.doc);
      return result.createdIds;
    }

    function step(move: "undo" | "redo"): void {
      const doc = get().doc;
      if (!doc || get().locked) return;
      const next = history[move](doc);
      if (!next) return;
      pendingAdd = false;
      commit(next);
    }

    function cancelLastAdd(): void {
      if (!pendingAdd || get().locked) return;
      step("undo");
      history.dropRedo();
      set({ canRedo: false });
    }

    function cancelAndClose(): void {
      cancelLastAdd();
      set({ editing: null });
    }

    return {
      ...INITIAL,

      async load(treeId) {
        const seq = ++loadSeq;
        history.clear();
        pendingAdd = false;
        // A lock outlives a reload of the store: the autosaver it stopped stays stopped.
        set({ ...INITIAL, status: "loading", locked: get().locked });
        let found: Awaited<ReturnType<TreeRepo["getTree"]>>;
        try {
          found = await repo.getTree(treeId);
        } catch {
          found = null;
        }
        if (seq !== loadSeq) return; // a newer load took over
        if (!found) {
          set({ status: "failed" });
          return;
        }
        // Edits the last session journaled but never got into IndexedDB come back first.
        guard?.loaded(found.savedAt);
        const save = guard
          ? guard.save
          : (doc: TreeDocument, opts: { recoveredFrom?: string }) => repo.saveTree(doc, opts);
        const restored = await journal?.recover(found, save);
        if (seq !== loadSeq) return;
        if (restored) found = { ...found, doc: restored };
        set({
          status: "ready",
          doc: found.doc,
          recoveredFromSnapshot: found.recoveredFromSnapshot,
          layout: computeLayout(found.doc, null, INITIAL.collapsed),
        });
        lastSnapshotAt = now().getTime();
        repo.takeSnapshot(found.doc, { ifChanged: true }).catch(() => {});
      },

      dispatch: (cmd, label) => record(cmd, label, "push"),

      amendLast(cmd, label) {
        // Folding into an entry that is not the pending add would rewrite someone else's edit.
        return record(cmd, label, pendingAdd ? "amend" : "push");
      },

      cancelLastAdd,
      // While an inline add is open, undo and redo mean "never mind the add": they cancel it and
      // close its editor, rather than undo the edit before it or redo over it.
      undo: () => (pendingAdd ? cancelAndClose() : step("undo")),
      redo: () => (pendingAdd ? cancelAndClose() : step("redo")),

      select: (id) => set({ selectedId: id }),

      setViewRoot(id) {
        const { doc, collapsed } = get();
        set({ viewRootId: id, layout: computeLayout(doc, id, collapsed) });
      },

      toggleCollapse(personId) {
        const { doc, viewRootId, collapsed } = get();
        const next = new Set(collapsed);
        if (!next.delete(personId)) next.add(personId);
        set({ collapsed: next, layout: computeLayout(doc, viewRootId, next) });
      },

      revealPerson(personId) {
        const { doc, layout, viewRootId, collapsed } = get();
        if (!doc?.persons[personId]) return false;
        if (layout?.primaryNode[personId] !== undefined) return true;
        const above = ancestorsOf(doc, personId);
        for (const partner of partnersOf(doc, personId)) {
          for (const id of ancestorsOf(doc, partner)) above.add(id);
        }
        const expanded = new Set([...collapsed].filter((id) => !above.has(id)));
        let rootId = viewRootId;
        let next = computeLayout(doc, rootId, expanded);
        if (next?.primaryNode[personId] === undefined) {
          rootId = topmostAncestor(doc, personId);
          next = computeLayout(doc, rootId, expanded);
        }
        set({ collapsed: expanded, viewRootId: rootId, layout: next });
        return next?.primaryNode[personId] !== undefined;
      },

      setFocusMode: (on) => set({ focusMode: on }),
      startEditing: (editing) => set({ editing }),
      stopEditing: () => set({ editing: null }),

      lock(reason) {
        if (get().locked === "deleted") return;
        autosaver.stop();
        journal?.discard();
        pendingAdd = false;
        set({ locked: reason, editing: null, canUndo: false, canRedo: false });
      },
    };
  });

  return store;
}
