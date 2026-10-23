import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { prefersReducedMotion } from "@/ui/canvas/motion";
import {
  applyMotion,
  cachedMotion,
  loadMotion,
  MOTION_CACHE_KEY,
  saveMotion,
} from "@/ui/settings/motion";

import { reduceMotion } from "../i18n";

function memoryRepo(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    async getSetting<T>(k: string) {
      return store.get(k) as T | undefined;
    },
    async setSetting(k: string, v: unknown) {
      store.set(k, v);
    },
  };
}

const root = () => document.documentElement;

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  root().removeAttribute("data-motion");
  reduceMotion(false);
});

describe("reduce motion", () => {
  test("follows the system by default", async () => {
    expect(cachedMotion()).toBe("system");
    expect(await loadMotion(memoryRepo())).toBe("system");
    applyMotion("system");
    expect(root().hasAttribute("data-motion")).toBe(false);
    reduceMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    reduceMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  test("a choice overrides the system either way", () => {
    reduceMotion(false);
    applyMotion("reduce");
    expect(root().getAttribute("data-motion")).toBe("reduce");
    expect(prefersReducedMotion()).toBe(true);
    reduceMotion(true);
    applyMotion("full");
    expect(root().getAttribute("data-motion")).toBe("full");
    expect(prefersReducedMotion()).toBe(false);
  });

  test("saved to the repo and the cache; junk reads as 'system'", async () => {
    const repo = memoryRepo();
    await saveMotion(repo, "reduce");
    expect(repo.store.get("motion")).toBe("reduce");
    expect(localStorage.getItem(MOTION_CACHE_KEY)).toBe("reduce");
    expect(cachedMotion()).toBe("reduce");
    expect(await loadMotion(memoryRepo({ motion: "sideways" }))).toBe("system");
  });
});
