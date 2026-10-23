import { describe, expect, test } from "bun:test";

import { decodeGedcom } from "@/io/gedcom/charset";
import { parseLines, unescapeValue } from "@/io/gedcom/lines";

describe("parseLines", () => {
  test("builds records from levels, with xrefs, tags and values", () => {
    const { records, issues } = parseLines(
      "0 HEAD\n0 @I1@ INDI\n1 NAME John /Smith/\n2 GIVN John\n1 SEX M\n0 TRLR",
    );
    expect(issues).toEqual([]);
    expect(records.map((r) => r.tag)).toEqual(["HEAD", "INDI", "TRLR"]);
    const indi = records[1]!;
    expect(indi.xref).toBe("@I1@");
    expect(indi.line).toBe(2);
    expect(records[1]!.children.map((c) => [c.tag, c.value, c.line])).toEqual([
      ["NAME", "John /Smith/", 3],
      ["SEX", "M", 5],
    ]);
    expect(records[1]!.children[0]!.children[0]!.value).toBe("John");
  });

  test("CRLF, CR, a BOM, indentation and lower-case tags are all accepted", () => {
    const { records, issues } = parseLines("﻿0 HEAD\r\n  0 @I1@ indi\r1 name Ann\r\n");
    expect(issues).toEqual([]);
    expect(records[1]!.tag).toBe("INDI");
    expect(records[1]!.children[0]!.tag).toBe("NAME");
    expect(records[1]!.children[0]!.value).toBe("Ann");
  });

  test("CONC joins directly and CONT starts a new line, keeping inner spaces", () => {
    const text = [
      "0 @N1@ NOTE First par",
      "1 CONC t of a long line",
      "1 CONT",
      "1 CONT  indented second",
      "1 CONC  line",
    ].join("\n");
    const { records } = parseLines(text);
    expect(records[0]!.value).toBe("First part of a long line\n\n indented second line");
    expect(records[0]!.children).toEqual([]);
  });

  test("a line that is not GEDCOM joins the value before it (a raw newline in a note)", () => {
    const { records, issues } = parseLines("0 @I1@ INDI\n1 NOTE line one\nline two\n1 SEX F");
    expect(records[0]!.children[0]!.value).toBe("line one\nline two");
    expect(records[0]!.children[1]!.tag).toBe("SEX");
    expect(issues).toEqual([{ line: 3, reason: "JOINED_LINE" }]);
  });

  test("garbage before any record is reported and dropped", () => {
    const { records, issues } = parseLines("hello\n0 HEAD");
    expect(records.map((r) => r.tag)).toEqual(["HEAD"]);
    expect(issues).toEqual([{ line: 1, reason: "BAD_LINE" }]);
  });

  test("a level that jumps ahead is read as a child of the line before", () => {
    const { records, issues } = parseLines("0 @I1@ INDI\n1 BIRT\n3 DATE 1900");
    expect(records[0]!.children[0]!.children[0]!.tag).toBe("DATE");
    expect(issues).toEqual([{ line: 3, reason: "LEVEL_JUMP" }]);
  });

  test("blank lines are ignored", () => {
    expect(parseLines("\n\n0 HEAD\n\n0 TRLR\n").records).toHaveLength(2);
  });
});

describe("unescapeValue", () => {
  test("5.5.1 undoubles every @@, 7.0 only a leading one", () => {
    expect(unescapeValue("@@home and a@@b", false)).toBe("@home and a@b");
    expect(unescapeValue("@@home and a@@b", true)).toBe("@home and a@@b");
    expect(unescapeValue("mail me: a@b.com", false)).toBe("mail me: a@b.com");
  });
});

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)),
  );

describe("decodeGedcom", () => {
  test("UTF-8 with and without a BOM", () => {
    expect(decodeGedcom(bytes([0xef, 0xbb, 0xbf], "0 HEAD\n1 CHAR UTF-8\n1 NOTE خان")).text).toBe(
      "0 HEAD\n1 CHAR UTF-8\n1 NOTE خان",
    );
    const plain = decodeGedcom(bytes("0 HEAD\n1 CHAR UTF-8\n1 NOTE Zoë"));
    expect(plain.text).toContain("Zoë");
    expect(plain.warning).toBeUndefined();
  });

  test("UTF-16 by its BOM", () => {
    const text = "0 HEAD\n1 CHAR UNICODE\n1 NOTE Zoë";
    const le = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) le[2 + i * 2] = text.charCodeAt(i);
    expect(decodeGedcom(le).text).toBe(text);
  });

  test("ANSEL: combining marks come before their letter, and are composed", () => {
    // 0xE2 = acute, 0xE8 = diaeresis, 0xA2 = Ø
    const out = decodeGedcom(
      bytes("0 HEAD\n1 CHAR ANSEL\n1 NOTE Jos", [0xe2], "e M", [0xe8], "uller ", [0xa2]),
    );
    expect(out.text).toBe("0 HEAD\n1 CHAR ANSEL\n1 NOTE José Müller Ø");
    expect(out.warning).toEqual({ code: "CHARSET", charset: "ANSEL" });
  });

  test("a file labelled ANSEL or ASCII that is really UTF-8 is read as UTF-8", () => {
    const out = decodeGedcom(bytes("0 HEAD\n1 CHAR ANSEL\n1 NOTE José"));
    expect(out.text).toContain("José");
    expect(out.warning).toBeUndefined();
  });

  test("ASCII or ANSI with high bytes falls back to Latin-1 with a warning", () => {
    const out = decodeGedcom(bytes("0 HEAD\n1 CHAR ASCII\n1 NOTE Jos", [0xe9]));
    expect(out.text).toContain("José");
    expect(out.warning).toEqual({ code: "CHARSET", charset: "ASCII" });
  });

  test("UTF-8 that is not valid UTF-8 falls back to Latin-1 with a warning", () => {
    const out = decodeGedcom(bytes("0 HEAD\n1 CHAR UTF-8\n1 NOTE Jos", [0xe9], " x"));
    expect(out.text).toContain("José x");
    expect(out.warning).toEqual({ code: "CHARSET", charset: "UTF-8" });
  });
});
