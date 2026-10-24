export const APP_NAME = "Stam";

/**
 * The backend in production: the Worker on workers.dev, another site than the app (Pages). The
 * Pages CSP is built from it (scripts/build.ts). Change it when the Worker's address changes.
 */
export const PRODUCTION_API_ORIGIN = "https://stam.stammirzalabs.workers.dev";

/** Where the app calls the API. In development the dev server passes `/api` on to the Worker. */
export const API_ORIGIN = process.env.NODE_ENV === "production" ? PRODUCTION_API_ORIGIN : "";

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
