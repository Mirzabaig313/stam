// The app's own strings, for selectors in any interface language: `tFor("ar")("toolbar.undo")`
// reads ar.json through i18next exactly as the app does (plurals, {{count, number}}), so a spec
// can drive the real Urdu or Arabic interface without copying its words.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createInstance, type TOptions } from "i18next";

export type Lang = "en" | "ur" | "ar";
export type T = (key: string, options?: TOptions) => string;

// Read from disk: Playwright loads specs as ES modules, where a JSON import needs an attribute.
const locale = (lang: Lang): object =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "../src/i18n/locales", `${lang}.json`), "utf8"),
  );

const instance = createInstance();
void instance.init({
  lng: "en",
  fallbackLng: false,
  resources: {
    en: { translation: locale("en") },
    ur: { translation: locale("ur") },
    ar: { translation: locale("ar") },
  },
  interpolation: { escapeValue: false },
  initAsync: false,
});

const cache = new Map<Lang, T>();

/** The strings of one language; a key missing there throws, so a selector never falls back. */
export function tFor(lang: Lang): T {
  let t = cache.get(lang);
  if (!t) {
    const fixed = instance.getFixedT(lang);
    t = (key, options) => {
      if (!instance.exists(key, { lng: lang, ...options })) {
        throw new Error(`e2e strings: no "${key}" in ${lang}`);
      }
      return fixed(key, options) as string;
    };
    cache.set(lang, t);
  }
  return t;
}

/** English: the default for helpers. */
export const EN = tFor("en");
