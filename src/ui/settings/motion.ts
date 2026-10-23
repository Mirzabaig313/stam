import { useCallback, useContext, useSyncExternalStore } from "react";

import { RepoContext } from "@/ui/app/RepoContext";

/**
 * "Reduce motion": `system` follows the OS (prefers-reduced-motion), `reduce` and `full` override
 * it. Kept apart from `Settings` (the shared contract) and applied as `<html data-motion>`, which
 * the stylesheets and `prefersReducedMotion()` read.
 */
export type MotionPref = "system" | "reduce" | "full";
export const MOTION_PREFS: readonly MotionPref[] = ["system", "reduce", "full"];
export const MOTION_KEY = "motion";
export const MOTION_CACHE_KEY = "stam:motion";

const clean = (v: unknown): MotionPref =>
  MOTION_PREFS.includes(v as MotionPref) ? (v as MotionPref) : "system";

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function cachedMotion(): MotionPref {
  try {
    return clean(storage()?.getItem(MOTION_CACHE_KEY));
  } catch {
    return "system";
  }
}

function writeCache(p: MotionPref): void {
  try {
    storage()?.setItem(MOTION_CACHE_KEY, p);
  } catch {
    // refused: the repo still has it
  }
}

export async function loadMotion(repo: {
  getSetting<T>(k: string): Promise<T | undefined>;
}): Promise<MotionPref> {
  const p = clean(await repo.getSetting<unknown>(MOTION_KEY));
  writeCache(p);
  return p;
}

export async function saveMotion(
  repo: { setSetting(k: string, v: unknown): Promise<void> },
  p: MotionPref,
): Promise<void> {
  writeCache(p);
  await repo.setSetting(MOTION_KEY, clean(p));
}

export function applyMotion(p: MotionPref, doc: Document = document): void {
  if (p === "system") doc.documentElement.removeAttribute("data-motion");
  else doc.documentElement.setAttribute("data-motion", p);
}

let current: MotionPref = cachedMotion();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;

export function setCurrentMotion(p: MotionPref): void {
  const changed = p !== current;
  current = p;
  applyMotion(p);
  if (changed) for (const l of listeners) l();
}

/** Applies the cached choice at once, then whatever the repo holds. */
export async function startMotion(repo?: {
  getSetting<T>(k: string): Promise<T | undefined>;
}): Promise<void> {
  setCurrentMotion(cachedMotion());
  if (!repo) return;
  try {
    setCurrentMotion(await loadMotion(repo));
  } catch {
    // keep the cached choice
  }
}

export function useMotionPref(): [MotionPref, (p: MotionPref) => void] {
  const repo = useContext(RepoContext);
  const pref = useSyncExternalStore(subscribe, snapshot, snapshot);
  const set = useCallback(
    (p: MotionPref) => {
      setCurrentMotion(p);
      if (repo) saveMotion(repo, p).catch(() => {});
      else writeCache(p);
    },
    [repo],
  );
  return [pref, set];
}
