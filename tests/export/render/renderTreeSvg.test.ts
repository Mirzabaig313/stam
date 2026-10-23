import { describe, expect, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import { layoutPedigree } from "@/core/layout/pedigree";
import type { TreeDocument } from "@/core/model/types";
import { renderTreeSvg } from "@/export/render/renderTreeSvg";
import type { ExportInput, ExportOptions } from "@/export/types";

import { docOf, famCousinMarriage, famSimple, person, union } from "../../fixtures/families";
import { t } from "../../ui/i18n";

const OPTS: ExportOptions = {
  scope: "view",
  theme: "light",
  includeDates: true,
  includePhotos: false,
  showRuler: false,
  privacy: false,
  background: "solid",
};

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function inputOf(doc: TreeDocument, extra: Partial<ExportInput> = {}): ExportInput {
  const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
  return { doc, layout, viewRootId: null, selectedId: null, photos: {}, ...extra };
}

const render = (doc: TreeDocument, opts: Partial<ExportOptions> = {}, extra = {}) =>
  renderTreeSvg(inputOf(doc, extra), { ...OPTS, ...opts }, t);

function parse(svg: string): Document {
  const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(dom.querySelector("parsererror")).toBeNull();
  return dom;
}

const personIds = (svg: string) =>
  new Set(
    [...parse(svg).querySelectorAll("[data-person-id]")].map((g) =>
      g.getAttribute("data-person-id"),
    ),
  );

/** `famSimple` plus a deceased grandmother with dates, a photo for everyone. */
function datedFamily(): TreeDocument {
  const doc = famSimple();
  doc.persons.gran = person("gran", "Bano", "Khan", "female", {
    isLiving: false,
    birth: { date: { year: 1931 } },
    death: { date: { year: 1999 } },
    photoId: "pg",
  });
  doc.persons.c1 = { ...doc.persons.c1!, photoId: "p1" };
  doc.unions.ug = union("ug", ["gran"], ["dad"]);
  doc.unionOrder.gran = ["ug"];
  doc.rootPersonId = "gran";
  return doc;
}

const xOf = (svg: string, id: string) =>
  Number(
    /translate\(([-\d.]+)/.exec(
      parse(svg).querySelector(`[data-person-id="${id}"]`)!.getAttribute("transform")!,
    )![1],
  );

describe("renderTreeSvg", () => {
  test("gives a standalone SVG that parses, with size, viewBox and namespaces", () => {
    const doc = famSimple();
    const input = inputOf(doc);
    const r = renderTreeSvg(input, OPTS, t);
    const root = parse(r.svg).documentElement;
    expect(root.tagName.toLowerCase()).toBe("svg");
    expect(r.svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(r.svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(r.width).toBe(Math.ceil(input.layout.bounds.width + 96));
    expect(r.height).toBe(Math.ceil(input.layout.bounds.height + 96));
    expect(root.getAttribute("width")).toBe(String(r.width));
    expect(root.getAttribute("height")).toBe(String(r.height));
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${r.width} ${r.height}`);
    expect(personIds(r.svg)).toEqual(new Set(["dad", "mom", "c1", "c2", "c3"]));
  });

  test("embeds Archivo as base64 woff2 and resolves every colour (no CSS variables)", () => {
    const { svg } = render(famSimple());
    expect(svg).toContain("@font-face");
    expect(svg).toContain("data:font/woff2;base64,d09GMg");
    expect(svg).not.toContain("var(");
    expect(render(famSimple(), { theme: "print", showRuler: true, title: "T" }).svg).not.toContain(
      "var(",
    );
  });

  test("draws gender marks as stroked paths, never as ♂/♀ text no embedded font has", () => {
    const { svg } = render(famSimple());
    expect(svg).not.toMatch(/[♂♀]/);
    expect(parse(svg).querySelectorAll("path.stam-card__gender-mark")).toHaveLength(5);
    expect(svg).toMatch(/\.stam-card__gender-mark\{fill:none;stroke:#/);
  });

  test("draws static cards: no roles, tab stops or controls", () => {
    const { svg } = render(famSimple());
    expect(svg).not.toContain('role="button"');
    expect(svg).not.toContain("tabindex");
    expect(svg).not.toContain("stam-card__control");
  });

  test("privacy drops a living person's dates but keeps a deceased person's", () => {
    const off = render(datedFamily()).svg;
    expect(off).toContain("1980");
    const on = render(datedFamily(), { privacy: true }).svg;
    expect(on).not.toContain("1980");
    expect(on).toContain("1931 – †1999");
  });

  test("dates off drops every date and keeps the deceased mark", () => {
    const { svg } = render(datedFamily(), { includeDates: false });
    expect(svg).not.toContain("1980");
    expect(svg).not.toContain("1931");
    expect(svg).toContain(">†<");
  });

  test("photos are embedded as data URLs only when asked, and never for the living in privacy mode", () => {
    const photos = { pg: PHOTO, p1: PHOTO };
    expect(render(datedFamily(), {}, { photos }).svg).not.toContain("<image");
    const on = parse(render(datedFamily(), { includePhotos: true }, { photos }).svg);
    expect([...on.querySelectorAll("image")].map((i) => i.getAttribute("href"))).toEqual([
      PHOTO,
      PHOTO,
    ]);
    const priv = parse(
      render(datedFamily(), { includePhotos: true, privacy: true }, { photos }).svg,
    );
    expect(priv.querySelectorAll("image")).toHaveLength(1);
    const remote = render(
      datedFamily(),
      { includePhotos: true },
      { photos: { pg: "https://example.com/a.png" } },
    );
    expect(remote.svg).not.toContain("example.com");
  });

  test("each scope draws the expected people", () => {
    const doc = famCousinMarriage();
    const view = layoutFamily(doc, { rootId: "g1", collapsed: new Set(["p1", "p2"]) });
    const base: ExportInput = { doc, layout: view, viewRootId: null, selectedId: "p2", photos: {} };
    const ids = (scope: ExportOptions["scope"], extra: Partial<ExportInput> = {}) =>
      personIds(renderTreeSvg({ ...base, ...extra }, { ...OPTS, scope }, t).svg);
    expect(ids("view")).toEqual(new Set(["g1", "g2", "p1", "s1", "p2", "s2"]));
    expect(ids("whole")).toEqual(
      new Set(["g1", "g2", "p1", "p2", "s1", "s2", "cousin1", "cousin2", "kid"]),
    );
    expect(ids("branch")).toEqual(new Set(["p2", "s2", "cousin2", "cousin1", "kid"]));
    const g1 = view.nodes.find((n) => n.personId === "g1")!;
    const visibleRect = { x: g1.x, y: g1.y, width: 1, height: 1 };
    expect(ids("visible", { visibleRect })).toEqual(new Set(["g1"]));
  });

  test("user text is escaped: names and the title", () => {
    const doc = docOf([person("x", "<script>alert(1)</script>", "&amp", "male")], [], "x");
    const { svg } = render(doc, { title: '<img src=x onerror="1">', subtitle: "a & b" });
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("a &amp; b");
    const dom = parse(svg);
    expect(dom.querySelector(".stam-export__title")?.textContent).toBe('<img src=x onerror="1">');
    expect(dom.querySelector("title")?.textContent).toBe('<img src=x onerror="1">');
  });

  test("title and subtitle sit above the tree and make the image taller", () => {
    const plain = render(famSimple());
    const titled = render(famSimple(), { title: "The Khans", subtitle: "Lahore, 2026" });
    expect(titled.height).toBeGreaterThan(plain.height);
    const dom = parse(titled.svg);
    expect(dom.querySelector(".stam-export__title")?.textContent).toBe("The Khans");
    expect(dom.querySelector(".stam-export__subtitle")?.textContent).toBe("Lahore, 2026");
  });

  test("the ruler adds a column with a Roman numeral per generation row", () => {
    const plain = render(datedFamily());
    const ruled = render(datedFamily(), { showRuler: true });
    expect(ruled.width).toBeGreaterThan(plain.width);
    const labels = [...parse(ruled.svg).querySelectorAll(".stam-export__ruler text")];
    expect(labels.map((l) => l.textContent)).toEqual(["I", "II", "III"]);
  });

  test("a pedigree's ruler counts from its top row too", () => {
    const doc = famCousinMarriage();
    const layout = layoutPedigree(doc, { focusId: "kid" });
    const { svg } = renderTreeSvg(inputOf(doc, { layout }), { ...OPTS, showRuler: true }, t);
    const labels = [...parse(svg).querySelectorAll(".stam-export__ruler text")];
    expect(labels.map((l) => l.textContent)).toEqual(["I", "II", "III", "IV"]);
  });

  test("solid background fills the ground; transparent leaves it out; print is white", () => {
    const solid = parse(render(famSimple()).svg);
    expect(solid.querySelector(".stam-export__ground")?.getAttribute("fill")).toBe("#f4f5f2");
    expect(
      parse(render(famSimple(), { background: "transparent" }).svg).querySelector(
        ".stam-export__ground",
      ),
    ).toBeNull();
    const print = render(famSimple(), { theme: "print" }).svg;
    expect(parse(print).querySelector(".stam-export__ground")?.getAttribute("fill")).toBe(
      "#ffffff",
    );
    expect(print).toContain(".stam-card__bg{fill:none;stroke:#000000");
  });

  test("placeholder labels come from the given t", () => {
    const doc = docOf(
      [person("k", "Ali", "Khan", "male"), person("f", "", "", "male", { isPlaceholder: true })],
      [union("u", ["f"], ["k"])],
      "f",
    );
    expect(render(doc).svg).toContain("Unknown father");
  });

  test("RTL mirrors the tree", () => {
    const doc = famSimple();
    const ltr = render(doc).svg;
    const rtl = renderTreeSvg(inputOf(doc), OPTS, t, { dir: "rtl" }).svg;
    expect(xOf(ltr, "c1")).toBeLessThan(xOf(ltr, "c3"));
    expect(xOf(rtl, "c1")).toBeGreaterThan(xOf(rtl, "c3"));
    // Card text anchors follow the drawing's direction, as on the canvas.
    expect(parse(rtl).documentElement.getAttribute("direction")).toBe("rtl");
    expect(parse(ltr).documentElement.getAttribute("direction")).toBeNull();
  });

  test("famSimple snapshot", () => {
    const { svg } = render(famSimple(), { title: "Khan family", showRuler: true });
    expect(svg.replace(/base64,[A-Za-z0-9+/=]+/g, "base64,…")).toMatchSnapshot();
  });
});
