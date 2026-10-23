/** One GEDCOM line with the lines nested under it. CONC and CONT are already folded in. */
export type GedNode = {
  level: number;
  /** "@I1@", as written; only on records. */
  xref?: string;
  /** Upper-cased. */
  tag: string;
  /** Raw: not yet unescaped, and undefined when the line has no value. */
  value?: string;
  /** 1-based line number in the file. */
  line: number;
  children: GedNode[];
};

export type LineIssue = {
  line: number;
  /**
   * BAD_LINE: not GEDCOM and nothing to attach it to, so dropped.
   * JOINED_LINE: not GEDCOM, so read as a new line of the value before (a raw newline in a note).
   * LEVEL_JUMP: a level more than one deeper than the line before, read as its child.
   */
  reason: "BAD_LINE" | "JOINED_LINE" | "LEVEL_JUMP";
};

/** `level [@xref@] TAG [value]`; the value starts after exactly one delimiter. */
const LINE = /^\s*(\d{1,2})[ \t]+(?:(@[^@\s][^@]*@)[ \t]+)?([A-Za-z0-9_]+)(?:[ \t](.*))?$/;

/**
 * A lenient GEDCOM line reader. Never throws: a line it cannot read is joined to the value before
 * it or dropped, and reported either way.
 */
export function parseLines(text: string): { records: GedNode[]; issues: LineIssue[] } {
  const records: GedNode[] = [];
  const issues: LineIssue[] = [];
  /** stack[n] is the most recent node at level n. */
  const stack: GedNode[] = [];
  let last: GedNode | undefined;

  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    if (raw.trim() === "") continue;

    const match = LINE.exec(raw);
    if (!match) {
      if (last) {
        last.value = `${last.value ?? ""}\n${raw}`;
        issues.push({ line: lineNo, reason: "JOINED_LINE" });
      } else {
        issues.push({ line: lineNo, reason: "BAD_LINE" });
      }
      continue;
    }

    let level = Number(match[1]);
    const tag = match[3]!.toUpperCase();
    const value = match[4];

    if (level > stack.length) {
      if (stack.length === 0) {
        issues.push({ line: lineNo, reason: "BAD_LINE" });
        continue;
      }
      issues.push({ line: lineNo, reason: "LEVEL_JUMP" });
      level = stack.length;
    }

    if ((tag === "CONC" || tag === "CONT") && level > 0) {
      const parent = stack[level - 1]!;
      parent.value = `${parent.value ?? ""}${tag === "CONT" ? "\n" : ""}${value ?? ""}`;
      last = parent;
      continue;
    }

    const node: GedNode = { level, tag, line: lineNo, children: [] };
    if (match[2] !== undefined) node.xref = match[2];
    if (value !== undefined) node.value = value;

    if (level === 0) records.push(node);
    else stack[level - 1]!.children.push(node);
    stack.length = level;
    stack.push(node);
    last = node;
  }
  return { records, issues };
}

/** Undoes `@@` escaping: every `@@` in 5.5.1, only a leading one in 7.0. */
export function unescapeValue(value: string, v7: boolean): string {
  return v7 ? value.replace(/^@@/, "@") : value.replaceAll("@@", "@");
}

/** True for a pointer value such as "@I1@" (and not an escape such as "@#DJULIAN@"). */
export function isPointer(value: string | undefined): value is string {
  return value !== undefined && /^@[^@#\s][^@]*@$/.test(value.trim());
}
