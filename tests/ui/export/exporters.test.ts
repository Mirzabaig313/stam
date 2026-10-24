import { beforeEach, describe, expect, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import type { ExportInput, ExportOptions, RenderedSvg } from "@/export/types";
import { i18n } from "@/i18n";
import { TEMPLATES } from "@/templates";
import { type ExportRequest, type Loaders, runExport } from "@/ui/export/exporters";
import { defaultSettings, switchFormat } from "@/ui/export/formats";
import { buildPeople } from "@/ui/export/people";

import { docOf, famSimple, person } from "../../fixtures/families";

const SVG: RenderedSvg = { svg: "<svg/>", width: 100, height: 50 };
const calls: { fn: string; args: unknown[] }[] = [];
const spy =
  <A extends unknown[], R>(fn: string, result: R) =>
  (...args: A): R => {
    calls.push({ fn, args });
    return result;
  };

let rasterResult: { blob: Blob; scale: number; warning?: string } = {
  blob: new Blob(["png"], { type: "image/png" }),
  scale: 1,
};

const load = {
  render: async () => ({
    applyPrivacy: (doc: unknown) => {
      calls.push({ fn: "applyPrivacy", args: [doc] });
      return doc;
    },
    selectScope: (input: ExportInput) => {
      calls.push({ fn: "selectScope", args: [input] });
      return input.layout;
    },
    renderTreeSvg: spy("renderTreeSvg", SVG),
  }),
  raster: async () => ({
    rasterize: async (...args: unknown[]) => {
      calls.push({ fn: "rasterize", args });
      return rasterResult;
    },
  }),
  pdf: async () => ({
    toPosterPdf: async (...args: unknown[]) => {
      calls.push({ fn: "toPosterPdf", args });
      return new Blob(["%PDF"], { type: "application/pdf" });
    },
    toTiledPdf: async (...args: unknown[]) => {
      calls.push({ fn: "toTiledPdf", args });
      return new Blob(["%PDF"], { type: "application/pdf" });
    },
  }),
  html: async () => ({
    toHtml: (...args: unknown[]) => {
      calls.push({ fn: "toHtml", args });
      return "<!doctype html>";
    },
  }),
} as unknown as Loaders;

const run = (r: ExportRequest) => runExport(r, load);

const doc = famSimple();
const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
const input: ExportInput = {
  doc,
  layout,
  viewRootId: null,
  selectedId: null,
  photos: {},
};
const t = i18n.t.bind(i18n);
const req = (settings = defaultSettings()) => ({
  input,
  settings,
  t,
  lang: "en",
  dir: "ltr" as const,
});

beforeEach(() => {
  calls.length = 0;
  rasterResult = { blob: new Blob(["png"], { type: "image/png" }), scale: 1 };
});

describe("runExport", () => {
  test("SVG is the rendered string, with the options built from the settings", async () => {
    const { blob } = await run(req({ ...defaultSettings(), title: "Khans" }));
    expect(blob.type).toBe("image/svg+xml");
    expect(await blob.text()).toBe("<svg/>");
    const render = calls.find((c) => c.fn === "renderTreeSvg")!;
    expect((render.args[1] as ExportOptions).title).toBe("Khans");
  });

  test("privacy is applied to the document before it is drawn", async () => {
    await run(req({ ...defaultSettings(), privacy: true }));
    expect(calls.map((c) => c.fn).slice(0, 2)).toEqual(["applyPrivacy", "renderTreeSvg"]);
    calls.length = 0;
    await run(req({ ...defaultSettings(), privacy: false }));
    expect(calls.some((c) => c.fn === "applyPrivacy")).toBe(false);
  });

  test("PNG and JPEG go through the rasteriser with the scale, quality and ground", async () => {
    const png = await run(req({ ...switchFormat(defaultSettings(), "png"), scale: 3 }));
    expect(png.blob.type).toBe("image/png");
    const [r, o] = calls.find((c) => c.fn === "rasterize")!.args as [
      RenderedSvg,
      Record<string, unknown>,
    ];
    expect(r).toBe(SVG);
    expect(o).toMatchObject({
      format: "png",
      scale: 3,
      background: "solid",
      ground: TEMPLATES.album.palettes.light.ground,
    });
    calls.length = 0;
    await run(
      req({
        ...switchFormat(defaultSettings(), "jpeg"),
        quality: 0.7,
        theme: "print",
      }),
    );
    expect(calls.find((c) => c.fn === "rasterize")!.args[1]).toMatchObject({
      format: "jpeg",
      quality: 0.7,
      ground: "#ffffff",
    });
  });

  test("the HTML page gets the export theme", async () => {
    await run(req({ ...switchFormat(defaultSettings(), "html"), theme: "dark" }));
    expect(calls.find((c) => c.fn === "toHtml")!.args[2]).toMatchObject({
      theme: "dark",
    });
  });

  test("a dark PNG fills its background with the dark ground", async () => {
    await run(req({ ...switchFormat(defaultSettings(), "png"), theme: "dark" }));
    expect(calls.find((c) => c.fn === "rasterize")!.args[1]).toMatchObject({
      ground: TEMPLATES.album.palettes.dark.ground,
    });
  });

  test("reports a scale the rasteriser had to reduce", async () => {
    rasterResult = { blob: new Blob(["x"]), scale: 2, warning: "AREA_LIMIT" };
    const { warning } = await run(req({ ...switchFormat(defaultSettings(), "png"), scale: 4 }));
    expect(warning).toEqual({ scale: 2, code: "AREA_LIMIT" });
  });

  test("draws in the interface's direction", async () => {
    await run({ ...req(), dir: "rtl" });
    expect(calls.find((c) => c.fn === "renderTreeSvg")!.args[3]).toEqual({
      dir: "rtl",
    });
  });

  test("the tiled PDF and the HTML page get the translator", async () => {
    await run(req(switchFormat(defaultSettings(), "pdf-tiled")));
    expect(calls.find((c) => c.fn === "toTiledPdf")!.args[2]).toBe(t);
    await run(req(switchFormat(defaultSettings(), "html")));
    expect(calls.find((c) => c.fn === "toHtml")!.args[3]).toBe(t);
  });

  test("HTML details come from the privacy-filtered document", async () => {
    const d = famSimple();
    d.persons.c1 = {
      ...d.persons.c1!,
      notes: "Secret",
      birth: { date: { year: 1980 } },
    };
    const filtered = await import("@/export/render").then((m) => m.applyPrivacy);
    const real = {
      ...load,
      render: async () => ({
        ...(await load.render()),
        applyPrivacy: filtered,
      }),
    } as Loaders;
    const l = layoutFamily(d, { rootId: d.rootPersonId! });
    await runExport(
      {
        ...req({ ...switchFormat(defaultSettings(), "html"), privacy: true }),
        input: { ...input, doc: d, layout: l },
      },
      real,
    );
    const people = calls.findLast((c) => c.fn === "toHtml")!.args[1] as {
      id: string;
      lifespan: string;
      details: { value: string }[];
    }[];
    const ali = people.find((p) => p.id === "c1")!;
    expect(ali.lifespan).toBe("");
    expect(JSON.stringify(ali.details)).not.toMatch(/1980|Secret/);
  });

  test("PDF poster and tiled pass their settings", async () => {
    await run(
      req({
        ...switchFormat(defaultSettings(), "pdf-poster"),
        page: "A1",
        orientation: "landscape",
        marginMm: 15,
      }),
    );
    expect(calls.find((c) => c.fn === "toPosterPdf")!.args[1]).toEqual({
      page: "A1",
      orientation: "landscape",
      marginMm: 15,
    });
    await run(
      req({
        ...switchFormat(defaultSettings(), "pdf-tiled"),
        tiledPage: "Letter",
        tiledScale: 2,
      }),
    );
    expect(calls.find((c) => c.fn === "toTiledPdf")!.args[1]).toEqual({
      page: "Letter",
      scale: 2,
      overlapMm: 10,
    });
  });

  test("a custom poster page is passed as its size in mm", async () => {
    await run(
      req({
        ...switchFormat(defaultSettings(), "pdf-poster"),
        page: "Custom",
        customW: 700,
        customH: 1000,
      }),
    );
    expect(calls.findLast((c) => c.fn === "toPosterPdf")!.args[1]).toMatchObject({
      page: { w: 700, h: 1000 },
    });
  });

  test("HTML gets the people in scope and the page meta", async () => {
    const { blob } = await run(
      req({ ...switchFormat(defaultSettings(), "html"), title: "The Khans" }),
    );
    expect(blob.type).toBe("text/html");
    const [, people, meta] = calls.find((c) => c.fn === "toHtml")!.args as [
      unknown,
      { id: string }[],
      { title: string; lang: string; dir: string; generatedAt: string },
    ];
    expect(people.map((p) => p.id).toSorted()).toEqual(
      layout.nodes.map((n) => n.personId).toSorted(),
    );
    expect(meta).toMatchObject({ title: "The Khans", lang: "en", dir: "ltr" });
    // A readable long date in the page's language, not an ISO timestamp.
    expect(meta.generatedAt).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date()),
    );
    expect(meta.generatedAt).not.toMatch(/T\d\d:/);
  });

  test("JSON is not an exporter format", async () => {
    await expect(run(req({ ...defaultSettings(), format: "json" }))).rejects.toThrow();
  });
});

/** 14 March 1950 as the locale writes a long date. */
const fmt = (lang: string) =>
  new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(1950, 2, 14)),
  );

describe("buildPeople", () => {
  const d = docOf(
    [
      person("a", "Ali", "Khan", "male", {
        nativeName: "علی",
        birth: { date: { year: 1950 }, place: "Lahore" },
        death: { date: { year: 2010 }, place: "Karachi" },
        notes: "Farmer",
        isLiving: false,
      }),
      person("b", "", "", "female", { isPlaceholder: true }),
    ],
    [],
    "a",
  );
  const ids = ["a", "b"];

  test("name, native name, lifespan and labelled details", () => {
    const [a, b] = buildPeople(d, ids, { includeDates: true }, t);
    expect(a).toMatchObject({
      id: "a",
      name: "Ali Khan",
      nativeName: "علی",
      lifespan: "1950 – †2010",
    });
    expect(a!.details).toEqual([
      { label: "Born", value: "1950, Lahore" },
      { label: "Died", value: "2010, Karachi" },
      { label: "Notes", value: "Farmer" },
    ]);
    expect(b!.name).toBe("Unknown mother");
    expect(b!.details).toEqual([]);
  });

  test("dates in the export's language, through Intl", () => {
    const dated = docOf(
      [
        person("a", "Ali", "Khan", "male", {
          birth: { date: { year: 1950, month: 3, day: 14 } },
        }),
      ],
      [],
      "a",
    );
    const [ar] = buildPeople(dated, ["a"], { includeDates: true }, t, "ar");
    expect(ar!.details[0]!.value).toBe(fmt("ar"));
    const [en] = buildPeople(dated, ["a"], { includeDates: true }, t);
    expect(en!.details[0]!.value).toBe("14 Mar 1950");
  });

  test("leaves dates out when they are off, keeping places and notes", () => {
    const [a] = buildPeople(d, ["a"], { includeDates: false }, t);
    expect(a!.lifespan).toBe("");
    expect(a!.details).toEqual([
      { label: "Born", value: "Lahore" },
      { label: "Died", value: "Karachi" },
      { label: "Notes", value: "Farmer" },
    ]);
  });
});

describe("GEDCOM export", () => {
  const living = docOf(
    [
      person("a", "Ann", "Lee", "female", {
        birth: { date: { year: 1990 } },
        notes: "secret",
      }),
      person("b", "Bob", "Lee", "male", {
        isLiving: false,
        birth: { date: { year: 1900 } },
      }),
    ],
    [],
    "a",
  );
  const gedReq = (privacy: boolean) => ({
    ...req({ ...switchFormat(defaultSettings(), "gedcom"), privacy }),
    input: { ...input, doc: living },
  });
  const realLoad = {
    ...load,
    gedcom: () => import("@/io/gedcom"),
  } as unknown as Loaders;

  test("writes the whole tree as GEDCOM without rendering anything", async () => {
    const { blob } = await runExport(gedReq(false), realLoad);
    const text = await blob.text();
    expect(text).toContain("0 HEAD");
    expect(text).toContain("1 NAME Ann /Lee/");
    expect(text).toContain("1990");
    expect(text).toContain("secret");
    expect(calls.map((c) => c.fn)).not.toContain("renderTreeSvg");
  });

  test("privacy mode strips the living and keeps the dead", async () => {
    const text = await (await runExport(gedReq(true), realLoad)).blob.text();
    expect(text).toContain("1 NAME Ann /Lee/");
    expect(text).not.toContain("1990");
    expect(text).not.toContain("secret");
    expect(text).toContain("1900");
  });
});
