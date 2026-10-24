import { createStore, type StoreApi } from "zustand/vanilla";

import type { CloudSession, CloudSessionHandlers, CloudStatus } from "@/cloud/cloudSession";
import { applyCommand } from "@/core/commands/apply";
import { CommandError } from "@/core/commands/errors";
import { History } from "@/core/commands/history";
import type { Command, CommandResult } from "@/core/commands/types";
import type { LayoutResult } from "@/core/layout/types";
import { ancestorsOf, partnersOf, topmostAncestor } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import type { FanLayout, TimelineLayout, ViewMode } from "@/core/views/types";
import type { Autosaver } from "@/storage/autosave";
import type { Journal } from "@/storage/journal";
import type { SaveGuard } from "@/storage/saveGuard";
import type { CloudMeta, TreeRepo } from "@/storage/treeRepo";
import type { EntityChange } from "@/sync/revert";
import type { DroppedEdit } from "@/sync/syncClient";

import {
  clampFanGenerations,
  computeViews,
  FAN_GENERATIONS,
  isFocusView,
  isReadOnlyView,
  realLayouts,
  type ViewInputs,
  type ViewLayoutFns,
} from "./viewLayouts";

/** While edits keep arriving, the tree is snapshotted at most this often. */
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

export type EditingRole = "first" | "child" | "spouse" | "parent" | "sibling" | "between";

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
  /** Which view of the tree is shown. */
  viewMode: ViewMode;
  /**
   * The person the pedigree, descendants, hourglass and fan views are drawn around; null means
   * the view root (see `resolveFocus`).
   */
  focusId: string | null;
  /**
   * Null while nothing is loaded or the tree has no root person yet. In the fan and timeline
   * views it stays the family layout (exports use it); the views draw `fanLayout` and
   * `timelineLayout`.
   */
  layout: LayoutResult | null;
  fanLayout: FanLayout | null;
  timelineLayout: TimelineLayout | null;
  /** How many generations the fan chart draws, 2–7 (FR-V5). */
  fanGenerations: number;
  /** Who the family view can't reach from the view root, in every view (see `computeViews`). */
  familyUnreachable: string[];
  /** "How are we related?": the two people being compared (either may still be empty). */
  relation: { aId: string | null; bId: string | null } | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Code of the last command the model refused; cleared by the next command that works. */
  error: string | null;
  /**
   * Read-only, for good, because another tab changed (`changed`) or deleted (`deleted`) the tree:
   * this copy is stale and saving it would overwrite newer work. Only a reload edits again.
   */
  locked: "changed" | "deleted" | null;
  /** Set for a cloud tree (spec §5.4): who this browser is on it and how the link is. */
  cloud: {
    role: CloudMeta["role"];
    /** The link token, for trees opened by a link (photos are fetched with it). */
    token?: string;
    status: CloudStatus;
    pendingCount: number;
    /** The room ended this tree for this browser: 4401 link off, 4404 deleted. */
    closed: number | null;
    /** Own edits that could not be applied after others' edits came in. */
    dropped: DroppedEdit[];
  } | null;
};

/** Starts the live session of a cloud tree (see `src/cloud/cloudSession`). */
export type OpenCloud = (args: {
  treeId: string;
  cloud: CloudMeta;
  doc: TreeDocument;
  handlers: CloudSessionHandlers;
}) => CloudSession;

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
  /**
   * Switches the view. Entering a focus view from the family or timeline view focuses the
   * selected person, if there is one. Fan and timeline are read-only (see `isReadOnlyView`).
   */
  setViewMode(mode: ViewMode): void;
  /** Draws the focus views around this person; ignored for someone who is not in the tree. */
  setFocus(personId: string): void;
  /** Sets the fan's generations, clamped to 2–7, and lays the fan out again. */
  setFanGenerations(generations: number): void;
  /** Opens the relationship calculator; ids that are not in the tree are left empty. */
  openRelation(aId?: string | null, bId?: string | null): void;
  setRelation(patch: Partial<NonNullable<EditorState["relation"]>>): void;
  closeRelation(): void;
  startEditing(editing: NonNullable<EditorState["editing"]>): void;
  stopEditing(): void;
  /**
   * Makes the editor read-only (see `locked`): stops the autosaver and the journal (its entry
   * stays, for recovery to judge against the stored save), closes any inline edit. `deleted` is final; a later `changed` does not replace it.
   */
  lock(reason: "changed" | "deleted"): void;
  /** Ends the tree's cloud session, if any (the editor page closing). */
  dispose(): void;
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
  /** The layout functions; tests pass fakes for the views they do not exercise. */
  layouts?: ViewLayoutFns;
  /** Opens cloud trees live; without it every tree is edited as a local one. */
  openCloud?: OpenCloud;
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
  viewMode: "family",
  focusId: null,
  layout: null,
  fanLayout: null,
  timelineLayout: null,
  fanGenerations: FAN_GENERATIONS,
  familyUnreachable: [],
  relation: null,
  canUndo: false,
  canRedo: false,
  error: null,
  locked: null,
  cloud: null,
};

export function createEditorStore({
  repo,
  autosaver,
  journal,
  guard,
  now = () => new Date(),
  layouts = realLayouts,
  openCloud,
}: EditorDeps) {
  const history = new History();
  /** The live session while a cloud tree is open. */
  let session: CloudSession | null = null;
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
    /** The layouts of `doc` for the current view, with some inputs overridden. */
    function relayout(doc: TreeDocument | null, over: Partial<ViewInputs> = {}) {
      const s = get();
      const input: ViewInputs = {
        viewMode: s.viewMode,
        viewRootId: s.viewRootId,
        focusId: s.focusId,
        collapsed: s.collapsed,
        fanGenerations: s.fanGenerations,
        ...over,
      };
      return computeViews(layouts, doc, input, now());
    }

    /** Installs a changed document: drops references to people who are gone, re-lays out, saves. */
    function commit(doc: TreeDocument): void {
      const s = get();
      const alive = (id: string | null) => (id !== null && doc.persons[id] ? id : null);
      const viewRootId = alive(s.viewRootId);
      const focusId = alive(s.focusId);
      const relation = s.relation && {
        aId: alive(s.relation.aId),
        bId: alive(s.relation.bId),
      };
      const editing = s.editing && doc.persons[s.editing.personId] ? s.editing : null;
      set({
        doc,
        viewRootId,
        focusId,
        relation,
        selectedId: alive(s.selectedId),
        editing,
        ...relayout(doc, { viewRootId, focusId }),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
      });
      // The journal is a synchronous copy that survives a page closing mid-debounce. A cloud tree
      // needs none: its edits wait in the session until the room has them.
      if (!session) journal?.touch(doc);
      autosaver.schedule(doc);
      snapshotIfDue(doc);
    }

    /** Runs the command; a refusal becomes `error` and a null result, anything else is a bug. */
    function run(cmd: Command): CommandResult | null {
      const doc = get().doc;
      if (!doc) return null;
      try {
        return session ? session.submit(cmd) : applyCommand(doc, cmd, now());
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
      if (session && !session.canEdit) return null;
      // Fan and timeline only show the tree; the tree's name is the one thing they let through.
      if (isReadOnlyView(get().viewMode) && cmd.type !== "renameTree") return null;
      const result = run(cmd);
      if (!result) return null;
      history[write]({
        label,
        patches: result.patches,
        inversePatches: result.inversePatches,
        ...("entities" in result ? { entities: result.entities as EntityChange[] } : {}),
      });
      // Only a plain dispatch that created people opens an add; an amendment closes it.
      pendingAdd = write === "push" && result.createdIds.length > 0;
      set({ error: null });
      commit(result.doc);
      return result.createdIds;
    }

    function step(move: "undo" | "redo"): void {
      const doc = get().doc;
      if (!doc || get().locked || isReadOnlyView(get().viewMode)) return;
      if (session) {
        cloudStep(session, move);
        return;
      }
      const next = history[move](doc);
      if (!next) return;
      pendingAdd = false;
      commit(next);
    }

    /**
     * Undo and redo on a cloud tree revert one's own edit through the room: refused with
     * CONFLICT when someone changed the same people since, leaving both stacks as they were.
     */
    function cloudStep(live: CloudSession, move: "undo" | "redo"): void {
      if (!live.canEdit) return;
      const entry = history.peek(move);
      if (!entry) return;
      pendingAdd = false;
      if (!entry.entities || entry.entities.length === 0) {
        // The edit changed nothing that could be undone (only the time stamp).
        history.shift(move);
        set({ canUndo: history.canUndo, canRedo: history.canRedo });
        return;
      }
      let next: TreeDocument;
      try {
        next = live.submitRevert(entry.entities, move);
      } catch (e) {
        if (e instanceof CommandError) {
          set({ error: e.code });
          return;
        }
        throw e;
      }
      history.shift(move);
      set({ error: null });
      commit(next);
    }

    function startCloud(treeId: string, cloud: CloudMeta, doc: TreeDocument): void {
      const patchCloud = (patch: Partial<NonNullable<EditorState["cloud"]>>) => {
        const current = get().cloud;
        if (current) set({ cloud: { ...current, ...patch } });
      };
      set({
        cloud: {
          role: cloud.role,
          ...(cloud.token ? { token: cloud.token } : {}),
          status: "connecting",
          pendingCount: 0,
          closed: null,
          dropped: [],
        },
      });
      session = openCloud!({
        treeId,
        cloud,
        doc,
        handlers: {
          onView: (next) => {
            if (get().doc) commit(next);
          },
          onDropped: (dropped) => {
            patchCloud({ dropped });
            set({ error: "DROPPED" });
          },
          onStatus: (status, pendingCount) => patchCloud({ status, pendingCount }),
          onClosed: (code) => patchCloud({ closed: code }),
        },
      });
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
        session?.stop();
        session = null;
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
        const cloud = openCloud
          ? (await repo.getMeta(treeId).catch(() => undefined))?.cloud
          : undefined;
        if (seq !== loadSeq) return;
        if (cloud) {
          // A cloud tree: the room holds the truth; this copy is its cache, no journal or guard.
          set({
            status: "ready",
            doc: found.doc,
            recoveredFromSnapshot: found.recoveredFromSnapshot,
            ...computeViews(
              layouts,
              found.doc,
              { ...INITIAL, collapsed: INITIAL.collapsed },
              now(),
            ),
          });
          startCloud(treeId, cloud, found.doc);
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
          ...computeViews(layouts, found.doc, { ...INITIAL, collapsed: INITIAL.collapsed }, now()),
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
        set({ viewRootId: id, ...relayout(get().doc, { viewRootId: id }) });
      },

      toggleCollapse(personId) {
        const next = new Set(get().collapsed);
        if (!next.delete(personId)) next.add(personId);
        set({ collapsed: next, ...relayout(get().doc, { collapsed: next }) });
      },

      revealPerson(personId) {
        const { doc, layout, viewRootId, collapsed, viewMode } = get();
        if (!doc?.persons[personId]) return false;
        if (layout?.primaryNode[personId] !== undefined) return true;
        const above = ancestorsOf(doc, personId);
        for (const partner of partnersOf(doc, personId)) {
          for (const id of ancestorsOf(doc, partner)) above.add(id);
        }
        const expanded = new Set([...collapsed].filter((id) => !above.has(id)));
        let rootId = viewRootId;
        let next = relayout(doc, { collapsed: expanded, viewRootId: rootId });
        let focusId = get().focusId;
        if (next.layout?.primaryNode[personId] === undefined) {
          if (isFocusView(viewMode) && viewMode !== "fan") {
            // These views are drawn around one person: someone not in the picture becomes the focus.
            focusId = personId;
          } else {
            rootId = topmostAncestor(doc, personId);
          }
          next = relayout(doc, { collapsed: expanded, viewRootId: rootId, focusId });
        }
        set({ collapsed: expanded, viewRootId: rootId, focusId, ...next });
        return next.layout?.primaryNode[personId] !== undefined;
      },

      setFocusMode: (on) => set({ focusMode: on }),

      setViewMode(mode) {
        const { doc, viewMode, selectedId, focusId } = get();
        if (!doc || mode === viewMode) return;
        let nextFocus = focusId;
        if (isFocusView(mode) && !isFocusView(viewMode)) {
          nextFocus = selectedId !== null && doc.persons[selectedId] ? selectedId : focusId;
        }
        set({
          viewMode: mode,
          focusId: nextFocus,
          // Nothing is edited in the fan and timeline; and an open add belongs to the old view.
          editing: null,
          ...relayout(doc, { viewMode: mode, focusId: nextFocus }),
        });
      },

      setFocus(personId) {
        const { doc } = get();
        if (!doc?.persons[personId]) return;
        set({ focusId: personId, ...relayout(doc, { focusId: personId }) });
      },

      setFanGenerations(generations) {
        const fanGenerations = clampFanGenerations(generations);
        if (fanGenerations === get().fanGenerations) return;
        set({ fanGenerations, ...relayout(get().doc, { fanGenerations }) });
      },

      openRelation(aId = null, bId = null) {
        const { doc } = get();
        const known = (id: string | null) => (id !== null && doc?.persons[id] ? id : null);
        set({ relation: { aId: known(aId), bId: known(bId) } });
      },
      setRelation(patch) {
        const { doc, relation } = get();
        if (!relation) return;
        const known = (id: string | null) => (id !== null && doc?.persons[id] ? id : null);
        set({
          relation: {
            aId: "aId" in patch ? known(patch.aId ?? null) : relation.aId,
            bId: "bId" in patch ? known(patch.bId ?? null) : relation.bId,
          },
        });
      },
      closeRelation: () => set({ relation: null }),
      dispose() {
        session?.stop();
        session = null;
      },
      startEditing: (editing) => set({ editing }),
      stopEditing: () => set({ editing: null }),

      lock(reason) {
        // Another tab saving a cloud tree's cache is not a conflict: the room keeps them in step.
        if (session) return;
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
