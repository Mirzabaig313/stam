import { HUE_COUNT } from "@/ui/settings/colorModes";

/**
 * A warm initials background for a name: one of the six album hues, always the same for the same
 * name (FNV-1a over its code points, case and surrounding space ignored), so a person keeps their
 * colour on the canvas, in the panel and in lists. An empty name gets hue 0.
 */
export function avatarHue(name: string): number {
  const key = name.trim().toLocaleLowerCase();
  if (key === "") return 0;
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % HUE_COUNT;
}

/** "AK" for "Ali Khan", "Z" for "Zainab", "" for nothing: the first letter of the first two words. */
export function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}
