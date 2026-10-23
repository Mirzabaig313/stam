import { describe, expect, test } from "bun:test";

import ar from "@/i18n/locales/ar.json";
import en from "@/i18n/locales/en.json";
import ur from "@/i18n/locales/ur.json";

// Every language has every English string, with the plural forms its own grammar needs (i18next
// picks them through Intl.PluralRules), the same {{placeholders}} and the same <tags/>.

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
const PLURAL = new RegExp(`^(.*?)(_ordinal)?_(${CATEGORIES.join("|")})$`);

/** `people_one` → `{ base: "people", ordinal: false }`; null for a plain key. */
function pluralOf(key: string): { base: string; ordinal: boolean } | null {
  const match = PLURAL.exec(key);
  return match ? { base: match[1]!, ordinal: match[2] !== undefined } : null;
}

/**
 * The keys a language must have for English's keys: plural keys get its own categories. A count
 * English says one way ("{{count}} times removed") may take this language's plural forms instead.
 */
function expectedKeys(
  lang: string,
  english: Map<string, string>,
  strings: Map<string, string>,
): Set<string> {
  const cardinal = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  const ordinal = new Intl.PluralRules(lang, { type: "ordinal" }).resolvedOptions()
    .pluralCategories;
  const keys = new Set<string>();
  for (const key of english.keys()) {
    const plural = pluralOf(key);
    if (!plural) {
      if (strings.has(key) || !strings.has(`${key}_other`)) keys.add(key);
      else for (const c of cardinal) keys.add(`${key}_${c}`);
    } else if (plural.ordinal) for (const c of ordinal) keys.add(`${plural.base}_ordinal_${c}`);
    else for (const c of cardinal) keys.add(`${plural.base}_${c}`);
  }
  return keys;
}

/** The English string a key translates: the `_other` form for plurals. */
function source(key: string, english: Map<string, string>): string {
  const plural = pluralOf(key);
  if (!plural) return english.get(key)!;
  const other = english.get(`${plural.base}${plural.ordinal ? "_ordinal" : ""}_other`);
  return other ?? english.get(plural.base)!;
}

const placeholders = (s: string) =>
  new Set([...s.matchAll(/{{\s*([\w.]+)[^}]*}}/g)].map((m) => m[1]!));
const tags = (s: string) => [...s.matchAll(/<\/?[a-z]+\/?>/gi)].map((m) => m[0]).toSorted();

const english = flatten(en as Tree);

describe.each([
  ["ur", ur],
  ["ar", ar],
] as const)("%s locale", (lang, locale) => {
  const { _review: review, ...rest } = locale as Tree & { _review?: string };
  const strings = flatten(rest as Tree);

  test("is flagged as machine-assisted, for review by a native speaker", () => {
    expect(review).toBe("Machine-assisted translation. Needs review by a native speaker.");
  });

  test("has every English key, with this language's plural forms, and nothing else", () => {
    const expected = expectedKeys(lang, english, strings);
    // Each missing key with the English to translate, ready to copy into the locale file.
    const missing = [...expected]
      .filter((k) => !strings.has(k))
      .map((k) => `${k}: ${JSON.stringify(source(k, english))}`);
    const extra = [...strings.keys()].filter((k) => !expected.has(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  test("Arabic needs all six plural forms; Urdu two", () => {
    const forms = [...strings.keys()].filter((k) => k.startsWith("treeList.people_")).toSorted();
    expect(forms).toEqual(
      lang === "ar"
        ? CATEGORIES.map((c) => `treeList.people_${c}`).toSorted()
        : ["treeList.people_one", "treeList.people_other"],
    );
  });

  test("every string is translated: not empty, and not left in English", () => {
    const blank = [...strings].filter(([, v]) => !v.trim()).map(([k]) => k);
    expect(blank).toEqual([]);
    // Letters outside placeholders and tags: an untranslated sentence is all Latin.
    const latinOnly = [...strings]
      .filter(([, v]) => {
        const text = v.replace(/{{[^}]*}}/g, "").replace(/<[^>]*>/g, "");
        return /\p{L}/u.test(text) && !/[؀-ۿ]/u.test(text);
      })
      .map(([k]) => k);
    // Brand names, units and keys that are the same everywhere.
    expect(latinOnly.filter((k) => !SAME_EVERYWHERE.has(k))).toEqual([]);
  });

  test("arrows point the right-to-left way: back is →, forward is ←", () => {
    expect(strings.get("toolbar.backTo")).toStartWith("→");
    expect(strings.get("canvas.seeOriginal")).toEndWith("←");
  });

  test("keeps every {{placeholder}} and <tag/> of the English string", () => {
    const wrong: string[] = [];
    for (const [key, value] of strings) {
      const from = source(key, english);
      const want = placeholders(from);
      const got = placeholders(value);
      // A plural form may say the number in words ("شخص واحد"), so it may drop the number.
      const plural = pluralOf(key) !== null;
      const lost = [...want].filter((p) => !got.has(p) && !(plural && NUMBERS.has(p)));
      const invented = [...got].filter((p) => !want.has(p));
      if (lost.length || invented.length || tags(value).join() !== tags(from).join()) {
        wrong.push(key);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/** The placeholders plural forms count with. */
const NUMBERS = new Set(["count", "n"]);

/** Strings whose only letters are a key name every keyboard prints in Latin. */
const SAME_EVERYWHERE = new Set(["views.shortcut"]);

describe("locale files", () => {
  // JSON.parse keeps the last of two equal keys, so a merge that repeats one silently changes it.
  test.each(["en", "ur", "ar"])("%s.json has no key written twice in one object", async (lang) => {
    const text = await Bun.file(`${import.meta.dir}/../../src/i18n/locales/${lang}.json`).text();
    const repeated: string[] = [];
    const stack: Set<string>[] = [];
    for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:|[{}]/g)) {
      if (match[0] === "{") stack.push(new Set());
      else if (match[0] === "}") stack.pop();
      else {
        const keys = stack.at(-1)!;
        if (keys.has(match[1]!)) repeated.push(match[1]!);
        keys.add(match[1]!);
      }
    }
    expect(repeated).toEqual([]);
  });
});
