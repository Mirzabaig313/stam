import { type IDBPDatabase, openDB } from "idb";

export const DB_VERSION = 1;

/** What can happen to the database because of another tab or the browser. */
export type DbEvents = {
  /** This tab wants a newer version, but another tab still has the old one open. */
  onBlocked?: () => void;
  /** Another tab wants a newer version: this connection has been closed to let it. */
  onBlocking?: () => void;
  /** The browser closed the connection (storage cleared, or a crash). */
  onTerminated?: () => void;
};

/**
 * Opens (and on first use creates) the local database. `version` exists for tests of upgrades;
 * the app always opens `DB_VERSION`.
 */
export function openStamDb(
  name = "stam",
  events: DbEvents = {},
  version = DB_VERSION,
): Promise<IDBPDatabase> {
  return openDB(name, version, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("trees", { keyPath: "id" });
        db.createObjectStore("meta", { keyPath: "id" });
        db.createObjectStore("photos");
        const snapshots = db.createObjectStore("snapshots", { autoIncrement: true });
        snapshots.createIndex("treeId", "treeId");
        db.createObjectStore("settings");
      }
    },
    blocked() {
      events.onBlocked?.();
    },
    blocking(_current, _next, event) {
      // Holding on would block the other tab's upgrade forever; this tab must reload instead.
      (event.target as IDBDatabase).close();
      events.onBlocking?.();
    },
    terminated() {
      events.onTerminated?.();
    },
  });
}
