import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import type { Language } from "@/ui/settings/settings";

import en from "./locales/en.json";

export type LanguageInfo = {
  code: Language;
  /** The language's name in its own language and script, as a language picker lists it. */
  name: string;
  dir: "ltr" | "rtl";
};

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "ur", name: "اردو", dir: "rtl" },
  { code: "ar", name: "العربية", dir: "rtl" },
];

const isLanguage = (lang: string): lang is Language => LANGUAGES.some((l) => l.code === lang);

// English is bundled, so the first paint never waits. Urdu and Arabic are separate chunks,
// fetched the first time they are chosen: the English first load doesn't carry them.
const LOADERS: Record<Exclude<Language, "en">, () => Promise<{ default: object }>> = {
  ur: () => import("./locales/ur.json"),
  ar: () => import("./locales/ar.json"),
};

/** Keeps `<html lang dir>` in step with a language. The font stack follows `lang` in fonts.css. */
export function applyDocumentLanguage(language: string, doc?: Document): void {
  const target = doc ?? (typeof document === "undefined" ? undefined : document);
  if (!target) return;
  target.documentElement.lang = language;
  target.documentElement.dir = i18next.dir(language);
}

const syncDocument = (language: string) => applyDocumentLanguage(language);

// Resources are bundled, so init finishes synchronously and components can render right away.
void i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: LANGUAGES.map((l) => l.code),
  resources: { en: { translation: en } },
  // React escapes what it renders; escaping here would turn "&" in a name into "&amp;".
  // `{{count, number}}` in the Urdu and Arabic files formats through Intl in that locale.
  interpolation: { escapeValue: false },
  initAsync: false,
});

syncDocument(i18next.language);
i18next.on("languageChanged", syncDocument);

/** Fetches a language's strings, once. English is always there. */
export async function loadLanguage(lang: Language): Promise<void> {
  if (lang === "en" || !isLanguage(lang)) return;
  if (i18next.hasResourceBundle(lang, "translation")) return;
  const { default: strings } = await LOADERS[lang]();
  i18next.addResourceBundle(lang, "translation", strings, true, true);
}

let latest: Language = "en";
let pending: Promise<void> = Promise.resolve();

/**
 * Switches the interface language (loading it first); anything unknown means English. The last
 * choice wins: a language that finishes loading after a newer choice does not switch to itself.
 */
export function setLanguage(lang: Language): Promise<void> {
  const target = isLanguage(lang) ? lang : "en";
  latest = target;
  const switching = loadLanguage(target)
    .catch(() => {
      // Offline before the chunk was ever cached: stay in the current language.
    })
    .then(async () => {
      if (latest !== target || !i18next.hasResourceBundle(target, "translation")) return;
      if (i18next.language !== target) await i18next.changeLanguage(target);
    });
  pending = switching;
  return switching;
}

/** Settles once the most recent `setLanguage` has loaded and switched. */
export async function languageReady(): Promise<void> {
  let seen: Promise<void>;
  do {
    seen = pending;
    await seen;
  } while (seen !== pending);
}

/**
 * Whether a language's translation still waits for a native speaker's review: its file carries a
 * `_review` note until a reviewer removes it. A language not loaded yet counts as in review.
 */
export function isInReview(lang: Language): boolean {
  if (lang === "en") return false;
  if (!i18next.hasResourceBundle(lang, "translation")) return true;
  return i18next.getResource(lang, "translation", "_review") !== undefined;
}

export const i18n = i18next;
