import { describe, expect, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import type { TreeDocument } from "@/core/model/types";
import type { ExportInput } from "@/export/types";
import { i18n } from "@/i18n";
import { runExport } from "@/ui/export/exporters";
import { defaultSettings, type ExportSettings, switchFormat } from "@/ui/export/formats";

import { famRemarriage, person, union } from "../../fixtures/families";

// The dialog's door with the real render and HTML modules behind it (no fakes): the seams
// between lanes R, H and U. Raster and PDF need a real browser and are covered by e2e/export.

const t = i18n.t.bind(i18n);
const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function family(): TreeDocument {
  const doc = famRemarriage();
  doc.persons.a1 = { ...doc.persons.a1!, birth: { date: { year: 1977 } }, photoId: "ph" };
  doc.persons.gran = person("gran", "Zohra", "Raza", "female", {
    isLiving: false,
    birth: { date: { year: 1921 } },
    death: { date: { year: 1999 } },
    photoId: "pg",
  });
  doc.unions.ug = union("ug", ["gran"], ["ali"]);
  doc.unionOrder.gran = ["ug"];
  doc.rootPersonId = "gran";
  return doc;
}

function request(settings: ExportSettings, doc = family()) {
  const input: ExportInput = {
    doc,
    layout: layoutFamily(doc, { rootId: doc.rootPersonId! }),
    viewRootId: null,
    selectedId: null,
    photos: { ph: PHOTO, pg: PHOTO },
  };
  return { input, settings, t, lang: "en", dir: "ltr" as const };
}

const svgOf = (html: string) => html.slice(html.indexOf("<svg"), html.indexOf("</svg>") + 6);
const peopleOf = (html: string) =>
  JSON.parse(
    html.match(/<script type="application\/json" id="stam-data">([\s\S]*?)<\/script>/)![1]!,
  ).people as { id: string; lifespan: string; details: { value: string }[] }[];

describe("runExport with the real exporters", () => {
  test("HTML: every card's data-person-id has a details entry with the same id", async () => {
    const settings = { ...switchFormat(defaultSettings(), "html"), privacy: false };
    const html = await (await runExport(request(settings))).blob.text();
    const svg = svgOf(html);
    const cardIds = new Set([...svg.matchAll(/data-person-id="([^"]+)"/g)].map((m) => m[1]!));
    expect(cardIds.size).toBe(7);
    expect(new Set(peopleOf(html).map((p) => p.id))).toEqual(cardIds);
    expect(svg).not.toContain("<script");
  });

  test("HTML: fonts and photos are data: URLs, nothing points at the network", async () => {
    const settings = {
      ...switchFormat(defaultSettings(), "html"),
      privacy: false,
      includePhotos: true,
    };
    const html = await (await runExport(request(settings))).blob.text();
    const svg = svgOf(html);
    // url(#…) is a clip path inside the drawing; anything else must be inline.
    const urls = [...svg.matchAll(/url\(\s*["']?([^"')]+)/g)]
      .map((m) => m[1]!)
      .filter((url) => !url.startsWith("#"));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toStartWith("data:font/woff2;base64,");
    const hrefs = [...svg.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href.startsWith("data:image/")).toBe(true);
    expect(html).not.toMatch(/(?:src|href)="https?:/);
  });

  test("privacy: a living person's birth year is in neither the SVG nor the HTML", async () => {
    const svg = await (
      await runExport(request({ ...defaultSettings(), privacy: true }))
    ).blob.text();
    expect(svg).not.toContain("1977");
    expect(svg).toContain("1921"); // the deceased grandmother keeps hers
    const html = await (
      await runExport(request({ ...switchFormat(defaultSettings(), "html"), privacy: true }))
    ).blob.text();
    expect(html).not.toContain("1977");
    expect(peopleOf(html).find((p) => p.id === "gran")!.lifespan).toContain("1921");
  });

  test("names reach the SVG, with the gender marks as paths", async () => {
    const svg = await (await runExport(request(defaultSettings()))).blob.text();
    for (const name of ["Ali Raza", "Hina Raza", "Mehr Raza", "Bilal Raza", "Zohra Raza"]) {
      expect(svg).toContain(name);
    }
    expect(svg).not.toMatch(/[♂♀]/);
  });
});
