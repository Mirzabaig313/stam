import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import type { Person, TreeDocument } from "@/core/model/types";
import { validate } from "@/core/model/validate";
import { applyPrivacy, isLivingPerson } from "@/export/render/privacy";
import {
  importGedcom,
  NOTES_PER_FILE,
  NOTES_PER_PERSON,
  parseGedcom,
  type SkipReason,
  writeGedcom,
} from "@/io/gedcom";
import { ImportError } from "@/io/json/errors";

import { arbFamily, runs } from "../../fixtures/arbitraries";
import { buildDeepFamily } from "../../fixtures/deepFamily";
import {
  docOf,
  famAdoptedOnly,
  famAdoption,
  famCousinMarriage,
  famHalfSiblings,
  famRemarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";

const FIXTURES = `${import.meta.dir}/../../fixtures/gedcom`;
const fixture = (name: string) => Bun.file(`${FIXTURES}/${name}`).text();
const NOW = new Date("2026-10-23T12:00:00Z");

/** Living as the card reads it; an empty death record says nothing GEDCOM can carry. */
function normalPerson(p: Person): Person {
  const { photoId: _photo, death, ...rest } = p;
  const out: Person = { ...rest, isLiving: isLivingPerson(p) };
  if (death && (death.date || death.place !== undefined)) out.death = death;
  if (out.birth && !out.birth.date && out.birth.place === undefined) delete out.birth;
  if (out.notes === "") delete out.notes;
  if (!out.isPlaceholder) delete out.isPlaceholder;
  return out;
}

/** What a GEDCOM round trip must keep: people, unions, child types, dates, order and root. */
function comparable(doc: TreeDocument) {
  return {
    name: doc.name,
    rootPersonId: doc.rootPersonId,
    persons: Object.fromEntries(
      Object.entries(doc.persons).map(([id, p]) => [id, normalPerson(p)]),
    ),
    unions: doc.unions,
    unionOrder: Object.fromEntries(
      Object.entries(doc.unionOrder).filter(([, list]) => list.length > 0),
    ),
  };
}

function roundTrip(doc: TreeDocument): TreeDocument {
  return parseGedcom(writeGedcom(doc, { now: NOW }), { now: NOW }).doc;
}

describe("round trip: write then parse keeps the tree", () => {
  test.each([
    ["famSimple", famSimple],
    ["famRemarriage", famRemarriage],
    ["famHalfSiblings", famHalfSiblings],
    ["famCousinMarriage", famCousinMarriage],
    ["famAdoption", famAdoption],
    ["famAdoptedOnly", famAdoptedOnly],
  ])("%s", (_name, make) => {
    const doc = make();
    expect(comparable(roundTrip(doc))).toEqual(comparable(doc));
  });

  test("every field, every status, every child type and every date shape", () => {
    const people = [
      person("a", "Ahmed", "Khan", "male", {
        nickname: "Billu",
        nativeName: "احمد خان",
        isLiving: false,
        birth: { date: { qualifier: "about", year: 1900, month: 3 }, place: "Lahore, Punjab" },
        death: { date: { year: 1970, month: 3, day: 12 }, place: "Karachi" },
        notes: "Line one\n\n  indented line @home with a@b\n" + "long ".repeat(120),
      }),
      person("b", "Fatima", "", "female", {
        isLiving: false,
        birth: { date: { qualifier: "between", year: 1900, toYear: 1905 } },
      }),
      person("c", "", "", "female", { isPlaceholder: true }),
      person("d", "Zoë / Zed", "O'Brien-Smith", "male", {
        birth: { date: { qualifier: "before", year: 1950, month: 12, day: 31 } },
      }),
      person("e", "Omar", "Khan", "male", { birth: { date: { qualifier: "after", year: 1930 } } }),
      person("f", "Sara", "Ali", "female", { death: { place: "Multan" }, isLiving: false }),
      person("g", "G", "", "male"),
      person("h", "H", "", "female"),
      person("i", "I", "", "male"),
      person("j", "J", "", "female"),
      person("k", "K", "", "male"),
      person("l", "L", "", "female"),
    ];
    const unions = [
      union("u1", ["b", "a"], ["d", ["e", "adopted"], ["g", "foster"]], "married", {
        start: { year: 1922 },
        end: { year: 1960 },
      }),
      union("u2", ["a", "f"], [["h", "step"]], "divorced", {
        start: { year: 1961 },
        end: { year: 1965 },
      }),
      union("u3", ["c"], ["i"], "partner", { start: { qualifier: "about", year: 1940 } }),
      union("u4", ["g", "h"], [], "engaged", { start: { year: 1990, month: 6 } }),
      union("u5", ["i", "j"], ["k"], "separated", { end: { year: 2001 } }),
      union("u6", ["k", "l"], [], "widowed", { start: { year: 2020 } }),
      union("u7", ["d", "e"], [], "partner"),
    ];
    const doc = { ...docOf(people, unions, "a"), name: "Khan family" };
    expect(validate(doc)).toEqual([]);
    expect(comparable(roundTrip(doc))).toEqual(comparable(doc));
  });

  test("deep families keep their shape", () => {
    const doc = buildDeepFamily([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9]);
    expect(comparable(roundTrip(doc))).toEqual(comparable(doc));
  });

  test("property: any family built by the editor survives write then parse", () => {
    fc.assert(
      fc.property(arbFamily({ maxOps: 40 }), (doc) => {
        expect(comparable(roundTrip(doc))).toEqual(comparable(doc));
      }),
      { numRuns: Math.max(50, Math.floor(runs() / 10)) },
    );
  });

  test("each fixture survives parse, write, parse unchanged", async () => {
    for (const name of ["full-551.ged", "v7.ged", "malformed.ged"]) {
      const first = parseGedcom(await fixture(name), { name: "F", now: NOW }).doc;
      expect(comparable(roundTrip(first))).toEqual(comparable(first));
    }
  });
});

describe("writeGedcom", () => {
  const doc = {
    ...docOf(
      [
        person("a", "Ahmed", "Khan", "male", {
          notes: `${"x".repeat(600)}\nsecond`,
          photoId: "photo1",
          birth: { date: { year: 1900 } },
        }),
        person("b", "Bibi", "", "female", { notes: `${"😀".repeat(200)}` }),
      ],
      [union("u1", ["a", "b"], [])],
      "a",
    ),
    name: "Khans",
  };
  const text = writeGedcom(doc, { now: NOW });
  const lines = text.replace(/^﻿/, "").split("\r\n");

  test("UTF-8 5.5.1 with a BOM, CRLF line ends, a header and a trailer", () => {
    expect(text.startsWith("﻿0 HEAD\r\n")).toBe(true);
    expect(lines).toContain("1 CHAR UTF-8");
    expect(lines).toContain("1 SOUR STAM");
    expect(lines).toContain("2 VERS 5.5.1");
    expect(lines).toContain("2 FORM LINEAGE-LINKED");
    expect(lines).toContain("1 DATE 23 OCT 2026");
    expect(lines.at(-2)).toBe("0 TRLR");
    expect(lines.at(-1)).toBe("");
  });

  test("records use xrefs made from the ids", () => {
    expect(lines).toContain("0 @Ia@ INDI");
    expect(lines).toContain("0 @Fu1@ FAM");
    expect(lines).toContain("1 HUSB @Ia@");
    expect(lines).toContain("1 FAMS @Fu1@");
    expect(lines).toContain("1 NAME Ahmed /Khan/");
    expect(lines).toContain("1 SEX M");
  });

  test("no line is longer than 248 characters; long values continue with CONC", () => {
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(248);
    expect(lines.some((l) => l.startsWith("2 CONC "))).toBe(true);
    expect(lines).toContain("2 CONT second");
  });

  test("a split never cuts a character in half", () => {
    for (const line of lines) {
      expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(line.replace(/^\d+ \w+ ?/, ""))).toBe(false);
    }
    expect(parseGedcom(text).doc.persons.b!.notes).toBe("😀".repeat(200));
  });

  test("photos are not exported", () => {
    expect(text).not.toContain("photo1");
    expect(text).not.toContain("OBJE");
  });

  test("an @ in text is doubled", () => {
    const at = writeGedcom({
      ...doc,
      persons: { ...doc.persons, a: { ...doc.persons.a!, notes: "@me a@b" } },
    });
    expect(at).toContain("1 NOTE @@me a@@b");
  });

  test("privacy mode (applied before writing) leaves no details of the living", () => {
    const priv = writeGedcom(applyPrivacy(doc), { now: NOW });
    expect(priv).not.toContain("1900");
    expect(priv).not.toContain("xxxx");
  });
});

describe("parseGedcom: a hand-written 5.5.1 file with every supported tag", async () => {
  const { doc, report } = parseGedcom(await fixture("full-551.ged"), {
    name: "Imported",
    now: NOW,
  });
  const p = (xref: string) => doc.persons[xref]!;

  test("counts", () => {
    expect(report.people).toBe(9);
    expect(report.families).toBe(3);
  });

  test("names, nickname, native name, sex, events and notes", () => {
    expect(p("I1")).toEqual({
      id: "I1",
      firstName: "Ahmed",
      lastName: "Khan",
      nickname: "Billu",
      nativeName: "احمد خان",
      gender: "male",
      isLiving: false,
      birth: { date: { qualifier: "about", year: 1900 }, place: "Lahore, Punjab" },
      death: { date: { year: 1970, month: 3, day: 12 }, place: "Karachi" },
      notes: "First line of a long note that continues here.\nSecond line, mail: a@b.example",
    });
    expect(p("I2").isLiving).toBe(false);
    expect(p("I2").death).toBeUndefined();
    expect(p("I2").notes).toBe("A shared note\non two lines");
    expect(p("I2").birth?.date).toEqual({ qualifier: "between", year: 1900, toYear: 1905 });
    expect(p("I5")).toMatchObject({ firstName: "Yusuf", lastName: "" });
    expect(p("I7")).toMatchObject({ firstName: "Bilal", lastName: "Khan Jr." });
    expect(p("I7").birth?.date).toEqual({ qualifier: "between", year: 1940, toYear: 1945 });
  });

  test("someone born over 110 years ago with no death record is not living", () => {
    expect(p("I6").isLiving).toBe(false);
    expect(p("I3").isLiving).toBe(true);
  });

  test("unknown sex is guessed from the family role, otherwise male, and reported", () => {
    expect(p("I8").gender).toBe("female");
    expect(p("I9").gender).toBe("male");
    expect(report.warnings).toContainEqual({
      code: "UNKNOWN_SEX",
      people: ["Mystery Person", "Loner"],
    });
    expect(p("I8").isPlaceholder).toBeUndefined();
  });

  test("families: partners, statuses, dates, child order and child types", () => {
    expect(doc.unions.F1).toEqual({
      id: "F1",
      partners: ["I1", "I2"],
      status: "married",
      start: { year: 1922 },
      children: [
        { personId: "I3", type: "biological" },
        { personId: "I4", type: "adopted" },
        { personId: "I5", type: "foster" },
      ],
    });
    expect(doc.unions.F2).toMatchObject({ status: "divorced", end: { year: 1950 } });
    expect(doc.unions.F2!.start).toBeUndefined();
    expect(doc.unions.F3).toMatchObject({
      partners: ["I8"],
      children: [{ personId: "I9", type: "step" }],
    });
    expect(doc.unionOrder.I1).toEqual(["F1", "F2"]);
  });

  test("the tree is valid, new and rooted", () => {
    expect(validate(doc)).toEqual([]);
    expect(doc.rootPersonId).toBe("I1");
    expect(doc.name).toBe("Imported");
    expect(doc.createdAt).toBe(NOW.toISOString());
  });

  test("what was not imported is listed by line, tag and reason", () => {
    expect(report.skipped).toContainEqual({ line: 80, tag: "OCCU", reason: "UNSUPPORTED" });
    expect(report.skipped).toContainEqual({ line: 87, tag: "PLAC", reason: "UNSUPPORTED" });
    expect(report.skipped).toContainEqual({ line: 105, tag: "SOUR", reason: "UNSUPPORTED" });
    // Change dates, submitters and the header are bookkeeping, not family data.
    expect(report.skipped.map((s) => s.tag)).not.toContain("CHAN");
    expect(report.skipped.map((s) => s.tag)).not.toContain("SUBM");
    expect(report.skipped).toHaveLength(3);
  });

  test("a BOM and CRLF line ends read the same", async () => {
    const crlf = `﻿${(await fixture("full-551.ged")).replaceAll("\n", "\r\n")}`;
    const again = parseGedcom(crlf, { name: "Imported", now: NOW });
    expect(comparable(again.doc)).toEqual(comparable(doc));
    expect(again.report).toEqual(report);
  });
});

describe("parseGedcom: GEDCOM 7.0", async () => {
  const { doc, report } = parseGedcom(await fixture("v7.ged"), { name: "Seven", now: NOW });

  test("reads people, calendars, shared notes and 7.0 escapes", () => {
    expect(report.people).toBe(3);
    expect(doc.persons.I1!.birth?.date).toEqual({ year: 1700 });
    expect(doc.persons.I1!.notes).toBe("@ starts with an at sign\nand a@@b stays");
    expect(doc.persons.I1!.isLiving).toBe(false);
  });

  test("SEX X is unknown; PEDI OTHER with a phrase; @VOID@ is no one", () => {
    expect(doc.persons.I2!.gender).toBe("male");
    expect(report.warnings).toContainEqual({ code: "UNKNOWN_SEX", people: ["Bob Lee"] });
    expect(doc.unions.F1).toEqual({
      id: "F1",
      partners: ["I2", "I1"],
      status: "married",
      start: { qualifier: "between", year: 1720, toYear: 1725 },
      children: [{ personId: "I3", type: "step" }],
    });
    expect(report.skipped.map((s) => s.tag)).toEqual([]);
  });
});

describe("parseGedcom: a malformed file is reported, never a crash", async () => {
  const { doc, report } = parseGedcom(await fixture("malformed.ged"), { name: "Bad", now: NOW });

  test("the tree that comes out is valid", () => {
    expect(validate(doc)).toEqual([]);
    expect(report.people).toBe(6);
    expect(Object.keys(doc.persons).toSorted()).toEqual(["I1", "I2", "I3", "I4", "I5", "I6"]);
    expect(report.families).toBe(4);
  });

  test("every problem is in the report", () => {
    const reasons = new Set(report.skipped.map((s) => s.reason));
    for (const reason of [
      "BAD_LINE",
      "BAD_DATE",
      "EXTRA_RECORD",
      "DUPLICATE_RECORD",
      "SECOND_BIRTH_FAMILY",
      "CYCLE",
      "EXTRA_PARTNER",
      "MISSING_REF",
      "NO_PARTNERS",
      "UNSUPPORTED",
    ]) {
      expect(reasons.has(reason as SkipReason)).toBe(true);
    }
    expect(report.skipped).toContainEqual({ line: 1, tag: "", reason: "BAD_LINE" });
    expect(report.skipped).toContainEqual({ line: 8, tag: "DATE", reason: "BAD_DATE" });
    expect(report.skipped).toContainEqual({ line: 13, tag: "INDI", reason: "DUPLICATE_RECORD" });
    expect(report.warnings).toContainEqual({ code: "MALFORMED_LINES", count: 2 });
    expect(report.warnings).toContainEqual({ code: "UNKNOWN_SEX", people: ["Five"] });
  });

  test("the first birth family wins; a person is never their own parent", () => {
    expect(doc.persons.I1!.birth?.date).toBeUndefined();
    expect(doc.unions.F1!.children).toEqual([{ personId: "I2", type: "biological" }]);
    expect(doc.unions.F2!.children).toEqual([]);
    expect(doc.unions.F2!.partners).toEqual(["I3", "I4"]);
  });
});

describe("parseGedcom: hostile and odd input", () => {
  test("text that is not GEDCOM is refused with NOT_GEDCOM", () => {
    for (const text of ["", "hello", '{"format":"stam"}', "1 NAME x"]) {
      expect(() => parseGedcom(text)).toThrow(ImportError);
      try {
        parseGedcom(text);
      } catch (e) {
        expect((e as ImportError).code).toBe("NOT_GEDCOM");
      }
    }
  });

  test("a header-only file is an empty tree", () => {
    const { doc, report } = parseGedcom("0 HEAD\n1 CHAR UTF-8\n0 TRLR\n");
    expect(Object.keys(doc.persons)).toEqual([]);
    expect(report.people).toBe(0);
  });

  test("xrefs that name prototype keys get fresh ids and pollute nothing", () => {
    const text = [
      "0 HEAD",
      "0 @__proto__@ INDI",
      "1 NAME Proto",
      "1 FAMS @hasOwnProperty@",
      "0 @constructor@ INDI",
      "1 NAME Ctor",
      "1 FAMC @hasOwnProperty@",
      "0 @toString@ INDI",
      "1 NAME Str",
      "0 @hasOwnProperty@ FAM",
      "1 HUSB @__proto__@",
      "1 CHIL @constructor@",
      "0 TRLR",
    ].join("\n");
    const { doc } = parseGedcom(text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(doc.persons)).toBe(Object.prototype);
    expect(Object.keys(doc.persons)).toHaveLength(3);
    for (const id of [...Object.keys(doc.persons), ...Object.keys(doc.unions)]) {
      expect(id in Object.prototype).toBe(false);
    }
    const [u] = Object.values(doc.unions);
    expect(doc.persons[u!.partners[0]]!.firstName).toBe("Proto");
    expect(doc.persons[u!.children[0]!.personId]!.firstName).toBe("Ctor");
    expect(validate(doc)).toEqual([]);
  });

  test("property: random lines after a header never crash", () => {
    const tags = [
      "INDI",
      "FAM",
      "NAME",
      "SEX",
      "HUSB",
      "WIFE",
      "CHIL",
      "FAMC",
      "FAMS",
      "BIRT",
      "DATE",
      "CONC",
      "CONT",
      "NOTE",
      "PEDI",
      "MARR",
      "DIV",
      "_STAT",
    ];
    const arbLine = fc
      .tuple(
        fc.integer({ min: 0, max: 4 }),
        fc.option(fc.constantFrom("@I1@", "@I2@", "@F1@", "@__proto__@", "@@"), { nil: undefined }),
        fc.constantFrom(...tags),
        fc.option(
          fc.oneof(
            fc.constantFrom(
              "@I1@",
              "@I2@",
              "@F1@",
              "@F2@",
              "M",
              "F",
              "U",
              "ABT 1900",
              "BET 1 AND 0",
              "adopted",
            ),
            fc.string(),
          ),
          { nil: undefined },
        ),
      )
      .map(([level, xref, tag, value]) =>
        [level, xref, tag, value].filter((x) => x !== undefined).join(" "),
      );
    fc.assert(
      fc.property(fc.array(fc.oneof(arbLine, fc.string()), { maxLength: 60 }), (lines) => {
        const { doc } = parseGedcom(["0 HEAD", ...lines].join("\n"));
        expect(validate(doc)).toEqual([]);
      }),
      { numRuns: Math.max(200, Math.floor(runs() / 5)) },
    );
  });

  test("property: a damaged export (lines dropped or repeated) still imports", () => {
    fc.assert(
      fc.property(arbFamily({ maxOps: 25 }), fc.array(fc.nat(), { maxLength: 8 }), (doc, cuts) => {
        const lines = writeGedcom(doc).split("\r\n");
        for (const cut of cuts) {
          const i = cut % lines.length;
          if (cut % 2 === 0) lines.splice(i, 1);
          else lines.splice(i, 0, lines[(i * 7) % lines.length]!);
        }
        let out;
        try {
          out = parseGedcom(lines.join("\n"));
        } catch (e) {
          // Only possible when no record is left at all (an empty tree that lost its HEAD).
          expect((e as ImportError).code).toBe("NOT_GEDCOM");
          expect(lines.some((l) => /^\uFEFF?0 (HEAD|@\S+@ (INDI|FAM))\b/.test(l))).toBe(false);
          return;
        }
        expect(validate(out.doc)).toEqual([]);
      }),
      { numRuns: Math.max(50, Math.floor(runs() / 20)) },
    );
  });
});

describe("importGedcom (bytes)", () => {
  test("decodes ANSEL and reports the character set", () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Jos"),
      0xe2,
      ...new TextEncoder().encode("e /M"),
      0xe8,
      ...new TextEncoder().encode("uller/\n0 TRLR\n"),
    ]);
    const { doc, report } = importGedcom(bytes, { name: "A" });
    expect(doc.persons.I1).toMatchObject({ firstName: "José", lastName: "Müller" });
    expect(report.warnings).toContainEqual({ code: "CHARSET", charset: "ANSEL" });
  });
});

function nameOf(lines: string[]) {
  const { doc } = parseGedcom(["0 HEAD", "0 @I1@ INDI", ...lines, "0 TRLR"].join("\n"));
  const p = doc.persons.I1!;
  return [p.firstName, p.lastName];
}

describe("parseGedcom: names from other apps", () => {
  test("a NAME without slashes uses GIVN and SURN when they are there", () => {
    expect(nameOf(["1 NAME John Smith", "2 GIVN John", "2 SURN Smith"])).toEqual(["John", "Smith"]);
    expect(nameOf(["1 NAME", "2 GIVN John", "2 SURN Smith"])).toEqual(["John", "Smith"]);
    expect(nameOf(["1 NAME John Smith"])).toEqual(["John Smith", ""]);
  });

  test("slashes in NAME win over GIVN and SURN, which only fill gaps", () => {
    expect(nameOf(["1 NAME Jan /van der Berg/", "2 SURN Berg"])).toEqual(["Jan", "van der Berg"]);
    expect(nameOf(["1 NAME /Khan/", "2 GIVN Ahmed"])).toEqual(["Ahmed", "Khan"]);
  });
});

const notesOf = (doc: TreeDocument) => Object.values(doc.persons).map((p) => p.notes ?? "");

describe("parseGedcom: note limits", () => {
  test("a person's notes are cut at 20,000 characters, and the report names them", () => {
    const long = "ab".repeat(15_000);
    const { doc, report } = parseGedcom(
      [
        "0 HEAD",
        "0 @I1@ INDI",
        "1 NAME Ali /Khan/",
        `1 NOTE ${long}`,
        "0 @I2@ INDI",
        "1 NOTE short",
        "0 TRLR",
      ].join("\n"),
    );
    expect(NOTES_PER_PERSON).toBe(20_000);
    expect(doc.persons.I1!.notes!.length).toBe(NOTES_PER_PERSON);
    expect(doc.persons.I1!.notes!.endsWith("…")).toBe(true);
    expect(doc.persons.I2!.notes).toBe("short");
    expect(report.warnings).toContainEqual({
      code: "NOTES_CUT",
      people: ["Ali Khan"],
      limit: NOTES_PER_PERSON,
    });
    expect(report.warnings.some((w) => w.code === "NOTES_FULL")).toBe(false);
  });

  test("a cut never splits a character in half", () => {
    const { doc } = parseGedcom(
      ["0 HEAD", "0 @I1@ INDI", `1 NOTE ${"😀".repeat(15_000)}`, "0 TRLR"].join("\n"),
    );
    expect(/[\uD800-\uDBFF]…$/.test(doc.persons.I1!.notes!)).toBe(false);
  });

  test("a 4 MB shared note referenced 2,000 times stays within 5,000,000 characters in all", () => {
    // The reviewer's probe: one NOTE record copied into every person that points at it.
    const lines = ["0 HEAD", "1 GEDC", "2 VERS 5.5.1", `0 @N1@ NOTE ${"y".repeat(100)}`];
    for (let i = 0; i < 20_000; i++) lines.push(`1 CONC ${"z".repeat(200)}`);
    for (let i = 0; i < 2000; i++) lines.push(`0 @I${i}@ INDI`, "1 NOTE @N1@");
    lines.push("0 TRLR");

    const started = performance.now();
    const { doc, report } = parseGedcom(lines.join("\n"));
    expect(performance.now() - started).toBeLessThan(5000);

    const notes = notesOf(doc);
    expect(NOTES_PER_FILE).toBe(5_000_000);
    expect(Math.max(...notes.map((n) => n.length))).toBe(NOTES_PER_PERSON);
    const total = notes.reduce((sum, n) => sum + n.length, 0);
    expect(total).toBeLessThanOrEqual(NOTES_PER_FILE);
    expect(total).toBeGreaterThan(NOTES_PER_FILE - NOTES_PER_PERSON);
    // Everyone's note was cut; 250 cut notes fill the file's limit, and the other 1,750 people
    // lost theirs.
    const cut = report.warnings.find((w) => w.code === "NOTES_CUT");
    expect(cut?.code === "NOTES_CUT" && cut.people.length).toBe(2000);
    expect(notes.filter((n) => n !== "")).toHaveLength(250);
    expect(report.warnings).toContainEqual({
      code: "NOTES_FULL",
      count: 1750,
      limit: NOTES_PER_FILE,
    });
  });
});
