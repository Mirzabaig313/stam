import type { Gender } from "@/core/model/types";

/**
 * One "Name" field. Two or more words: the last word is the last name, the rest the first
 * name. One word: a first name, with `inheritLastName` as the last name. Blank gives null.
 */
export function parseNameEntry(
  text: string,
  inheritLastName = "",
): { firstName: string; lastName: string } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return { firstName: words[0]!, lastName: inheritLastName };
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1]! };
}

export type AddRole = "first" | "child" | "spouse" | "parent" | "sibling";

const opposite = (g: Gender): Gender => (g === "male" ? "female" : "male");

/** The preselected gender for a new person; null means the user must choose. */
export function defaultGender(
  role: AddRole,
  ctx: { partnerGender?: Gender; existingParentGender?: Gender },
): Gender | null {
  switch (role) {
    case "spouse":
      return ctx.partnerGender ? opposite(ctx.partnerGender) : null;
    case "parent":
      return ctx.existingParentGender ? opposite(ctx.existingParentGender) : null;
    case "first":
    case "child":
    case "sibling":
      return null;
  }
}
