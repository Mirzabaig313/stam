import { useCallback, useContext, useSyncExternalStore } from "react";

import { i18n, languageReady, setLanguage } from "@/i18n";
import { RepoContext } from "@/ui/app/RepoContext";

// ---- Shared contract (M4 plan): every lane builds against these declarations ----------------

export type Language = "en" | "ur" | "ar";
export type Theme = "light" | "dark" | "classic" | "print";
export type ColorMode = "gender" | "branch" | "generation";
export type TreeDirection = "auto" | "ltr" | "rtl"; // auto = follow the interface language
export type Settings = {
  language: Language;
  theme: Theme;
  colorMode: ColorMode;
  treeDirection: TreeDirection;
};
export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  theme: "light",
  colorMode: "gender",
  treeDirection: "auto",
};

// ---- Values ----------------------------------------------------------------------------------

export const LANGUAGES: readonly Language[] = ["en", "ur", "ar"];
export const THEMES: readonly Theme[] = ["light", "dark", "classic", "print"];
export const COLOR_MODES: readonly ColorMode[] = ["gender", "branch", "generation"];
export const TREE_DIRECTIONS: readonly TreeDirection[] = ["auto", "ltr", "rtl"];

/** The repo key the settings are stored under. */
export const SETTINGS_KEY = "ui";
/**
 * A copy in localStorage, read synchronously before the first paint (the repo is IndexedDB, which
 * only answers asynchronously). `src/app/boot.js` and the landing page's flags script read it too.
 */
export const SETTINGS_CACHE_KEY = "stam:settings";

/** Each theme's ground, for `<meta name="theme-color">` (the browser's own chrome). */
export const THEME_GROUND: Record<Theme, string> = {
  light: "#f4eeea",
  dark: "#1a1418",
  classic: "#f4eeea",
  print: "#ffffff",
};

const CHOICES: { [K in keyof Settings]: readonly Settings[K][] } = {
  language: LANGUAGES,
  theme: THEMES,
  colorMode: COLOR_MODES,
  treeDirection: TREE_DIRECTIONS,
};

/** Settings from anything stored: known keys with known values only, the rest from the defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(CHOICES) as (keyof Settings)[]) {
    if (!Object.hasOwn(record, key)) continue;
    const value = record[key];
    if ((CHOICES[key] as readonly unknown[]).includes(value)) {
      (out as Record<keyof Settings, unknown>)[key] = value;
    }
  }
  return out;
}

const sameSettings = (a: Settings, b: Settings) =>
  (Object.keys(CHOICES) as (keyof Settings)[]).every((k) => a[k] === b[k]);

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // some browsers throw on the getter when storage is blocked
  }
}

/** The cached settings, synchronously; the defaults when there is no cache or it is unreadable. */
export function cachedSettings(storage: Storage | undefined = defaultStorage()): Settings {
  try {
    const text = storage?.getItem(SETTINGS_CACHE_KEY);
    return normalizeSettings(text ? JSON.parse(text) : undefined);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Whether the user picked the theme themselves (in Settings), rather than living with the
 * default. Stored next to the settings as `themeChosen: true`, in the repo and in the cache: the
 * landing page takes the app's theme only then, and otherwise follows the OS.
 */
function cachedThemeChosen(storage: Storage | undefined = defaultStorage()): boolean {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(SETTINGS_CACHE_KEY) ?? "null");
    return (parsed as { themeChosen?: unknown } | null)?.themeChosen === true;
  } catch {
    return false;
  }
}

const withChoice = (s: Settings, chosen: boolean): Settings & { themeChosen?: true } =>
  chosen ? { ...s, themeChosen: true } : s;

function writeCache(
  s: Settings,
  chosen: boolean,
  storage: Storage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(SETTINGS_CACHE_KEY, JSON.stringify(withChoice(s, chosen)));
  } catch {
    // Storage refused (private mode, quota): the repo still has the settings.
  }
}

/** Persisted with repo.setSetting("ui", settings); applied to <html lang dir data-theme data-color-mode>. */
export async function loadSettings(repo: {
  getSetting<T>(k: string): Promise<T | undefined>;
}): Promise<Settings> {
  const raw = await repo.getSetting<unknown>(SETTINGS_KEY);
  const s = normalizeSettings(raw);
  const chosen =
    (raw as { themeChosen?: unknown } | null)?.themeChosen === true ||
    cachedThemeChosen() ||
    // Stored before the flag existed: a theme other than the default can only have been chosen.
    s.theme !== DEFAULT_SETTINGS.theme;
  writeCache(s, chosen);
  return s;
}

/**
 * Saves the settings to the repo and the cache. `themeChosen` when the user has just picked the
 * theme; an earlier choice is kept. `savedAt` (ms) says when they were chosen, so the newer of
 * this device's and the account's copy wins (src/cloud/settingsSync.ts); now by default.
 */
export async function saveSettings(
  repo: { setSetting(k: string, v: unknown): Promise<void> },
  s: Settings,
  opts: { themeChosen?: boolean; savedAt?: number } = {},
): Promise<void> {
  const clean = normalizeSettings(s);
  const chosen = opts.themeChosen === true || cachedThemeChosen();
  writeCache(clean, chosen);
  await repo.setSetting(SETTINGS_KEY, {
    ...withChoice(clean, chosen),
    savedAt: opts.savedAt ?? Date.now(),
  });
}

/** When the stored settings were chosen (ms); 0 when never (or stored before this was kept). */
export async function settingsSavedAt(repo: {
  getSetting<T>(k: string): Promise<T | undefined>;
}): Promise<number> {
  const raw = await repo.getSetting<{ savedAt?: unknown }>(SETTINGS_KEY).catch(() => undefined);
  return typeof raw?.savedAt === "number" ? raw.savedAt : 0;
}

/** Told each time the user changes a setting here (not when one arrives from the account). */
const savedListeners = new Set<(s: Settings, savedAt: number) => void>();

export function onSettingsChosen(listener: (s: Settings, savedAt: number) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

/** Sets lang, dir (via i18n), data-theme and data-color-mode, and the browser's theme colour. */
export function applySettings(s: Settings, doc: Document = document): void {
  const root = doc.documentElement;
  // Strings load on demand (Urdu and Arabic are separate chunks); lang and dir apply at once.
  if (doc === globalThis.document) void setLanguage(s.language);
  root.lang = s.language;
  root.dir = i18n.dir(s.language);
  root.setAttribute("data-theme", s.theme);
  root.setAttribute("data-color-mode", s.colorMode);
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_GROUND[s.theme];
  }
}

// ---- The live settings, shared by every component -------------------------------------------

let current: Settings = cachedSettings();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The settings in effect now. */
export function currentSettings(): Settings {
  return current;
}

/** Makes `s` the live settings: applied to the page and announced to `useSettings`. */
export function setCurrentSettings(s: Settings): void {
  const next = normalizeSettings(s);
  const changed = !sameSettings(next, current);
  current = next;
  applySettings(next);
  if (changed) for (const l of listeners) l();
}

/**
 * Before the first render: applies the cached settings synchronously (no flash of the wrong theme),
 * then reads the repo and applies what it holds if that differs.
 */
export async function startSettings(repo?: {
  getSetting<T>(k: string): Promise<T | undefined>;
}): Promise<void> {
  setCurrentSettings(cachedSettings());
  if (repo) {
    try {
      setCurrentSettings(await loadSettings(repo));
    } catch {
      // The repo could not be read: keep the cached settings.
    }
  }
  // The first render waits for the chosen language's strings.
  await languageReady();
}

/** The live settings and a setter that applies a change at once and persists it through the repo. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const repo = useContext(RepoContext);
  const settings = useSyncExternalStore(subscribe, currentSettings, currentSettings);
  const update = useCallback(
    (patch: Partial<Settings>) => {
      const next = normalizeSettings({ ...current, ...patch });
      setCurrentSettings(next);
      const themeChosen = patch.theme !== undefined;
      const savedAt = Date.now();
      if (repo) saveSettings(repo, next, { themeChosen, savedAt }).catch(() => {});
      else writeCache(next, themeChosen || cachedThemeChosen());
      for (const listener of savedListeners) listener(next, savedAt);
    },
    [repo],
  );
  return [settings, update];
}
