import { describe, expect, test } from "bun:test";

import { sha256Base64 } from "@/export/html/sha256";
import { toHtml } from "@/export/html/toHtml";

import { fixtureMeta, fixturePeople, fixtureSvg } from "../../fixtures/exportSvg";

const bracketKeys = (key: string) => `«${key}»`;

const html = toHtml(fixtureSvg, fixturePeople, fixtureMeta);

function scripts(source: string): { attrs: string; body: string }[] {
  return [...source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({
    attrs: m[1] ?? "",
    body: m[2] ?? "",
  }));
}

/** Families of the page's Arabic-script @font-face rules. */
const faces = (page: string) =>
  [...page.matchAll(/@font-face{font-family:"([^"]+)"[^}]*unicode-range:U\+0600/g)].map(
    (m) => m[1],
  );
const urduT = (key: string) => (key === "export.html.fit" ? "اسکرین کے مطابق" : key);

describe("toHtml", () => {
  test("is one complete document with the SVG, inline CSS and an inline viewer", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<style>");
    expect(html).toContain('data-person-id="p-adam"');
    expect(html).toContain("<title>The Hadžić family</title>");
    expect(scripts(html).map((s) => s.attrs.trim())).toEqual([
      'type="application/json" id="stam-data"',
      "",
    ]);
  });

  test("the page around the tree wears the export theme", () => {
    expect(html).toContain('<html lang="en" dir="ltr">');
    const dark = toHtml(fixtureSvg, fixturePeople, { ...fixtureMeta, theme: "dark" });
    expect(dark).toContain('<html lang="en" dir="ltr" data-theme="dark">');
    expect(dark).toMatch(/\[data-theme=dark\]\{[^}]*--ground:#0f110f/);
    const print = toHtml(fixtureSvg, fixturePeople, { ...fixtureMeta, theme: "print" });
    expect(print).toContain('data-theme="print"');
  });

  test("contains no external URLs apart from SVG namespaces", () => {
    const withoutNamespaces = html.replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, "");
    expect(withoutNamespaces).not.toMatch(/https?:/i);
    expect(withoutNamespaces).not.toMatch(/(?:href|src)="(?!data:|#)/i);
    expect(html).not.toMatch(/<link\b/i);
  });

  test("embeds the people as JSON with every '<' escaped, so no tag can break out", () => {
    const data = scripts(html)[0]!.body;
    expect(data).not.toContain("<");
    expect(data).not.toContain(">");
    expect(data).toContain("\\u003c/script\\u003e");
    const parsed = JSON.parse(data) as { people: { id: string; name: string }[] };
    expect(parsed.people.map((p) => p.name)).toEqual(fixturePeople.map((p) => p.name));
    // Exactly the two script elements the exporter wrote, despite the hostile names.
    expect(html.match(/<script\b/gi)).toHaveLength(2);
  });

  test("escapes the title and keeps lang and dir to safe values", () => {
    const hostile = toHtml(fixtureSvg, [], {
      title: '</title><script>alert("t")</script>',
      generatedAt: "<b>today</b>",
      lang: 'en" onload="x',
      dir: "sideways" as "ltr",
    });
    expect(hostile).toContain(
      "<title>&lt;/title&gt;&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;</title>",
    );
    expect(hostile).toContain("&lt;b&gt;today&lt;/b&gt;");
    expect(hostile).toContain('<html lang="en" dir="ltr">');
    expect(toHtml(fixtureSvg, [], { ...fixtureMeta, lang: "ur-PK", dir: "rtl" })).toContain(
      '<html lang="ur-PK" dir="rtl">',
    );
  });

  test("locks scripts to the viewer's hash with a Content-Security-Policy", () => {
    const viewer = scripts(html)[1]!.body;
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'sha256-${sha256Base64(viewer)}'`);
    expect(csp).toContain("img-src data:");
    expect(csp).toContain("font-src data:");
  });

  test("drops an XML declaration from the SVG and refuses an SVG that carries a script", () => {
    const withProlog = { ...fixtureSvg, svg: `<?xml version="1.0"?>\n${fixtureSvg.svg}` };
    expect(toHtml(withProlog, [], fixtureMeta)).not.toContain("<?xml");
    const scripted = { ...fixtureSvg, svg: fixtureSvg.svg.replace("</svg>", "<script/></svg>") };
    expect(() => toHtml(scripted, [], fixtureMeta)).toThrow();
  });

  test("UI strings come from the translation function", () => {
    const translated = toHtml(fixtureSvg, [], fixtureMeta, bracketKeys);
    expect(translated).toContain("«export.html.searchLabel»");
    expect(translated).toContain("«export.html.fit»");
    const english = toHtml(fixtureSvg, [], fixtureMeta);
    expect(english).toContain("Search by name");
    expect(english).toContain("23 October 2026");
  });

  test("embeds the Arabic-script fonts its own words need, unless the SVG already does", () => {
    const latin = [fixturePeople[0]!];
    expect(faces(toHtml(fixtureSvg, latin, fixtureMeta))).toEqual([]);
    expect(faces(html)).toEqual(["Archivo Variable"]); // هانا
    const urdu = toHtml(fixtureSvg, [], { ...fixtureMeta, lang: "ur", dir: "rtl" }, urduT);
    expect(faces(urdu)).toEqual(["Archivo Variable", "Noto Nastaliq Urdu"]);
    expect(urdu).toMatch(/html\[lang\|="ur"\] body{font-family:"Noto Nastaliq Urdu"/);
    // Names and details count too: an Arabic name in an English page.
    const named = [{ ...fixturePeople[0]!, nativeName: "علي" }];

    expect(faces(toHtml(fixtureSvg, named, fixtureMeta))).toEqual(["Archivo Variable"]);
    // Already in the SVG (as renderTreeSvg embeds it): not twice.
    const naskh = /@font-face{[^}]*}/.exec(urdu)![0];
    const withNaskh = {
      ...fixtureSvg,
      svg: fixtureSvg.svg.replace("<style>", `<style>${naskh}\n`),
    };
    expect(faces(toHtml(withNaskh, named, fixtureMeta))).toEqual(["Archivo Variable"]);
  });
});
