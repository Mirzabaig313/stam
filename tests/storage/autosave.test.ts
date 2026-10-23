import { describe, expect, test } from "bun:test";

import { createAutosaver } from "@/storage/autosave";

import { famSimple } from "../fixtures/families";

type Status = "idle" | "saving" | "saved" | "error";

/** A manual clock: timers only fire when `advance` moves time past them. */
function fakeClock() {
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
    pending: () => timers.size,
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function setup(save?: (doc: unknown) => Promise<void>) {
  const clock = fakeClock();
  const saved: unknown[] = [];
  const autosaver = createAutosaver(
    save ??
      (async (doc) => {
        saved.push(doc);
      }),
    { timers: clock.timers },
  );
  const statuses: Status[] = [];
  autosaver.onStatus((s) => statuses.push(s));
  return { clock, saved, autosaver, statuses };
}

const docN = (n: number) => ({ ...famSimple(), name: `v${n}` });

describe("createAutosaver", () => {
  test("three schedule calls within 400 ms save once after 500 ms, with the latest doc", async () => {
    const { clock, saved, autosaver } = setup();
    autosaver.schedule(docN(1));
    await clock.advance(200);
    autosaver.schedule(docN(2));
    await clock.advance(200);
    autosaver.schedule(docN(3));
    await clock.advance(499);
    expect(saved).toHaveLength(0);
    await clock.advance(1);
    expect(saved).toHaveLength(1);
    expect((saved[0] as { name: string }).name).toBe("v3");
    await clock.advance(5000);
    expect(saved).toHaveLength(1);
  });

  test("continuous scheduling every 300 ms still saves by 1000 ms", async () => {
    const { clock, saved, autosaver } = setup();
    autosaver.schedule(docN(0));
    for (let i = 1; i <= 3; i++) {
      await clock.advance(300);
      autosaver.schedule(docN(i));
    }
    // t = 900: debounce alone would wait until 1400; max wait forces a save at 1000.
    expect(saved).toHaveLength(0);
    await clock.advance(99);
    expect(saved).toHaveLength(0);
    await clock.advance(1);
    expect(saved).toHaveLength(1);
    expect((saved[0] as { name: string }).name).toBe("v3");
  });

  test("the max-wait window restarts after each save", async () => {
    const { clock, saved, autosaver } = setup();
    autosaver.schedule(docN(1));
    await clock.advance(500);
    expect(saved).toHaveLength(1);
    autosaver.schedule(docN(2));
    await clock.advance(499);
    expect(saved).toHaveLength(1);
    await clock.advance(1);
    expect(saved).toHaveLength(2);
  });

  test("status goes saving then saved", async () => {
    const { clock, autosaver, statuses } = setup();
    autosaver.schedule(docN(1));
    await clock.advance(500);
    expect(statuses).toEqual(["saving", "saved"]);
  });

  test("status is saving from the first change, through the debounce", async () => {
    const { clock, autosaver, statuses } = setup();
    autosaver.schedule(docN(1));
    expect(statuses).toEqual(["saving"]);
    await clock.advance(300);
    autosaver.schedule(docN(2)); // a further change does not announce again
    expect(statuses).toEqual(["saving"]);
    await clock.advance(500);
    expect(statuses).toEqual(["saving", "saved"]);
  });

  test("a rejected save emits 'error'", async () => {
    const { clock, autosaver, statuses } = setup(async () => {
      throw new Error("quota");
    });
    autosaver.schedule(docN(1));
    await clock.advance(500);
    expect(statuses).toEqual(["saving", "error"]);
  });

  test("flush saves immediately and cancels the timer", async () => {
    const { clock, saved, autosaver } = setup();
    autosaver.schedule(docN(1));
    await autosaver.flush();
    expect(saved).toHaveLength(1);
    expect(clock.pending()).toBe(0);
    await clock.advance(5000);
    expect(saved).toHaveLength(1);
  });

  test("flush with nothing pending resolves without saving", async () => {
    const { saved, autosaver } = setup();
    await autosaver.flush();
    expect(saved).toHaveLength(0);
  });

  test("flush rejects when the save fails, and retries the same doc next time", async () => {
    let fail = true;
    const saved: unknown[] = [];
    const { autosaver } = setup(async (doc) => {
      if (fail) throw new Error("disk full");
      saved.push(doc);
    });
    autosaver.schedule(docN(1));
    await expect(autosaver.flush()).rejects.toThrow("disk full");
    fail = false;
    await autosaver.flush();
    expect((saved[0] as { name: string }).name).toBe("v1");
  });

  test("an edit scheduled during a save is saved afterwards, never concurrently", async () => {
    const clock = fakeClock();
    const order: string[] = [];
    const gate = Promise.withResolvers<void>();
    const autosaver = createAutosaver(
      async (doc) => {
        order.push(`start ${doc.name}`);
        if (doc.name === "v1") await gate.promise;
        order.push(`end ${doc.name}`);
      },
      { timers: clock.timers },
    );
    autosaver.schedule(docN(1));
    await clock.advance(500);
    autosaver.schedule(docN(2));
    await clock.advance(500);
    expect(order).toEqual(["start v1"]);
    gate.resolve();
    await settle();
    expect(order).toEqual(["start v1", "end v1", "start v2", "end v2"]);
  });

  test("a listener that throws does not break saving or other listeners", async () => {
    const { clock, saved, autosaver, statuses } = setup();
    autosaver.onStatus(() => {
      throw new Error("listener bug");
    });
    autosaver.schedule(docN(1));
    await clock.advance(500);
    expect(saved).toHaveLength(1);
    expect(statuses).toEqual(["saving", "saved"]);
    autosaver.schedule(docN(2));
    await clock.advance(500);
    expect(saved).toHaveLength(2);
  });

  test("a failed timer save is retried once after the debounce delay", async () => {
    let attempts = 0;
    const saved: string[] = [];
    const { clock, autosaver, statuses } = setup(async (doc) => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      saved.push((doc as { name: string }).name);
    });
    autosaver.schedule(docN(1));
    await clock.advance(500);
    expect(statuses).toEqual(["saving", "error"]);
    await clock.advance(499);
    expect(attempts).toBe(1);
    await clock.advance(1);
    expect(attempts).toBe(2);
    expect(saved).toEqual(["v1"]);
    expect(statuses).toEqual(["saving", "error", "saving", "saved"]);
  });

  test("the retry happens only once; a second failure waits for the next edit or flush", async () => {
    let attempts = 0;
    const { clock, autosaver } = setup(async () => {
      attempts++;
      throw new Error("down");
    });
    autosaver.schedule(docN(1));
    await clock.advance(5000);
    expect(attempts).toBe(2);
    autosaver.schedule(docN(2));
    await clock.advance(500);
    expect(attempts).toBe(3);
  });

  test("a newer edit supersedes the pending retry", async () => {
    let attempts = 0;
    const saved: string[] = [];
    const { clock, autosaver } = setup(async (doc) => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      saved.push((doc as { name: string }).name);
    });
    autosaver.schedule(docN(1));
    await clock.advance(500);
    autosaver.schedule(docN(2));
    await clock.advance(500);
    expect(saved).toEqual(["v2"]);
    await clock.advance(5000);
    expect(saved).toEqual(["v2"]);
  });

  test("onStatus returns an unsubscribe function", async () => {
    const { clock, autosaver } = setup();
    const seen: Status[] = [];
    const off = autosaver.onStatus((s) => seen.push(s));
    off();
    autosaver.schedule(docN(1));
    await clock.advance(500);
    expect(seen).toEqual([]);
  });

  test("stop drops the waiting edit, saves nothing more and goes quiet", async () => {
    const { clock, saved, autosaver, statuses } = setup();
    autosaver.schedule(docN(1));
    autosaver.stop();
    expect(statuses.at(-1)).toBe("idle");
    await clock.advance(5000);
    autosaver.schedule(docN(2));
    await autosaver.flush();
    await clock.advance(5000);
    expect(saved).toEqual([]);
    expect(statuses.at(-1)).toBe("idle");
  });

  test("a save in flight that fails after stop reports nothing and is not retried", async () => {
    let calls = 0;
    let fail!: (e: Error) => void;
    const { clock, autosaver, statuses } = setup(() => {
      calls++;
      return new Promise((_, reject) => {
        fail = reject;
      });
    });
    autosaver.schedule(docN(1));
    await clock.advance(500);
    autosaver.stop();
    fail(new Error("stale"));
    await clock.advance(5000);
    expect(calls).toBe(1);
    expect(statuses).not.toContain("error");
    expect(statuses.at(-1)).toBe("idle");
  });
});
