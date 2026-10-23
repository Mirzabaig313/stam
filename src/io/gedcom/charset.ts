/** The file was not in UTF-8 (or claimed UTF-8 and was not), so letters may be wrong. */
export type CharsetWarning = { code: "CHARSET"; charset: string };

/** ANSEL (Z39.47, GEDCOM's variant) spacing characters above 0x7F. */
const ANSEL_SPACING: Record<number, string> = {
  0xa1: "Ł",
  0xa2: "Ø",
  0xa3: "Đ",
  0xa4: "Þ",
  0xa5: "Æ",
  0xa6: "Œ",
  0xa7: "ʹ",
  0xa8: "·",
  0xa9: "♭",
  0xaa: "®",
  0xab: "±",
  0xac: "Ơ",
  0xad: "Ư",
  0xae: "ʼ",
  0xb0: "ʻ",
  0xb1: "ł",
  0xb2: "ø",
  0xb3: "đ",
  0xb4: "þ",
  0xb5: "æ",
  0xb6: "œ",
  0xb7: "ʺ",
  0xb8: "ı",
  0xb9: "£",
  0xba: "ð",
  0xbc: "ơ",
  0xbd: "ư",
  0xbe: "□",
  0xbf: "■",
  0xc0: "°",
  0xc1: "ℓ",
  0xc2: "℗",
  0xc3: "©",
  0xc4: "♯",
  0xc5: "¿",
  0xc6: "¡",
  0xc7: "ß",
  0xc8: "€",
  0xcf: "ß",
};

/** ANSEL combining marks: written before the letter they sit on. */
const ANSEL_COMBINING: Record<number, string> = {
  0xe0: "̉",
  0xe1: "̀",
  0xe2: "́",
  0xe3: "̂",
  0xe4: "̃",
  0xe5: "̄",
  0xe6: "̆",
  0xe7: "̇",
  0xe8: "̈",
  0xe9: "̌",
  0xea: "̊",
  0xeb: "︠",
  0xec: "︡",
  0xed: "̕",
  0xee: "̋",
  0xef: "̐",
  0xf0: "̧",
  0xf1: "̨",
  0xf2: "̣",
  0xf3: "̤",
  0xf4: "̥",
  0xf5: "̳",
  0xf6: "̲",
  0xf7: "̦",
  0xf8: "̜",
  0xf9: "̮",
  0xfa: "︢",
  0xfb: "︣",
  0xfe: "̓",
};

export function decodeAnsel(bytes: Uint8Array): string {
  let out = "";
  let marks = "";
  for (const byte of bytes) {
    const mark = ANSEL_COMBINING[byte];
    if (mark !== undefined) {
      marks += mark;
      continue;
    }
    const ch = byte < 0x80 ? String.fromCharCode(byte) : (ANSEL_SPACING[byte] ?? "�");
    out += ch + marks;
    marks = "";
  }
  return (out + marks).normalize("NFC");
}

function tryUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

const latin1 = (bytes: Uint8Array) => new TextDecoder("windows-1252").decode(bytes);

function isAscii(bytes: Uint8Array): boolean {
  for (const b of bytes) if (b > 0x7f) return false;
  return true;
}

/** The `1 CHAR` value from the header, read from the file's first bytes. */
function declaredCharset(bytes: Uint8Array): string | undefined {
  const head = latin1(bytes.subarray(0, 64 * 1024));
  return /^[ \t]*1[ \t]+CHAR[ \t]+([^\r\n]+?)[ \t]*$/im.exec(head)?.[1]?.toUpperCase();
}

/**
 * Turns the bytes of a .ged file into text. UTF-8 and UTF-16 are read as such; ANSEL is decoded;
 * ASCII, ANSI and anything unreadable fall back to Latin-1 (Windows-1252) with a warning. A file
 * whose bytes are valid UTF-8 is read as UTF-8 whatever its header says, since mislabelled
 * exports are common and valid UTF-8 almost never happens by accident.
 */
export function decodeGedcom(bytes: Uint8Array): { text: string; warning?: CharsetWarning } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)) };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)) };
  }
  // UTF-16 without a BOM: "0" followed by a zero byte, or the other way round.
  if (bytes[0] === 0x30 && bytes[1] === 0)
    return { text: new TextDecoder("utf-16le").decode(bytes) };
  if (bytes[0] === 0 && bytes[1] === 0x30)
    return { text: new TextDecoder("utf-16be").decode(bytes) };

  const utf8 = tryUtf8(bytes);
  if (utf8 !== undefined) return { text: utf8 };

  const charset = declaredCharset(bytes) ?? "UNKNOWN";
  if (charset === "ANSEL" && !isAscii(bytes)) {
    return { text: decodeAnsel(bytes), warning: { code: "CHARSET", charset } };
  }
  return { text: latin1(bytes), warning: { code: "CHARSET", charset } };
}
