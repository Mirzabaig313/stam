export const APP_NAME = "Stam";

/** Maximum number of undo entries kept per editing session. */
export const UNDO_LIMIT = 200;

/** Maximum number of snapshots kept per tree. */
export const SNAPSHOT_LIMIT = 5;

/** Autosave fires this long after the last edit. */
export const AUTOSAVE_DEBOUNCE_MS = 500;

/** Autosave never waits longer than this while edits keep arriving. */
export const AUTOSAVE_MAX_WAIT_MS = 1000;

/** The tree size the app is tuned for (layout, views, the bench); bigger imports ask first. */
export const TUNED_PEOPLE = 5000;
