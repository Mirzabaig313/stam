import { afterEach, describe, expect, test } from "bun:test";

import { i18n, isInReview, LANGUAGES, loadLanguage, setLanguage } from "@/i18n";

afterEach(() => setLanguage("en"));

const html = () => document.documentElement;
const people = (count: number) => i18n.t("treeList.people", { count });

describe("languages", () => {
  test("the last choice wins while an earlier language is still loading", async () => {
    i18n.removeResourceBundle("ur", "translation");
    const first = setLanguage("ur");
    const second = setLanguage("en");
    await Promise.all([first, second]);
    expect(i18n.language).toBe("en");
    expect(html().lang).toBe("en");
  });

  test("English, Urdu and Arabic, each named in its own language and script", () => {
    expect(LANGUAGES.map(({ code, name, dir }) => [code, name, dir])).toEqual([
      ["en", "English", "ltr"],
      ["ur", "اردو", "rtl"],
      ["ar", "العربية", "rtl"],
    ]);
  });

  test("English is built in; Urdu and Arabic load when first chosen", async () => {
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    await loadLanguage("ur");
    expect(i18n.hasResourceBundle("ur", "translation")).toBe(true);
    expect(i18n.language).toBe("en"); // loading is not switching
  });

  test("switching to Arabic sets <html lang dir> and translates", async () => {
    await setLanguage("ar");
    expect(i18n.language).toBe("ar");
    expect(html().lang).toBe("ar");
    expect(html().dir).toBe("rtl");
    expect(i18n.t("common.cancel")).toBe("إلغاء");
    await setLanguage("en");
    expect(html().lang).toBe("en");
    expect(html().dir).toBe("ltr");
    expect(i18n.t("common.cancel")).toBe("Cancel");
  });

  test("Arabic uses all six plural forms", async () => {
    await setLanguage("ar");
    expect([0, 1, 2, 3, 11, 100].map(people)).toEqual([
      "لا أحد",
      "شخص واحد",
      "شخصان",
      `${num("ar", 3)} أشخاص`,
      `${num("ar", 11)} شخصًا`,
      `${num("ar", 100)} شخص`,
    ]);
  });

  test("Urdu has one and other, and counts are formatted for the locale", async () => {
    await setLanguage("ur");
    expect(html().dir).toBe("rtl");
    expect(i18n.t("treeList.people", { count: 1 })).toBe(`${num("ur", 1)} فرد`);
    expect(i18n.t("treeList.people", { count: 1200 })).toBe(`${num("ur", 1200)} افراد`);
  });

  test("a counted string English leaves plain takes Arabic's plural forms", async () => {
    await setLanguage("ar");
    expect(i18n.t("kinship.removalN", { count: 3 })).toBe(`بفارق ${num("ar", 3)} أجيال`);
    expect(i18n.t("kinship.removalN", { count: 12 })).toBe(`بفارق ${num("ar", 12)} جيلًا`);
  });

  test("Urdu and Arabic are flagged as in review until the flag is removed from the file", async () => {
    expect(isInReview("en")).toBe(false);
    expect(isInReview("ur")).toBe(true);
    await loadLanguage("ar");
    expect(isInReview("ar")).toBe(true);
    i18n.removeResourceBundle("ar", "translation");
    i18n.addResourceBundle("ar", "translation", { common: { cancel: "إلغاء" } });
    expect(isInReview("ar")).toBe(false);
    i18n.removeResourceBundle("ar", "translation");
  });

  test("an unknown language falls back to English", async () => {
    await setLanguage("xx" as never);
    expect(i18n.language).toBe("en");
  });
});

/** The number as the locale writes it by default (Arabic-Indic digits only if it does). */
function num(lang: string, n: number): string {
  return new Intl.NumberFormat(lang).format(n);
}
