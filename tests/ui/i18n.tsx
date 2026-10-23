import i18next from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import en from "@/i18n/locales/en.json";

/** An i18next instance loaded with the real English strings, for component tests. */
export const testI18n = i18next.createInstance();
await testI18n.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

export const t = testI18n.t;

export function withI18n(ui: ReactNode): ReactNode {
  return <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>;
}

const nativeMatchMedia = window.matchMedia.bind(window);

/** Makes `matchMedia('(prefers-reduced-motion: reduce)')` match or not; other queries pass through. */
export function reduceMotion(on: boolean): void {
  window.matchMedia = (query: string): MediaQueryList => {
    if (!query.includes("prefers-reduced-motion")) return nativeMatchMedia(query);
    const list = {
      matches: on,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
    return list as MediaQueryList;
  };
}
