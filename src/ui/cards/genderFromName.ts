import type { Gender } from "@/core/model/types";

/**
 * A first name as the list keys it: lower case, no Latin accents, Arabic-script letters folded to
 * one form (Arabic and Urdu yeh, kaf and heh; no harakat or tatweel), and "al-" / "el-" dropped.
 */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةه]/g, "ہ")
    .replace(/[أإآ]/g, "ا")
    .toLocaleLowerCase()
    .replace(/^(al|el)-/, "")
    .trim();
}

type Lookup = (firstName: string) => Gender | null;

let lookup: Promise<Lookup> | null = null;

/** The first-name list, loaded once, the first time an add editor asks for it. */
export function loadNameGenders(): Promise<Lookup> {
  lookup ??= import("./firstNames").then(({ FIRST_NAMES }) => {
    const byName = new Map<string, Gender>();
    for (const [name, gender] of FIRST_NAMES) byName.set(normaliseName(name), gender);
    return (first: string) => byName.get(normaliseName(first)) ?? null;
  });
  return lookup;
}

/**
 * The gender a new person gets, so the add editor never asks: the family's answer when there is
 * one (a spouse is the opposite of their partner, a second parent the opposite of the first), else
 * the first name's usual one, else the role's default. A wrong guess is one click in the panel.
 */
export function genderForNewPerson(
  fromFamily: Gender | null,
  name: string,
  byName: Lookup | null,
): Gender {
  if (fromFamily) return fromFamily;
  const first = name.trim().split(/\s+/)[0] ?? "";
  const guess = first && byName ? byName(first) : null;
  if (guess) return guess;
  // Unknown: a parent added first is a father, a new child or sibling a son; the panel changes it.
  return "male";
}
