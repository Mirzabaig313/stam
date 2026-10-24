import { describe } from "bun:test";

/** The local Worker (`wrangler dev`) that `bun run test:worker` starts; unset in plain `bun test`. */
export const WORKER_URL = process.env.WORKER_URL ?? "";

/** A describe block that runs only against a live local Worker. */
export const describeWorker = describe.skipIf(WORKER_URL === "");

export function url(path: string): string {
  return new URL(path, WORKER_URL).toString();
}

/** The Worker's own origin, as browsers send it on same-origin requests. */
export const ORIGIN = WORKER_URL.replace(/\/$/, "");

/** Bun's own fetch: the test preload replaces the global one with happy-dom's browser fetch. */
export const http: typeof fetch = Bun.fetch;
