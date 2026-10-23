/** The schema version this build reads and writes. */
export const CURRENT_SCHEMA_VERSION = 1;

export type TreeMigration = (tree: Record<string, unknown>) => Record<string, unknown>;

/**
 * `migrations[v]` upgrades a tree document from schema version `v` to `v + 1`. It runs on raw,
 * unchecked data, before the shape check. Version 1 is the first release, so the table is empty.
 */
export const migrations: Record<number, TreeMigration> = {};
