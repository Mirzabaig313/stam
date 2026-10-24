import type { FuzzyDate } from "@/core/dates/fuzzy";
import { newId } from "@/core/model/ids";
import { createTree } from "@/core/model/tree";
import type {
  ChildType,
  Gender,
  Person,
  TreeDocument,
  Union,
  UnionStatus,
} from "@/core/model/types";
import { validate } from "@/core/model/validate";
import { ImportError } from "@/io/json/errors";
import { isSharedId, parseTreeDocument } from "@/io/json/parseTree";

import type { CharsetWarning } from "./charset";
import { parseGedcomDate } from "./dates";
import { type GedNode, isPointer, parseLines, unescapeValue } from "./lines";

/**
 * Why a line did not make it into the tree:
 * - UNSUPPORTED: a tag the app has no place for (occupations, sources, burial…);
 * - BAD_LINE: not GEDCOM at all;
 * - BAD_DATE: a date that cannot be kept (a phrase, another calendar, an impossible day);
 * - MISSING_REF: a pointer to a record that is not in the file;
 * - DUPLICATE_RECORD: a second record with an xref already used;
 * - EXTRA_RECORD: a second name, sex, birth, death or marriage where one is kept;
 * - EXTRA_PARTNER: a third partner in a family;
 * - NO_PARTNERS: a family with no parents; its children are imported without them;
 * - SECOND_BIRTH_FAMILY: a person is a birth child of two families; the first is kept;
 * - CYCLE: a link that would make someone their own ancestor.
 */
export type SkipReason =
  | "UNSUPPORTED"
  | "BAD_LINE"
  | "BAD_DATE"
  | "MISSING_REF"
  | "DUPLICATE_RECORD"
  | "EXTRA_RECORD"
  | "EXTRA_PARTNER"
  | "NO_PARTNERS"
  | "SECOND_BIRTH_FAMILY"
  | "CYCLE";

export type GedcomSkip = { line: number; tag: string; reason: SkipReason };

/** Coded, not worded: the UI translates them. */
export type GedcomWarning =
  /** People with no usable SEX; their gender was guessed (HUSB male, WIFE female, else male). */
  | { code: "UNKNOWN_SEX"; people: string[] }
  /** Lines that were joined to the line before or had a level that jumped ahead. */
  | { code: "MALFORMED_LINES"; count: number }
  | { code: "NO_HEADER" }
  /** People whose notes ran past `limit` characters and were cut short. */
  | { code: "NOTES_CUT"; people: string[]; limit: number }
  /** The notes of the whole file ran past `limit` characters: `count` people's were cut or left out. */
  | { code: "NOTES_FULL"; count: number; limit: number }
  | CharsetWarning;

export type GedcomReport = {
  people: number;
  families: number;
  skipped: GedcomSkip[];
  warnings: GedcomWarning[];
};

export type GedcomImport = { doc: TreeDocument; report: GedcomReport };

export type ParseGedcomOptions = {
  /** The tree's name when the file does not carry one (the file name, say). */
  name?: string;
  now?: Date;
};

/**
 * Caps on note text. A shared NOTE record is copied into every person that points at it, so a
 * small file could otherwise grow into gigabytes of notes.
 */
export const NOTES_PER_PERSON = 20_000;
export const NOTES_PER_FILE = 5_000_000;

/**
 * Joins a person's notes (blank ones left out) without building more than `max` characters,
 * ending a cut one with "…". Never splits a surrogate pair.
 */
function joinNotes(notes: string[], max: number): { text: string; cut: boolean } {
  const SEP = "\n\n";
  let text = "";
  for (const note of notes) {
    if (note === "") continue;
    const piece = text === "" ? note : SEP + note;
    if (text.length + piece.length <= max) {
      text += piece;
      continue;
    }
    if (max <= 0) return { text, cut: true };
    let end = Math.max(0, max - 1 - text.length);
    const code = piece.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
    text = (text + piece.slice(0, end)).trimEnd() + "…";
    return { text, cut: true };
  }
  return { text, cut: false };
}

/** Someone born this long ago with no death record is taken as deceased (other apps' files). */
const LIVING_YEARS = 110;

/** Bookkeeping tags with no family data: read past without a report line. */
const QUIET = new Set(["CHAN", "RIN", "_UID", "UID", "EXID", "_UPD", "SUBM", "NCHI"]);

const STATUSES: Record<string, UnionStatus> = {
  MARRIED: "married",
  PARTNER: "partner",
  UNMARRIED: "partner",
  ENGAGED: "engaged",
  DIVORCED: "divorced",
  SEPARATED: "separated",
  WIDOWED: "widowed",
};

type Event = { date?: FuzzyDate; place?: string };
type Ref = { xref: string; line: number; tag: string };

type PersonDraft = {
  id: string;
  xref?: string;
  firstName: string;
  lastName: string;
  nickname?: string;
  nativeName?: string;
  sex?: Gender;
  role?: Gender;
  dead: boolean;
  placeholder: boolean;
  birth?: Event;
  death?: Event;
  notes: string[];
  famc: (Ref & { type?: ChildType })[];
  fams: Ref[];
};

type FamDraft = {
  id: string;
  xref?: string;
  line: number;
  partners: (Ref & { role: Gender })[];
  children: (Ref & { type?: ChildType })[];
  stat?: UnionStatus;
  events: Partial<Record<FamEvent, Event>>;
};

function child(node: GedNode | undefined, tag: string): GedNode | undefined {
  return node?.children.find((c) => c.tag === tag);
}

function pointer(node: GedNode): string | undefined {
  const v = node.value?.trim();
  return isPointer(v) ? v : undefined;
}

function hasData(e: Event | undefined): e is Event {
  return e !== undefined && (e.date !== undefined || e.place !== undefined);
}

type FamEvent = "marr" | "enga" | "div" | "sepr" | "end" | "stat";
const FAM_EVENTS: Record<string, FamEvent> = {
  MARR: "marr",
  ENGA: "enga",
  DIV: "div",
  _SEPR: "sepr",
  _END: "end",
  _STAT: "stat",
};

type BuiltUnion = { union: Union; childLines: Map<string, Ref> };

function splitName(value: string): { given: string; surname: string } {
  const v = value.replace(/\s+/g, " ").trim();
  const match = /^(.*?)\/(.*?)(?:\/(.*))?$/.exec(v);
  if (!match) return { given: v, surname: "" };
  const suffix = (match[3] ?? "").trim();
  return {
    given: match[1]!.trim(),
    surname: [match[2]!.trim(), suffix].filter(Boolean).join(" "),
  };
}

function relType(value: string): ChildType | undefined {
  const v = value.trim().toLowerCase();
  if (v.includes("step")) return "step";
  if (v.includes("adopt")) return "adopted";
  if (v.includes("foster")) return "foster";
  if (["birth", "natural", "biological", "sealing"].includes(v)) return "biological";
  return undefined;
}

/**
 * Reads a GEDCOM 5.5.1 or 7.0 file into a valid tree, leniently: anything it cannot keep is
 * listed in the report rather than failing the import. Throws `ImportError("NOT_GEDCOM")` only
 * when the text has no GEDCOM records at all, and `INVALID_TREE` should the result still fail
 * validation (it should not: links that break the model are dropped and reported).
 */
export function parseGedcom(text: string, opts: ParseGedcomOptions = {}): GedcomImport {
  const now = opts.now ?? new Date();
  const { records, issues } = parseLines(text);
  if (!records.some((r) => r.tag === "HEAD" || r.tag === "INDI" || r.tag === "FAM")) {
    throw new ImportError("NOT_GEDCOM", "This file has no GEDCOM records");
  }

  const skipped: GedcomSkip[] = [];
  const warnings: GedcomWarning[] = [];
  const skip = (node: { line: number; tag: string }, reason: SkipReason) =>
    skipped.push({ line: node.line, tag: node.tag, reason });

  for (const issue of issues) {
    if (issue.reason === "BAD_LINE")
      skipped.push({ line: issue.line, tag: "", reason: "BAD_LINE" });
  }
  const malformed = issues.filter((i) => i.reason !== "BAD_LINE").length;
  if (malformed > 0) warnings.push({ code: "MALFORMED_LINES", count: malformed });

  const head = records.find((r) => r.tag === "HEAD");
  if (!head) warnings.push({ code: "NO_HEADER" });
  const v7 = (child(child(head, "GEDC"), "VERS")?.value?.trim() ?? "").startsWith("7");
  /** Our own export: values are exact, so nothing is trimmed and the living flag is trusted. */
  const fromStam = child(head, "SOUR")?.value?.trim().toUpperCase() === "STAM";

  const valueOf = (node: GedNode) =>
    node.value === undefined ? "" : unescapeValue(node.value, v7);
  const clean = (s: string) => (fromStam ? s : s.trim());

  // ---------------------------------------------------------------- ids

  const usedPersonIds = new Set<string>();
  const usedUnionIds = new Set<string>();
  /** Keeps the file's xref as the id when it is a safe one, so re-imports keep their ids. */
  function deriveId(xref: string | undefined, prefix: "I" | "F", used: Set<string>): string {
    let candidate = xref?.slice(1, -1);
    if (candidate !== undefined && fromStam && candidate.startsWith(prefix)) {
      candidate = candidate.slice(1);
    }
    if (candidate === undefined || !isSharedId(candidate) || used.has(candidate)) {
      do candidate = newId();
      while (used.has(candidate));
    }
    used.add(candidate);
    return candidate;
  }

  // ---------------------------------------------------------------- shared notes

  const sharedNotes = new Map<string, string>();
  for (const r of records) {
    if ((r.tag === "NOTE" || r.tag === "SNOTE") && r.xref && !sharedNotes.has(r.xref)) {
      // Cleaned once here, not again in each of the (possibly thousands of) people citing it.
      sharedNotes.set(r.xref, clean(valueOf(r)));
    }
  }

  // ---------------------------------------------------------------- events

  function readEvent(node: GedNode, placeAllowed: boolean): Event {
    const event: Event = {};
    for (const c of node.children) {
      if (c.tag === "DATE") {
        const date = parseGedcomDate(valueOf(c));
        if (!date) skip(c, "BAD_DATE");
        else if (event.date) skip(c, "EXTRA_RECORD");
        else event.date = date;
      } else if (c.tag === "PLAC" && placeAllowed) {
        const place = clean(valueOf(c));
        if (event.place === undefined && (fromStam || place !== "")) event.place = place;
      } else if (!QUIET.has(c.tag) && c.tag !== "TYPE") {
        skip(c, "UNSUPPORTED");
      }
    }
    return event;
  }

  // ---------------------------------------------------------------- INDI

  function readPerson(r: GedNode): PersonDraft {
    const d: PersonDraft = {
      id: deriveId(r.xref, "I", usedPersonIds),
      firstName: "",
      lastName: "",
      dead: false,
      placeholder: false,
      notes: [],
      famc: [],
      fams: [],
    };
    if (r.xref) d.xref = r.xref;
    let named = false;
    let sexSeen = false;
    let birthSeen = false;
    let deathSeen = false;

    for (const c of r.children) {
      switch (c.tag) {
        case "NAME": {
          const type = child(c, "TYPE");
          if (type && valueOf(type).trim().toLowerCase() === "native") {
            if (d.nativeName === undefined) d.nativeName = clean(valueOf(c));
            else skip(c, "EXTRA_RECORD");
            break;
          }
          if (named) {
            skip(c, "EXTRA_RECORD");
            break;
          }
          named = true;
          const split = splitName(valueOf(c));
          const givn = child(c, "GIVN");
          const surn = child(c, "SURN");
          if (fromStam) {
            d.firstName = givn ? valueOf(givn) : split.given;
            d.lastName = surn ? valueOf(surn) : split.surname;
          } else {
            // Slashes mark the surname, and win; without them GIVN and SURN are the better split.
            const slashed = valueOf(c).includes("/");
            const givnText = givn ? valueOf(givn).trim() : "";
            const surnText = surn ? valueOf(surn).trim() : "";
            const structured = !slashed && (givn !== undefined || surn !== undefined);
            d.firstName = structured ? givnText : split.given || givnText;
            d.lastName = structured ? surnText : split.surname || surnText;
          }
          const nick = child(c, "NICK");
          if (nick) d.nickname = clean(valueOf(nick));
          for (const sub of c.children) {
            if (!["GIVN", "SURN", "NICK", "TYPE", "NPFX", "NSFX", "SPFX"].includes(sub.tag)) {
              skip(sub, "UNSUPPORTED");
            }
          }
          break;
        }
        case "SEX": {
          if (sexSeen) {
            skip(c, "EXTRA_RECORD");
            break;
          }
          sexSeen = true;
          const v = valueOf(c).trim().toUpperCase();
          if (v === "M" || v === "MALE") d.sex = "male";
          else if (v === "F" || v === "FEMALE") d.sex = "female";
          break;
        }
        case "BIRT":
          if (birthSeen) skip(c, "EXTRA_RECORD");
          else {
            birthSeen = true;
            d.birth = readEvent(c, true);
          }
          break;
        case "DEAT":
          d.dead = true;
          if (deathSeen) skip(c, "EXTRA_RECORD");
          else {
            deathSeen = true;
            d.death = readEvent(c, true);
          }
          break;
        case "BURI":
        case "CREM":
          d.dead = true;
          skip(c, "UNSUPPORTED");
          break;
        case "NOTE":
        case "SNOTE": {
          const ptr = pointer(c);
          if (ptr === undefined) d.notes.push(clean(valueOf(c)));
          else if (sharedNotes.has(ptr)) d.notes.push(sharedNotes.get(ptr)!);
          else skip(c, "MISSING_REF");
          break;
        }
        case "FAMC": {
          const ptr = pointer(c);
          if (ptr === undefined) {
            skip(c, "MISSING_REF");
            break;
          }
          const pedi = child(c, "PEDI");
          let type: ChildType | undefined;
          if (pedi) {
            type = relType(valueOf(pedi));
            const phrase = child(pedi, "PHRASE");
            if (type === undefined && phrase) type = relType(valueOf(phrase));
          }
          d.famc.push({ xref: ptr, line: c.line, tag: c.tag, ...(type ? { type } : {}) });
          break;
        }
        case "FAMS": {
          const ptr = pointer(c);
          if (ptr === undefined) skip(c, "MISSING_REF");
          else d.fams.push({ xref: ptr, line: c.line, tag: c.tag });
          break;
        }
        case "_PLACEHOLDER":
          d.placeholder = valueOf(c).trim().toUpperCase() === "Y";
          break;
        default:
          if (!QUIET.has(c.tag)) skip(c, "UNSUPPORTED");
      }
    }
    return d;
  }

  // ---------------------------------------------------------------- FAM

  function readFamily(r: GedNode): FamDraft {
    const f: FamDraft = {
      id: deriveId(r.xref, "F", usedUnionIds),
      line: r.line,
      partners: [],
      children: [],
      events: {},
    };
    if (r.xref) f.xref = r.xref;
    for (const c of r.children) {
      switch (c.tag) {
        case "HUSB":
        case "WIFE":
        case "CHIL": {
          const ptr = pointer(c);
          if (ptr === "@VOID@") break;
          if (ptr === undefined) {
            skip(c, "MISSING_REF");
            break;
          }
          if (c.tag === "CHIL") {
            const rels = [child(c, "_FREL"), child(c, "_MREL")].map((n) =>
              n ? relType(valueOf(n)) : undefined,
            );
            const type =
              rels.find((t) => t !== undefined && t !== "biological") ?? rels.find(Boolean);
            f.children.push({ xref: ptr, line: c.line, tag: c.tag, ...(type ? { type } : {}) });
          } else {
            f.partners.push({
              xref: ptr,
              line: c.line,
              tag: c.tag,
              role: c.tag === "HUSB" ? "male" : "female",
            });
          }
          break;
        }
        case "MARR":
        case "ENGA":
        case "DIV":
        case "_SEPR":
        case "_END":
        case "_STAT": {
          const key = FAM_EVENTS[c.tag]!;
          if (f.events[key]) {
            skip(c, "EXTRA_RECORD");
            break;
          }
          if (c.tag === "_STAT") {
            const status = STATUSES[valueOf(c).trim().toUpperCase()];
            if (status) f.stat = status;
          }
          f.events[key] = readEvent(c, false);
          break;
        }
        default:
          if (!QUIET.has(c.tag)) skip(c, "UNSUPPORTED");
      }
    }
    return f;
  }

  // ---------------------------------------------------------------- records

  const people: PersonDraft[] = [];
  const personByXref = new Map<string, PersonDraft>();
  const families: FamDraft[] = [];
  const familyByXref = new Map<string, FamDraft>();
  let rootXref: string | undefined;
  let treeName: string | undefined;

  for (const r of records) {
    switch (r.tag) {
      case "HEAD":
        if (fromStam) {
          const root = child(r, "_ROOT");
          if (root) rootXref = pointer(root);
          const name = child(r, "_TREE");
          if (name) treeName = valueOf(name);
        }
        break;
      case "INDI":
        if (r.xref && personByXref.has(r.xref)) skip(r, "DUPLICATE_RECORD");
        else {
          const d = readPerson(r);
          people.push(d);
          if (r.xref) personByXref.set(r.xref, d);
        }
        break;
      case "FAM":
        if (r.xref && familyByXref.has(r.xref)) skip(r, "DUPLICATE_RECORD");
        else {
          const f = readFamily(r);
          families.push(f);
          if (r.xref) familyByXref.set(r.xref, f);
        }
        break;
      case "NOTE":
      case "SNOTE":
      case "TRLR":
      case "SUBM":
      case "SUBN":
        break;
      default:
        skip(r, "UNSUPPORTED");
    }
  }

  // ---------------------------------------------------------------- unions

  /** Links written only on the person's side (FAMS/FAMC with no matching HUSB/WIFE/CHIL). */
  const famsOf = new Map<string, { person: PersonDraft; ref: Ref }[]>();
  const famcOf = new Map<string, { person: PersonDraft; ref: Ref & { type?: ChildType } }[]>();
  for (const person of people) {
    for (const ref of person.fams) {
      if (!familyByXref.has(ref.xref)) skip(ref, "MISSING_REF");
      else famsOf.set(ref.xref, [...(famsOf.get(ref.xref) ?? []), { person, ref }]);
    }
    for (const ref of person.famc) {
      if (!familyByXref.has(ref.xref)) skip(ref, "MISSING_REF");
      else famcOf.set(ref.xref, [...(famcOf.get(ref.xref) ?? []), { person, ref }]);
    }
  }

  const built: BuiltUnion[] = [];
  const unionIdByXref = new Map<string, string>();

  for (const f of families) {
    const partners: string[] = [];
    const addPartner = (person: PersonDraft | undefined, ref: Ref, role?: Gender) => {
      if (!person) return skip(ref, "MISSING_REF");
      if (partners.includes(person.id)) return;
      if (partners.length === 2) return skip(ref, "EXTRA_PARTNER");
      partners.push(person.id);
      if (role) person.role ??= role;
    };
    for (const p of f.partners) addPartner(personByXref.get(p.xref), p, p.role);
    for (const { person, ref } of f.xref ? (famsOf.get(f.xref) ?? []) : []) {
      if (!partners.includes(person.id)) addPartner(person, ref);
    }

    const children: Union["children"] = [];
    const childLines = new Map<string, Ref>();
    const ownAncestor = new Set<string>();
    const addChild = (person: PersonDraft | undefined, ref: Ref, fallback?: ChildType) => {
      if (!person) return skip(ref, "MISSING_REF");
      if (partners.includes(person.id)) {
        if (!ownAncestor.has(person.id)) skip(ref, "CYCLE");
        ownAncestor.add(person.id);
        return;
      }
      if (childLines.has(person.id)) return;
      const famcType = person.famc.find((x) => x.xref === f.xref)?.type;
      children.push({ personId: person.id, type: famcType ?? fallback ?? "biological" });
      childLines.set(person.id, ref);
    };
    for (const c of f.children) addChild(personByXref.get(c.xref), c, c.type);
    for (const { person, ref } of f.xref ? (famcOf.get(f.xref) ?? []) : []) {
      if (!childLines.has(person.id)) addChild(person, ref);
    }

    if (partners.length === 0) {
      skip({ line: f.line, tag: "FAM" }, "NO_PARTNERS");
      continue;
    }

    const e = f.events;
    const status: UnionStatus =
      f.stat ??
      (e.div
        ? "divorced"
        : e.sepr
          ? "separated"
          : e.marr
            ? "married"
            : e.enga
              ? "engaged"
              : "married");
    const start = e.marr?.date ?? e.enga?.date ?? e.stat?.date;
    const end = e.div?.date ?? e.sepr?.date ?? e.end?.date;
    const union: Union = {
      id: f.id,
      partners: partners as Union["partners"],
      status,
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      children,
    };
    built.push({ union, childLines });
    if (f.xref) unionIdByXref.set(f.xref, f.id);
  }

  // A person is the birth child of one family only: the first in their own FAMC order wins.
  const personById = new Map(people.map((p) => [p.id, p]));
  const birthFamilies = new Map<string, BuiltUnion[]>();
  for (const b of built) {
    for (const c of b.union.children) {
      if (c.type !== "biological") continue;
      birthFamilies.set(c.personId, [...(birthFamilies.get(c.personId) ?? []), b]);
    }
  }
  for (const [personId, list] of birthFamilies) {
    if (list.length < 2) continue;
    const famcOrder = (personById.get(personId)?.famc ?? []).map((r) => unionIdByXref.get(r.xref));
    const rank = (b: BuiltUnion) => {
      const i = famcOrder.indexOf(b.union.id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const keep = list.reduce((best, b) => (rank(b) < rank(best) ? b : best));
    for (const b of list) {
      if (b === keep) continue;
      b.union.children = b.union.children.filter((c) => c.personId !== personId);
      skip(b.childLines.get(personId)!, "SECOND_BIRTH_FAMILY");
    }
  }

  // ---------------------------------------------------------------- people

  const unknownSex: string[] = [];
  const notesCut: string[] = [];
  let notesLeft = NOTES_PER_FILE;
  let notesFull = 0;
  const persons: Record<string, Person> = {};
  for (const d of people) {
    const gender = d.sex ?? d.role ?? "male";
    const who = [d.firstName, d.lastName].filter(Boolean).join(" ") || d.xref || d.id;
    if (!d.sex) unknownSex.push(who);
    const birthYear = d.birth?.date?.year;
    const isLiving = fromStam
      ? !d.dead
      : !d.dead && !(birthYear !== undefined && birthYear <= now.getFullYear() - LIVING_YEARS);
    const own = joinNotes(d.notes, NOTES_PER_PERSON);
    if (own.cut) notesCut.push(who);
    const fits = joinNotes([own.text], Math.min(notesLeft, NOTES_PER_PERSON));
    // Within the file's limit only whole notes are kept or, at the edge, cut once.
    const notes = fits.cut && notesLeft <= 1 ? "" : fits.text;
    if (fits.cut) notesFull++;
    notesLeft -= notes.length;
    persons[d.id] = {
      id: d.id,
      firstName: d.firstName,
      lastName: d.lastName,
      ...(d.nickname !== undefined && d.nickname !== "" ? { nickname: d.nickname } : {}),
      ...(d.nativeName !== undefined && d.nativeName !== "" ? { nativeName: d.nativeName } : {}),
      gender,
      ...(d.placeholder ? { isPlaceholder: true } : {}),
      isLiving,
      ...(hasData(d.birth) ? { birth: d.birth } : {}),
      ...(hasData(d.death) ? { death: d.death } : {}),
      ...(notes !== "" ? { notes } : {}),
    };
  }
  if (unknownSex.length > 0) warnings.push({ code: "UNKNOWN_SEX", people: unknownSex });
  if (notesCut.length > 0) {
    warnings.push({ code: "NOTES_CUT", people: notesCut, limit: NOTES_PER_PERSON });
  }
  if (notesFull > 0) warnings.push({ code: "NOTES_FULL", count: notesFull, limit: NOTES_PER_FILE });

  const unions: Record<string, Union> = {};
  for (const b of built) unions[b.union.id] = b.union;

  // ---------------------------------------------------------------- union order

  const memberOf = new Map<string, string[]>();
  for (const b of built) {
    for (const p of b.union.partners) memberOf.set(p, [...(memberOf.get(p) ?? []), b.union.id]);
  }
  const unionOrder: Record<string, string[]> = {};
  for (const [personId, member] of memberOf) {
    const own = (personById.get(personId)?.fams ?? [])
      .map((r) => unionIdByXref.get(r.xref))
      .filter((id): id is string => id !== undefined && member.includes(id));
    unionOrder[personId] = [...new Set([...own, ...member])];
  }

  // ---------------------------------------------------------------- the tree

  const root = rootXref ? personByXref.get(rootXref)?.id : undefined;
  const doc: TreeDocument = {
    ...createTree(treeName || opts.name || "Family", now),
    ...(root ? { rootPersonId: root } : {}),
    persons,
    unions,
    unionOrder,
  };
  if (!root) delete doc.rootPersonId;

  breakCycles(doc, built, skip);
  skipped.sort((a, b) => a.line - b.line);

  return {
    doc: parseTreeDocument(doc),
    report: { people: people.length, families: built.length, skipped, warnings },
  };
}

/**
 * Drops the child links that make someone their own ancestor, one back edge per cycle and pass,
 * until the tree has none. Each pass removes at least one link, so it ends.
 */
function breakCycles(
  doc: TreeDocument,
  built: BuiltUnion[],
  skip: (node: { line: number; tag: string }, reason: SkipReason) => void,
): void {
  for (;;) {
    const cycles = validate(doc).filter((i) => i.code === "CYCLE");
    if (cycles.length === 0) return;
    let removed = false;
    for (const cycle of cycles) {
      const childId = cycle.ids[0]!;
      const parentId = cycle.ids.at(-1)!;
      for (const b of built) {
        if (!(b.union.partners as readonly string[]).includes(parentId)) continue;
        const before = b.union.children.length;
        b.union.children = b.union.children.filter((c) => c.personId !== childId);
        if (b.union.children.length < before) {
          removed = true;
          skip(b.childLines.get(childId)!, "CYCLE");
        }
      }
    }
    if (!removed) return;
  }
}
