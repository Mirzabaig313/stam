import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";

/** Keeps `<html lang dir>` in step with the active language. */
function syncDocument(language: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = i18next.dir(language);
}

// Resources are bundled, so init finishes synchronously and components can render right away.
void i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en } },
  // React escapes what it renders; escaping here would turn "&" in a name into "&amp;".
  interpolation: { escapeValue: false },
  initAsync: false,
});

syncDocument(i18next.language);
i18next.on("languageChanged", syncDocument);

export const i18n = i18next;
