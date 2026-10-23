import type { FuzzyDate } from "@/core/dates/fuzzy";
import type { ChildType, Person, TreeDocument, Union } from "@/core/model/types";

import { formatGedcomDate } from "./dates";

/** Longest line we write, level and tag included (GEDCOM 5.5.1 allows 255). */
export const MAX_LINE = 248;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const REL: Partial<Record<ChildType, string>> = {
  adopted: "Adopted",
  step: "Step",
  foster: "Foster",
};

/** The escaped length of a value: every "@" is written twice. */
function escapedLength(s: string): number {
  let n = s.length;
  for (const ch of s) if (ch === "@") n++;
  return n;
}

/**
 * Where to cut `s` so the escaped head fits `budget`: never inside a surrogate pair, and
 * preferably not next to a space (some readers trim line ends, which would lose it).
 */
function cutPoint(s: string, budget: number): number {
  let used = 0;
  let max = 0;
  while (max < s.length) {
    const add = s[max] === "@" ? 2 : 1;
    if (used + add > budget) break;
    used += add;
    max++;
  }
  if (max >= s.length) return s.length;
  const splitsPair = (i: number) =>
    /[\uDC00-\uDFFF]/.test(s[i] ?? "") && /[\uD800-\uDBFF]/.test(s[i - 1] ?? "");
  let cut = max;
  while (cut > 1 && splitsPair(cut)) cut--;
  for (let i = cut; i > Math.floor(max / 2); i--) {
    if (s[i] !== " " && s[i - 1] !== " " && !splitsPair(i)) return i;
  }
  return Math.max(1, cut);
}

class Lines {
  readonly out: string[] = [];

  /** A line whose value is a pointer (never escaped or split). */
  pointer(level: number, tag: string, xref: string): void {
    this.out.push(`${level} ${tag} ${xref}`);
  }

  /** A record line: `0 @xref@ TAG`. */
  record(xref: string, tag: string): void {
    this.out.push(`0 ${xref} ${tag}`);
  }

  /**
   * A text value: newlines become CONT lines, long lines continue with CONC, and every "@" is
   * doubled. An undefined value writes the tag alone.
   */
  text(level: number, tag: string, value?: string): void {
    if (value === undefined) {
      this.out.push(`${level} ${tag}`);
      return;
    }
    const segments = value.replace(/\r\n?/g, "\n").split("\n");
    segments.forEach((segment, i) => {
      let head = i === 0 ? `${level} ${tag}` : `${level + 1} CONT`;
      let rest = segment;
      for (;;) {
        if (rest === "") {
          this.out.push(head);
          return;
        }
        const budget = MAX_LINE - head.length - 1;
        if (escapedLength(rest) <= budget) {
          this.out.push(`${head} ${rest.replaceAll("@", "@@")}`);
          return;
        }
        const cut = cutPoint(rest, budget);
        this.out.push(`${head} ${rest.slice(0, cut).replaceAll("@", "@@")}`);
        rest = rest.slice(cut);
        head = `${level + 1} CONC`;
      }
    });
  }
}

const personXref = (id: string) => `@I${id}@`;
const familyXref = (id: string) => `@F${id}@`;

/** Names on the NAME line cannot hold "/", which marks the surname; GIVN and SURN keep them. */
const nameLinePart = (s: string) => s.replace(/\//g, " ").replace(/\s+/g, " ").trim();

function writeDate(lines: Lines, level: number, date: FuzzyDate | undefined): boolean {
  const value = date && formatGedcomDate(date);
  if (value === undefined) return false;
  lines.text(level, "DATE", value);
  return true;
}

/** An event with a date and place; "Y" when it happened but nothing more is known. */
function writeEvent(
  lines: Lines,
  tag: string,
  event: { date?: FuzzyDate; place?: string } | undefined,
  orY: boolean,
): void {
  const date = event?.date && formatGedcomDate(event.date);
  const place = event?.place;
  if (date === undefined && place === undefined) {
    if (orY) lines.text(1, tag, "Y");
    return;
  }
  lines.text(1, tag);
  if (date !== undefined) lines.text(2, "DATE", date);
  if (place !== undefined) lines.text(2, "PLAC", place);
}

function writePerson(lines: Lines, doc: TreeDocument, p: Person, childOf: Map<string, Union[]>) {
  lines.record(personXref(p.id), "INDI");

  const given = nameLinePart(p.firstName);
  const surname = nameLinePart(p.lastName);
  lines.text(1, "NAME", `${given}${given ? " " : ""}/${surname}/`);
  if (p.firstName !== "") lines.text(2, "GIVN", p.firstName);
  if (p.lastName !== "") lines.text(2, "SURN", p.lastName);
  if (p.nickname) lines.text(2, "NICK", p.nickname);
  if (p.nativeName) {
    lines.text(1, "NAME", p.nativeName);
    lines.text(2, "TYPE", "native");
  }

  lines.text(1, "SEX", p.gender === "male" ? "M" : "F");
  if (p.isPlaceholder) lines.text(1, "_PLACEHOLDER", "Y");
  if (p.birth) writeEvent(lines, "BIRT", p.birth, false);
  if (!p.isLiving || p.death) writeEvent(lines, "DEAT", p.death, true);
  if (p.notes) lines.text(1, "NOTE", p.notes);

  for (const union of childOf.get(p.id) ?? []) {
    lines.pointer(1, "FAMC", familyXref(union.id));
    const type = union.children.find((c) => c.personId === p.id)?.type;
    if (type === "adopted" || type === "foster") lines.text(2, "PEDI", type);
  }
  for (const unionId of doc.unionOrder[p.id] ?? []) {
    if (doc.unions[unionId]) lines.pointer(1, "FAMS", familyXref(unionId));
  }
}

function writeFamily(lines: Lines, doc: TreeDocument, u: Union) {
  lines.record(familyXref(u.id), "FAM");

  // Partner lines keep partner order. HUSB/WIFE follow gender when it differs; a same-gender
  // couple is HUSB then WIFE, as roles (GEDCOM 7.0 reads them that way).
  const genders = u.partners.map((id) => doc.persons[id]?.gender);
  const mixed = genders.length === 2 && genders[0] !== genders[1];
  u.partners.forEach((id, i) => {
    const tag =
      mixed || genders.length === 1
        ? genders[i] === "female"
          ? "WIFE"
          : "HUSB"
        : i === 0
          ? "HUSB"
          : "WIFE";
    lines.pointer(1, tag, personXref(id));
  });

  for (const c of u.children) {
    lines.pointer(1, "CHIL", personXref(c.personId));
    const rel = REL[c.type];
    if (rel) {
      lines.text(2, "_FREL", rel);
      lines.text(2, "_MREL", rel);
    }
  }

  switch (u.status) {
    case "partner":
      lines.text(1, "_STAT", "PARTNER");
      writeDate(lines, 2, u.start);
      break;
    case "engaged":
      lines.text(1, "_STAT", "ENGAGED");
      writeEvent(lines, "ENGA", { date: u.start }, true);
      break;
    case "married":
      writeEvent(lines, "MARR", { date: u.start }, true);
      break;
    default:
      lines.text(1, "_STAT", u.status.toUpperCase());
      writeEvent(lines, "MARR", { date: u.start }, true);
  }

  if (u.status === "divorced") writeEvent(lines, "DIV", { date: u.end }, true);
  else if (u.status === "separated") writeEvent(lines, "_SEPR", { date: u.end }, false);
  else writeEvent(lines, "_END", { date: u.end }, false);
}

/**
 * Writes a tree as GEDCOM 5.5.1 in UTF-8 (with a BOM and CRLF line ends). Xrefs come from the
 * ids (`@I<id>@`, `@F<id>@`), so a re-import keeps them. Photos are not written. Stam-only facts
 * use underscore tags other apps ignore: `_TREE`, `_ROOT`, `_STAT`, `_SEPR`, `_END`,
 * `_PLACEHOLDER`; child types also go in the common `_FREL`/`_MREL` and `PEDI`.
 */
export function writeGedcom(doc: TreeDocument, opts: { now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const lines = new Lines();

  lines.text(0, "HEAD");
  lines.text(1, "GEDC");
  lines.text(2, "VERS", "5.5.1");
  lines.text(2, "FORM", "LINEAGE-LINKED");
  lines.text(1, "CHAR", "UTF-8");
  lines.text(1, "SOUR", "STAM");
  lines.text(2, "NAME", "Stam");
  lines.text(1, "DATE", `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
  lines.pointer(1, "SUBM", "@U1@");
  lines.text(1, "_TREE", doc.name);
  if (doc.rootPersonId && doc.persons[doc.rootPersonId]) {
    lines.pointer(1, "_ROOT", personXref(doc.rootPersonId));
  }

  lines.record("@U1@", "SUBM");
  lines.text(1, "NAME", "Stam");

  const childOf = new Map<string, Union[]>();
  for (const u of Object.values(doc.unions)) {
    for (const c of u.children) childOf.set(c.personId, [...(childOf.get(c.personId) ?? []), u]);
  }
  for (const p of Object.values(doc.persons)) writePerson(lines, doc, p, childOf);
  for (const u of Object.values(doc.unions)) writeFamily(lines, doc, u);

  lines.text(0, "TRLR");
  return `﻿${lines.out.join("\r\n")}\r\n`;
}
