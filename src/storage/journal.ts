import type { TreeDocument } from "@/core/model/types";
import { parseTreeDocument } from "@/io/json/parseTree";

import { TAB_ID } from "./multitab";
import type { TreeRepo } from "./treeRepo";

/**
 * A synchronous write-ahead journal for unsaved edits. IndexedDB writes are asynchronous and the
 * browser may end the page before one finishes, so each unsaved document is also kept in
 * `localStorage` (a synchronous write that survives the page). The entry is removed once the
 * IndexedDB save that covers it has resolved, and read back (and saved) when the tree is next
 * opened. Everything here fails silently: with no storage, or a full one, autosave still works.
 *
 * An entry is `{ v: 1, writtenAt, tab, doc }`. Whether it is newer than the stored tree is told by
 * `writtenAt` against the meta row's `savedAt`, never by `doc.updatedAt`: an undo brings back an
 * older `updatedAt`, yet it is the newest state. `tab` says which tab wrote it.
 */

const PREFIX = "stam:pending:";
/** While edits keep coming, the journal is rewritten at most this often. */
export const JOURNAL_THROTTLE_MS = 250;

/** The part of `Storage` the journal uses. */
export type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** The browser's `localStorage`, or undefined when it is blocked (reading it can throw). */
export function browserStorage(): JournalStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

const keyOf = (treeId: string) => `${PREFIX}${treeId}`;

/**
 * A journaled document. `writtenAt` (epoch ms) and `tab` are null for an entry written before the
 * envelope existed, which held the bare document.
 */
export type PendingEntry = { doc: TreeDocument; writtenAt: number | null; tab: string | null };

/** Keeps `doc` as the tree's pending entry. A full or blocked storage is ignored. */
export function writePending(
  doc: TreeDocument,
  storage = browserStorage(),
  { writtenAt = Date.now(), tab = TAB_ID }: { writtenAt?: number; tab?: string } = {},
): void {
  try {
    storage?.setItem(keyOf(doc.id), JSON.stringify({ v: 1, writtenAt, tab, doc }));
  } catch {
    // Quota or a blocked storage: autosave to IndexedDB is still on its way.
  }
}

export function removePending(treeId: string, storage = browserStorage()): void {
  try {
    storage?.removeItem(keyOf(treeId));
  } catch {
    // ignored on purpose
  }
}

/** Unwraps an entry: the envelope, or a bare document from before it existed. */
function parseEntry(raw: string): PendingEntry {
  const data: unknown = JSON.parse(raw);
  if (typeof data === "object" && data !== null && "v" in data) {
    const { v, writtenAt, tab, doc } = data as Record<string, unknown>;
    if (v !== 1 || typeof writtenAt !== "number" || typeof tab !== "string") {
      throw new Error("bad envelope");
    }
    return { doc: parseTreeDocument(doc), writtenAt, tab };
  }
  return { doc: parseTreeDocument(data), writtenAt: null, tab: null };
}

/** The tree's pending entry, or null. An entry that is not a valid tree is dropped. */
export function readPending(treeId: string, storage = browserStorage()): PendingEntry | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(keyOf(treeId)) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const entry = parseEntry(raw);
    if (entry.doc.id === treeId) return entry;
  } catch {
    // fall through: unreadable or invalid
  }
  removePending(treeId, storage);
  return null;
}

/** What the store holds for a tree: the document and the meta row's `savedAt` (see TreeRepo). */
type StoredTree = { doc: TreeDocument; savedAt: number | null };

/**
 * True when the entry holds edits the stored tree does not have: it was written after the last
 * save. With no `savedAt` (a tree last saved before it existed) the entry is newer by definition,
 * since it was written by this version after the tree was opened. A bare entry from before the
 * envelope falls back to comparing `updatedAt`.
 */
function isNewer(entry: PendingEntry, stored: StoredTree): boolean {
  if (entry.writtenAt === null) return entry.doc.updatedAt > stored.doc.updatedAt;
  return stored.savedAt === null || entry.writtenAt > stored.savedAt;
}

/** How a recovery save restores an entry: `recoveredFrom` is the tab that wrote it, if known. */
type RecoverySave = (doc: TreeDocument, opts: { recoveredFrom?: string }) => Promise<unknown>;

/**
 * Brings a pending entry back when it is newer than what is stored (see `isNewer`): saves it
 * through `save` (telling it which tab wrote the entry), then clears it. An older entry is stale and is dropped. If the save fails, the
 * entry stays for the next open and the document is still returned. Null when there is nothing
 * to use.
 */
export async function recoverPending(
  stored: StoredTree,
  save: RecoverySave,
  storage = browserStorage(),
): Promise<TreeDocument | null> {
  const entry = readPending(stored.doc.id, storage);
  if (!entry) return null;
  if (!isNewer(entry, stored)) {
    removePending(stored.doc.id, storage);
    return null;
  }
  const pending = entry.doc;
  try {
    await save(pending, entry.tab === null ? {} : { recoveredFrom: entry.tab });
    removePending(stored.doc.id, storage);
  } catch {
    // keep the journal; it will be tried again
  }
  return pending;
}

/** Every tree id that has a pending entry. */
function pendingIds(storage: JournalStorage): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) ids.push(key.slice(PREFIX.length));
    }
  } catch {
    // ignored on purpose
  }
  return ids;
}

/** Recovers every pending entry (the tree list does this, so counts and dates are current). */
export async function recoverAllPending(repo: TreeRepo, storage = browserStorage()): Promise<void> {
  if (!storage) return;
  for (const id of pendingIds(storage)) {
    try {
      const found = await repo.getTree(id);
      // A tree that is gone leaves nothing to restore the entry into. The save is guarded, so a
      // tab that saved meanwhile is never overwritten.
      if (found) {
        await recoverPending(
          found,
          (doc, opts) => repo.saveTree(doc, { ...opts, ifSavedAt: found.savedAt }),
          storage,
        );
      } else removePending(id, storage);
    } catch {
      // The list must open even if one tree cannot be read.
    }
  }
}

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: never) => void;
  now: () => number;
};

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  now: () => Date.now(),
};

/**
 * The editor's side of the journal: throttled writes, a synchronous flush, clear after save.
 * Entries are stamped with `timers.now()`, which must be the wall clock outside tests.
 */
export function createJournal(
  opts: { storage?: JournalStorage; timers?: Timers; throttleMs?: number; tabId?: string } = {},
) {
  const storage = "storage" in opts ? opts.storage : browserStorage();
  const timers = opts.timers ?? realTimers;
  const throttleMs = opts.throttleMs ?? JOURNAL_THROTTLE_MS;
  const tab = opts.tabId ?? TAB_ID;

  /** The newest document not yet known to be saved. */
  let pending: TreeDocument | undefined;
  /** Whether `pending` is newer than the entry in storage. */
  let unwritten = false;
  let lastWrite = Number.NEGATIVE_INFINITY;
  /**
   * Entries are stamped no earlier than this: just past the newest `savedAt` this journal heard
   * of. A change kept past a save must count as newer than it on recovery, even when the save's
   * `savedAt` is ahead of this clock (the same millisecond, or a clock that went back).
   */
  let floor = Number.NEGATIVE_INFINITY;
  let timer: unknown;

  const clearTimer = () => {
    if (timer !== undefined) timers.clearTimeout(timer as never);
    timer = undefined;
  };

  function write(): void {
    clearTimer();
    if (!pending || !unwritten) return;
    unwritten = false;
    lastWrite = timers.now();
    writePending(pending, storage, { writtenAt: Math.max(lastWrite, floor), tab });
  }

  return {
    /** A document change: the first one is journaled at once, later ones at most every 250 ms. */
    touch(doc: TreeDocument): void {
      pending = doc;
      unwritten = true;
      if (timer !== undefined) return;
      const wait = lastWrite + throttleMs - timers.now();
      if (wait <= 0) write();
      else timer = timers.setTimeout(write, wait);
    },

    /** Writes any unjournaled change now, synchronously (for `pagehide`). */
    flush: write,

    /**
     * The IndexedDB save of `doc` resolved with `savedAt`: drop the entry unless a change came
     * after it. That is told by identity, not `updatedAt`: an undo made while the save ran has an
     * older one. A later change is kept and re-stamped past `savedAt` (written now if it was
     * waiting), since it may have been stamped at or before it.
     */
    saved(doc: TreeDocument, savedAt: number): void {
      floor = Math.max(floor, savedAt + 1);
      if (pending !== undefined && pending !== doc) {
        unwritten = true;
        write();
        return;
      }
      pending = undefined;
      unwritten = false;
      clearTimer();
      removePending(doc.id, storage);
    },

    /**
     * Stops journaling, for a tab that went read-only: forgets the waiting change. The entry in
     * storage stays: recovery restores it only if it was written after the stored save, so edits
     * newer than that save are never lost, and older ones are dropped then.
     */
    discard(): void {
      pending = undefined;
      unwritten = false;
      clearTimer();
    },

    /** See `recoverPending`. */
    recover(stored: StoredTree, save: RecoverySave) {
      return recoverPending(stored, save, storage);
    },
  };
}

export type Journal = ReturnType<typeof createJournal>;
