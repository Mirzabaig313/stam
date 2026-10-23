import { createAutosaver } from "@/storage/autosave";
import { openStamDb } from "@/storage/db";
import { createTreeRepo, type TreeRepo } from "@/storage/treeRepo";

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A manual clock: timers only fire when `advance` moves time past them. */
export function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      setTimeout: ((fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, fn });
        return id;
      }) as unknown as typeof setTimeout,
      clearTimeout: ((id: number) => {
        timers.delete(id);
      }) as unknown as typeof clearTimeout,
      now: () => now,
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .toSorted((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await settle();
      }
      now = target;
      await settle();
    },
  };
}

/** A real repo on fake-indexeddb, a real autosaver on a fake clock, and a movable wall clock. */
export async function makeEditorEnv() {
  const db = await openStamDb(`stam-test-${crypto.randomUUID()}`);
  const repo: TreeRepo = createTreeRepo(db);
  const clock = fakeClock();
  const autosaver = createAutosaver((doc) => repo.saveTree(doc), { timers: clock.timers });
  let wall = new Date("2026-10-23T09:00:00.000Z").getTime();
  return {
    db,
    repo,
    autosaver,
    clock,
    now: () => new Date(wall),
    /** Moves the wall clock the store reads, without firing autosave timers. */
    tick(ms: number) {
      wall += ms;
    },
  };
}
