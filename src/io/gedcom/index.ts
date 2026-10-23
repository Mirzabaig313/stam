import { decodeGedcom } from "./charset";
import { type GedcomImport, parseGedcom, type ParseGedcomOptions } from "./parse";

export { decodeGedcom, type CharsetWarning } from "./charset";
export { formatGedcomDate, parseGedcomDate } from "./dates";
export {
  type GedcomImport,
  type GedcomReport,
  type GedcomSkip,
  type GedcomWarning,
  NOTES_PER_FILE,
  NOTES_PER_PERSON,
  parseGedcom,
  type ParseGedcomOptions,
  type SkipReason,
} from "./parse";
export { writeGedcom } from "./write";

/** Reads a .ged file's bytes: decodes the character set, then parses. */
export function importGedcom(bytes: Uint8Array, opts: ParseGedcomOptions = {}): GedcomImport {
  const { text, warning } = decodeGedcom(bytes);
  const result = parseGedcom(text, opts);
  if (warning) result.report.warnings.unshift(warning);
  return result;
}

/** True when the bytes look like GEDCOM: a "0 HEAD" first line, after any BOM or blank space. */
export function looksLikeGedcom(bytes: Uint8Array): boolean {
  const { text } = decodeGedcom(bytes.subarray(0, 256));
  return /^\s*0[ \t]+HEAD\b/i.test(text.replace(/^﻿/, ""));
}
