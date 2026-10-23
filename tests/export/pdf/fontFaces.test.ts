import { describe, expect, test } from "bun:test";

import { inRange, parseFontFaces, parseUnicodeRange } from "@/export/pdf/fontFaces";

const css = `
  .stam-card__name { font-weight: 600 }
  @font-face {
    font-family: "Archivo Variable";
    font-style: normal;
    font-weight: 100 900;
    src: url(data:font/woff2;base64,AAAA) format("woff2-variations");
    unicode-range: U+0000-00FF, U+0131, U+2000-206F;
  }
  @font-face{font-family:'Noto Naskh Arabic';font-weight:bold;src:url("data:font/woff2;base64,QkJC") format("woff2");unicode-range:U+06??}
  @font-face { font-family: Remote; src: url(https://example.com/x.woff2); }
`;

describe("parseFontFaces", () => {
  test("reads family, weight range, style, unicode range and the embedded bytes", () => {
    const faces = parseFontFaces(css);
    expect(faces).toHaveLength(2);
    const [archivo, naskh] = faces;
    expect(archivo!.family).toBe("Archivo Variable");
    expect(archivo!.weight).toEqual([100, 900]);
    expect(archivo!.style).toBe("normal");
    expect(archivo!.ranges).toEqual([
      [0, 0xff],
      [0x131, 0x131],
      [0x2000, 0x206f],
    ]);
    expect([...archivo!.bytes]).toEqual([0, 0, 0]);
    expect(naskh!.family).toBe("Noto Naskh Arabic");
    expect(naskh!.weight).toEqual([700, 700]);
    expect(naskh!.ranges).toEqual([[0x600, 0x6ff]]);
    expect(new TextDecoder().decode(naskh!.bytes)).toBe("BBB");
  });

  test("ignores faces that point outside the file", () => {
    expect(parseFontFaces("@font-face{font-family:X;src:url(/x.woff2)}")).toEqual([]);
  });
});

describe("parseUnicodeRange", () => {
  test("defaults to every code point and checks membership", () => {
    const all = parseUnicodeRange(undefined);
    expect(inRange(all, 0x1f600)).toBe(true);
    const some = parseUnicodeRange("U+0041-005A, u+0061");
    expect(inRange(some, 0x41)).toBe(true);
    expect(inRange(some, 0x61)).toBe(true);
    expect(inRange(some, 0x62)).toBe(false);
  });
});
