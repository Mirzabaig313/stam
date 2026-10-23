import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { i18n, languageReady } from "@/i18n";
import {
  applySettings,
  cachedSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type Settings,
  SETTINGS_CACHE_KEY,
  startSettings,
} from "@/ui/settings/settings";

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

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  localStorage.clear();
  for (const name of ["data-theme", "data-color-mode"]) root().removeAttribute(name);
  await i18n.changeLanguage("en");
});

describe("normalizeSettings", () => {
  test("fills what is missing from the defaults", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: "dark" })).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
  });

  test("drops unknown values and unknown keys", () => {
    const s = normalizeSettings({
      language: "fr",
      theme: "neon",
      colorMode: "branch",
      treeDirection: 3,
      __proto__: { theme: "dark" },
      extra: true,
    });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, colorMode: "branch" });
    expect(Object.keys(s).toSorted()).toEqual(["colorMode", "language", "theme", "treeDirection"]);
  });

  test("anything that is not an object gives the defaults", () => {
    for (const raw of [null, 42, "dark", [], true]) {
      expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });
});

describe("load and save", () => {
  test("loads the stored settings from the repo under 'ui'", async () => {
    const repo = memoryRepo({ ui: { ...DEFAULT_SETTINGS, theme: "classic" } });
    expect(await loadSettings(repo)).toEqual({ ...DEFAULT_SETTINGS, theme: "classic" });
  });

  test("nothing stored: the defaults", async () => {
    expect(await loadSettings(memoryRepo())).toEqual(DEFAULT_SETTINGS);
  });

  test("a broken stored value is cleaned, not trusted", async () => {
    const repo = memoryRepo({ ui: { theme: "<script>", colorMode: "generation" } });
    expect(await loadSettings(repo)).toEqual({ ...DEFAULT_SETTINGS, colorMode: "generation" });
  });

  test("save writes the repo and the localStorage cache", async () => {
    const repo = memoryRepo();
    const s: Settings = {
      language: "ur",
      theme: "dark",
      colorMode: "branch",
      treeDirection: "rtl",
    };
    await saveSettings(repo, s);
    expect(repo.store.get("ui")).toEqual(s);
    expect(JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY)!)).toEqual(s);
    expect(cachedSettings()).toEqual(s);
  });

  test("load refreshes the cache, so the next first paint matches the repo", async () => {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({ theme: "dark" }));
    await loadSettings(memoryRepo({ ui: { ...DEFAULT_SETTINGS, theme: "print" } }));
    expect(cachedSettings().theme).toBe("print");
  });

  test("the cache reads defaults when it is empty, broken or refused", () => {
    expect(cachedSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_CACHE_KEY, "{not json");
    expect(cachedSettings()).toEqual(DEFAULT_SETTINGS);
    const refusing = {
      getItem() {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(cachedSettings(refusing)).toEqual(DEFAULT_SETTINGS);
  });
});

const cache = () => JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY)!);

describe("the landing page's theme: only an explicit choice is cached for it", () => {
  test("loading the default settings does not mark the theme as chosen", async () => {
    await loadSettings(memoryRepo());
    expect(cache().theme).toBe("light");
    expect(cache().themeChosen).toBeUndefined();
    // The landing page then follows the OS.
    new Function(readFileSync("src/site/flags.js", "utf8"))();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  test("saving a language change does not mark the theme as chosen either", async () => {
    const repo = memoryRepo();
    await saveSettings(repo, { ...DEFAULT_SETTINGS, language: "ar" });
    expect(cache().themeChosen).toBeUndefined();
    await loadSettings(repo);
    expect(cache().themeChosen).toBeUndefined();
  });

  test("an explicit theme choice is cached and stored, and survives later loads and saves", async () => {
    const repo = memoryRepo();
    await saveSettings(repo, { ...DEFAULT_SETTINGS, theme: "light" }, { themeChosen: true });
    expect(cache()).toEqual({ ...DEFAULT_SETTINGS, themeChosen: true });
    expect(repo.store.get("ui")).toEqual({ ...DEFAULT_SETTINGS, themeChosen: true });
    // A fresh cache (another browser profile, cleared storage) learns it from the repo.
    localStorage.clear();
    expect(await loadSettings(repo)).toEqual(DEFAULT_SETTINGS);
    expect(cache().themeChosen).toBe(true);
    await saveSettings(repo, { ...DEFAULT_SETTINGS, language: "ur" });
    expect(cache().themeChosen).toBe(true);
    new Function(readFileSync("src/site/flags.js", "utf8"))();
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  test("a non-default theme stored before the flag existed counts as chosen", async () => {
    await loadSettings(memoryRepo({ ui: { ...DEFAULT_SETTINGS, theme: "dark" } }));
    expect(cache().themeChosen).toBe(true);
  });
});

describe("startSettings", () => {
  test("resolves only once the chosen language's strings are in, so the first render is translated", async () => {
    i18n.removeResourceBundle("ur", "translation");
    localStorage.setItem(
      SETTINGS_CACHE_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, language: "ur" }),
    );
    await startSettings();
    expect(i18n.language).toBe("ur");
    expect(i18n.t("common.cancel")).toBe("منسوخ کریں");
    await startSettings(memoryRepo({ ui: { ...DEFAULT_SETTINGS, language: "ar" } }));
    expect(i18n.t("common.cancel")).toBe("إلغاء");
    await startSettings(memoryRepo());
    expect(i18n.language).toBe("en");
  });
});

describe("applySettings", () => {
  test("sets data-theme and data-color-mode on <html>", () => {
    applySettings({ ...DEFAULT_SETTINGS, theme: "dark", colorMode: "generation" });
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().getAttribute("data-color-mode")).toBe("generation");
  });

  test("sets lang and dir at once, and loads and switches the strings", async () => {
    i18n.removeResourceBundle("ar", "translation");
    applySettings({ ...DEFAULT_SETTINGS, language: "ar" });
    expect(root().lang).toBe("ar");
    expect(root().dir).toBe("rtl");
    await languageReady();
    expect(i18n.language).toBe("ar");
    expect(i18n.t("common.cancel")).toBe("إلغاء");
    expect(root().dir).toBe("rtl");
    applySettings(DEFAULT_SETTINGS);
    expect(root().lang).toBe("en");
    expect(root().dir).toBe("ltr");
  });

  test("works on another document", () => {
    const other = document.implementation.createHTMLDocument("x");
    applySettings({ ...DEFAULT_SETTINGS, theme: "print", language: "ur" }, other);
    expect(other.documentElement.getAttribute("data-theme")).toBe("print");
    expect(other.documentElement.lang).toBe("ur");
    expect(other.documentElement.dir).toBe("rtl");
  });

  test("keeps the theme-color meta in step with the ground", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#F4F5F2";
    document.head.append(meta);
    applySettings({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(meta.content.toLowerCase()).toBe("#0f110f");
    applySettings({ ...DEFAULT_SETTINGS, theme: "print" });
    expect(meta.content.toLowerCase()).toBe("#ffffff");
    meta.remove();
  });
});
