import type { IDBPDatabase, IDBPTransaction } from "idb";

import { SNAPSHOT_LIMIT } from "@/config";
import { newId } from "@/core/model/ids";
import type { TreeDocument } from "@/core/model/types";
import { parseTreeDocument } from "@/io/json/parseTree";
import type { PendingOp } from "@/sync/syncClient";

/** A tree that lives in the cloud too (spec §4.4): this browser's copy is its cache. */
export type CloudMeta = {
  /** `owner` for the signed-in owner's trees; otherwise the role of the link it was opened by. */
  role: "owner" | "view" | "comment" | "edit";
  /** The link token, for trees opened by a link. */
  token?: string;
  /** The link hides living people's details, so this copy lacks them. */
  hideLiving?: boolean;
  /** The last version the room confirmed. */
  version: number;
  /** Photos that did not upload yet (owner): the share dialog offers Retry for them. */
  failedPhotos?: string[];
};

export type TreeMeta = {
  id: string;
  name: string;
  peopleCount: number;
  updatedAt: string;
  /**
   * When the tree was last written, in epoch ms; it only ever grows. Absent on rows written
   * before it existed. Guarded saves compare it to tell whether someone else saved in between.
   */
  savedAt?: number;
  /**
   * Set by a save that restored a journal entry: the id of the tab that wrote it. That tab still
   * has the entry's edits in memory, so it may save on top of this (see `SaveGuard`). Any other
   * save clears it.
   */
  recoveredFrom?: string;
  /** Set for cloud trees (see `setCloud`); local-only trees have none. */
  cloud?: CloudMeta;
};

/**
 * A guarded save found that the tree changed (or was deleted) since the caller last loaded or
 * saved it, typically in another tab. Nothing was written.
 */
export class StaleWriteError extends Error {
  override name = "StaleWriteError";
  constructor(
    readonly treeId: string,
    readonly deleted: boolean,
    /** The meta row's `recoveredFrom` when the tree changed (not deleted). */
    readonly recoveredFrom: string | null = null,
    /** The meta row's `savedAt` when the tree changed (not deleted). */
    readonly storedSavedAt: number | null = null,
  ) {
    super(deleted ? `Tree ${treeId} was deleted` : `Tree ${treeId} changed since it was loaded`);
  }
}

export type SaveOptions = {
  ifSavedAt?: number | null;
  /**
   * When the caller took `doc` (epoch ms, default now). It becomes `savedAt`, so a journal entry
   * written after the capture, even while the save runs, counts as newer than this save.
   */
  capturedAt?: number;
  /** The id of the tab whose journal entry this save restores (see `TreeMeta.recoveredFrom`). */
  recoveredFrom?: string;
};

type Snapshot = { treeId: string; takenAt: string; doc: TreeDocument };

export type TreeRepo = {
  /** Newest first. */
  listTrees(): Promise<TreeMeta[]>;
  /**
   * Returns the stored tree, or the newest valid snapshot when the stored record is damaged.
   * Null when there is no such tree, or it is damaged and no snapshot is usable.
   */
  getTree(id: string): Promise<{
    doc: TreeDocument;
    recoveredFromSnapshot: boolean;
    /** The meta row's `savedAt`; null for a tree last saved before it existed. */
    savedAt: number | null;
  } | null>;
  /**
   * Writes the tree and its meta row in one transaction and returns the new `savedAt`. With
   * `ifSavedAt` the save is compare-and-swap: it throws `StaleWriteError` (writing nothing) unless
   * the stored `savedAt` still equals it, i.e. nobody saved or deleted the tree in between.
   */
  saveTree(doc: TreeDocument, opts?: SaveOptions): Promise<number>;
  /**
   * Removes the tree, its meta row and its snapshots. Its photos stay until `deleteUnusedPhotos`.
   */
  deleteTree(id: string): Promise<void>;
  getMeta(id: string): Promise<TreeMeta | undefined>;
  /** A cloud tree as the room last confirmed it; kept only when `version` is newer. */
  saveConfirmed(treeId: string, doc: TreeDocument, version: number): Promise<void>;
  getConfirmed(treeId: string): Promise<{ doc: TreeDocument; version: number } | undefined>;
  /** This browser's unconfirmed edits to cloud trees, in the order they were made. */
  addPending(treeId: string, op: PendingOp): Promise<void>;
  removePending(opIds: readonly string[]): Promise<void>;
  listPending(treeId: string): Promise<PendingOp[]>;
  /** Marks the tree as a cloud tree (or, with null, local-only again). Saves keep it. */
  setCloud(id: string, cloud: CloudMeta | null): Promise<void>;
  duplicateTree(id: string, name: string): Promise<TreeDocument>;
  putPhoto(id: string, blob: Blob): Promise<void>;
  getPhoto(id: string): Promise<Blob | undefined>;
  /**
   * Deletes every stored photo that no tree and no snapshot points at, except those in `keep`
   * (photos an unsaved edit already uses). Returns how many were deleted.
   */
  deleteUnusedPhotos(keep?: Iterable<string>): Promise<number>;
  /**
   * Keeps the newest `SNAPSHOT_LIMIT` snapshots of the document's tree. With `ifChanged`, nothing
   * is stored when the newest snapshot already has the document's `updatedAt`.
   */
  takeSnapshot(doc: TreeDocument, opts?: { ifChanged?: boolean }): Promise<void>;
  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting(key: string, value: unknown): Promise<void>;
};

/** Runs a stored record through the same checks as an import; undefined when it is unusable. */
function readStored(record: unknown): TreeDocument | undefined {
  try {
    return parseTreeDocument(record);
  } catch {
    return undefined;
  }
}

type WriteTx = IDBPTransaction<unknown, string[], "readwrite">;

/**
 * Runs `work` in a read-write transaction and waits for it to commit. On any failure the
 * transaction is aborted, so none of its writes survive.
 */
async function inTransaction(
  db: IDBPDatabase,
  stores: string[],
  work: (tx: WriteTx) => Promise<unknown>,
): Promise<void> {
  const tx = db.transaction(stores, "readwrite");
  try {
    await Promise.all([work(tx), tx.done]);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // already finished or aborted
    }
    throw error;
  }
}

function metaOf(
  doc: TreeDocument,
  savedAt: number,
  recoveredFrom?: string,
  cloud?: CloudMeta,
): TreeMeta {
  return {
    id: doc.id,
    name: doc.name,
    peopleCount: Object.keys(doc.persons).length,
    updatedAt: doc.updatedAt,
    savedAt,
    ...(recoveredFrom === undefined ? {} : { recoveredFrom }),
    ...(cloud === undefined ? {} : { cloud }),
  };
}

/**
 * The photo ids a stored tree record points at. Read straight from the record, without the import
 * checks, so a damaged tree (which a snapshot may still restore) keeps its photos.
 */
export function photoIdsOf(record: unknown): string[] {
  const persons = (record as { persons?: unknown } | null | undefined)?.persons;
  if (typeof persons !== "object" || persons === null) return [];
  const ids: string[] = [];
  for (const person of Object.values(persons)) {
    const photoId = (person as { photoId?: unknown } | null)?.photoId;
    if (typeof photoId === "string") ids.push(photoId);
  }
  return ids;
}

const savedAtOf = (meta: TreeMeta | undefined): number | null =>
  typeof meta?.savedAt === "number" ? meta.savedAt : null;

/** Orders pending edits across tabs: the time, then a counter for the same millisecond. */
let lastSeq = 0;
function nextSeq(): number {
  lastSeq = Math.max(lastSeq + 1, Date.now() * 1000);
  return lastSeq;
}

export function createTreeRepo(db: IDBPDatabase): TreeRepo {
  const repo: TreeRepo = {
    async listTrees() {
      const all = (await db.getAll("meta")) as TreeMeta[];
      return all.toSorted((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
      );
    },

    async getTree(id) {
      // One transaction, so the tree and its savedAt are the same version.
      const tx = db.transaction(["trees", "meta"], "readonly");
      const [stored, meta] = (await Promise.all([
        tx.objectStore("trees").get(id),
        tx.objectStore("meta").get(id),
        tx.done,
      ])) as [unknown, TreeMeta | undefined, void];
      if (stored === undefined) return null;
      const savedAt = savedAtOf(meta);
      const doc = readStored(stored);
      if (doc) return { doc, recoveredFromSnapshot: false, savedAt };

      // Autoincrement keys ascend with time, so the index lists oldest first.
      const snapshots = (await db.getAllFromIndex("snapshots", "treeId", id)) as Snapshot[];
      for (let i = snapshots.length - 1; i >= 0; i--) {
        const candidate = readStored(snapshots[i]!.doc);
        if (candidate) return { doc: candidate, recoveredFromSnapshot: true, savedAt };
      }
      return null;
    },

    async saveTree(doc, opts = {}) {
      let savedAt = 0;
      await inTransaction(db, ["trees", "meta"], async (tx) => {
        const metaStore = tx.objectStore("meta");
        const current = (await metaStore.get(doc.id)) as TreeMeta | undefined;
        if (opts.ifSavedAt !== undefined) {
          if (!current) throw new StaleWriteError(doc.id, true);
          const stored = savedAtOf(current);
          if (stored !== opts.ifSavedAt) {
            throw new StaleWriteError(doc.id, false, current.recoveredFrom ?? null, stored);
          }
        }
        // Strictly greater than the stored one, so two saves in the same millisecond still differ.
        savedAt = Math.max(opts.capturedAt ?? Date.now(), (savedAtOf(current) ?? 0) + 1);
        await Promise.all([
          tx.objectStore("trees").put(doc),
          metaStore.put(metaOf(doc, savedAt, opts.recoveredFrom, current?.cloud)),
        ]);
      });
      return savedAt;
    },

    async deleteTree(id) {
      await inTransaction(
        db,
        ["trees", "meta", "snapshots", "cloudConfirmed", "cloudPending"],
        async (tx) => {
          const snapshots = tx.objectStore("snapshots");
          const snapshotKeys = await snapshots.index("treeId").getAllKeys(id);
          const pending = tx.objectStore("cloudPending");
          const pendingKeys = await pending.index("treeId").getAllKeys(id);
          await Promise.all([
            tx.objectStore("trees").delete(id),
            tx.objectStore("meta").delete(id),
            tx.objectStore("cloudConfirmed").delete(id),
            ...pendingKeys.map((key) => pending.delete(key)),
            ...snapshotKeys.map((key) => snapshots.delete(key)),
          ]);
        },
      );
    },

    async saveConfirmed(treeId, doc, version) {
      await inTransaction(db, ["cloudConfirmed"], async (tx) => {
        const store = tx.objectStore("cloudConfirmed");
        const current = (await store.get(treeId)) as { version: number } | undefined;
        if (current && current.version > version) return;
        await store.put({ treeId, doc, version });
      });
    },

    async getConfirmed(treeId) {
      const row = (await db.get("cloudConfirmed", treeId)) as
        { doc: TreeDocument; version: number } | undefined;
      return row && { doc: row.doc, version: row.version };
    },

    async addPending(treeId, op) {
      await db.put("cloudPending", { opId: op.opId, treeId, seq: nextSeq(), op });
    },

    async removePending(opIds) {
      if (opIds.length === 0) return;
      await inTransaction(db, ["cloudPending"], async (tx) => {
        const store = tx.objectStore("cloudPending");
        await Promise.all(opIds.map((id) => store.delete(id)));
      });
    },

    async listPending(treeId) {
      const rows = (await db.getAllFromIndex("cloudPending", "treeId", treeId)) as {
        seq: number;
        op: PendingOp;
      }[];
      return rows.toSorted((a, b) => a.seq - b.seq).map((r) => r.op);
    },

    async getMeta(id) {
      return (await db.get("meta", id)) as TreeMeta | undefined;
    },

    async setCloud(id, cloud) {
      await inTransaction(db, ["meta"], async (tx) => {
        const store = tx.objectStore("meta");
        const meta = (await store.get(id)) as TreeMeta | undefined;
        if (!meta) return;
        const { cloud: _old, ...rest } = meta;
        await store.put(cloud === null ? rest : { ...rest, cloud });
      });
    },

    async duplicateTree(id, name) {
      const found = await repo.getTree(id);
      if (!found) throw new Error(`Tree ${id} not found`);
      const now = new Date().toISOString();
      const copy: TreeDocument = {
        ...found.doc,
        id: newId(),
        name,
        createdAt: now,
        updatedAt: now,
      };
      await repo.saveTree(copy);
      return copy;
    },

    async putPhoto(id, blob) {
      await db.put("photos", blob, id);
    },

    async getPhoto(id) {
      return (await db.get("photos", id)) as Blob | undefined;
    },

    async deleteUnusedPhotos(keep = []) {
      let deleted = 0;
      // One transaction: a tree saved meanwhile cannot slip in between the read and the deletes.
      await inTransaction(db, ["trees", "snapshots", "photos"], async (tx) => {
        const [trees, snapshots, photoKeys] = await Promise.all([
          tx.objectStore("trees").getAll(),
          tx.objectStore("snapshots").getAll() as Promise<Snapshot[]>,
          tx.objectStore("photos").getAllKeys(),
        ]);
        const used = new Set<string>(keep);
        for (const tree of trees) for (const id of photoIdsOf(tree)) used.add(id);
        for (const snapshot of snapshots) for (const id of photoIdsOf(snapshot.doc)) used.add(id);
        const unused = photoKeys.filter((key) => typeof key !== "string" || !used.has(key));
        deleted = unused.length;
        await Promise.all(unused.map((key) => tx.objectStore("photos").delete(key)));
      });
      return deleted;
    },

    async takeSnapshot(doc, opts = {}) {
      await inTransaction(db, ["snapshots"], async (tx) => {
        const store = tx.objectStore("snapshots");
        if (opts.ifChanged) {
          // Autoincrement keys ascend with time, so the last one is the newest snapshot.
          const all = (await store.index("treeId").getAll(doc.id)) as Snapshot[];
          if (all.at(-1)?.doc.updatedAt === doc.updatedAt) return;
        }
        const snapshot: Snapshot = { treeId: doc.id, takenAt: new Date().toISOString(), doc };
        await store.add(snapshot);
        const keys = await store.index("treeId").getAllKeys(doc.id);
        const excess = keys.slice(0, Math.max(0, keys.length - SNAPSHOT_LIMIT));
        await Promise.all(excess.map((key) => store.delete(key)));
      });
    },

    async getSetting<T>(key: string) {
      return (await db.get("settings", key)) as T | undefined;
    },

    async setSetting(key, value) {
      await db.put("settings", value, key);
    },
  };
  return repo;
}
