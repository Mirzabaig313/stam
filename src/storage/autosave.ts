import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS } from "@/config";
import type { TreeDocument } from "@/core/model/types";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

type Timers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  now: () => number;
};

const realTimers: Timers = {
  setTimeout: ((handler: () => void, ms?: number) =>
    globalThis.setTimeout(handler, ms)) as typeof setTimeout,
  clearTimeout: ((id: Parameters<typeof clearTimeout>[0]) =>
    globalThis.clearTimeout(id)) as typeof clearTimeout,
  now: () => Date.now(),
};

/**
 * Debounced saver: saves `debounceMs` after the last `schedule`, but never later than
 * `maxWaitMs` after the first unsaved one. Saves never overlap.
 */
export function createAutosaver(
  save: (doc: TreeDocument) => Promise<unknown>,
  opts: { debounceMs?: number; maxWaitMs?: number; timers?: Timers } = {},
) {
  const debounceMs = opts.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const maxWaitMs = opts.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;
  const timers = opts.timers ?? realTimers;

  let pending: TreeDocument | undefined;
  let firstScheduledAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** One automatic retry after a failed timer save; re-armed by any success or new edit. */
  let retryArmed = true;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(status: AutosaveStatus) => void>();
  let lastStatus: AutosaveStatus = "idle";
  /** Set by `stop`: nothing is saved or reported any more. */
  let stopped = false;

  // A listener bug must never break saving or the other listeners.
  const emit = (status: AutosaveStatus) => {
    if (stopped) return;
    lastStatus = status;
    for (const listener of listeners) {
      try {
        listener(status);
      } catch {
        // ignored on purpose
      }
    }
  };

  const clearTimer = () => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  };

  async function saveOnce(): Promise<void> {
    const doc = pending;
    if (!doc || stopped) return;
    pending = undefined;
    firstScheduledAt = undefined;
    if (lastStatus !== "saving") emit("saving");
    try {
      await save(doc);
    } catch (error) {
      if (stopped) throw error;
      // Keep the doc so a later flush retries it, unless a newer edit has arrived.
      pending ??= doc;
      emit("error");
      throw error;
    }
    retryArmed = true;
    if (!pending) emit("saved");
  }

  /** Runs when the debounce timer fires; a failed save is retried once after `debounceMs`. */
  function fire(): void {
    timer = undefined;
    enqueue().catch(() => {
      // The failure is reported through onStatus. Retry unless a newer edit already has a timer.
      if (!retryArmed || !pending || timer !== undefined) return;
      retryArmed = false;
      timer = timers.setTimeout(fire, debounceMs);
    });
  }

  /** Queues a save behind any save in flight. */
  function enqueue(): Promise<void> {
    const run = tail.then(saveOnce);
    tail = run.catch(() => {});
    return run;
  }

  return {
    schedule(doc: TreeDocument): void {
      if (stopped) return;
      pending = doc;
      retryArmed = true;
      // Unsaved from the first change, so the status never claims "saved" during the debounce.
      if (lastStatus !== "saving") emit("saving");
      const now = timers.now();
      firstScheduledAt ??= now;
      clearTimer();
      const delay = Math.max(0, Math.min(debounceMs, firstScheduledAt + maxWaitMs - now));
      timer = timers.setTimeout(fire, delay);
    },

    /** Saves any unsaved edit now. Rejects if that save fails. */
    async flush(): Promise<void> {
      clearTimer();
      await enqueue();
    },

    /**
     * Stops for good: drops any waiting edit, never saves again and reports "idle" (nothing to
     * say). For a tab that went read-only because its tree changed elsewhere.
     */
    stop(): void {
      clearTimer();
      pending = undefined;
      firstScheduledAt = undefined;
      emit("idle");
      stopped = true;
    },

    onStatus(cb: (status: AutosaveStatus) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
