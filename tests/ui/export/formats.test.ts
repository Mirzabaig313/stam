import { describe, expect, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import { tileLayout } from "@/export/pdf/geometry";
import {
  defaultSettings,
  estimateOutput,
  exportFileName,
  posterPageSpec,
  switchFormat,
  tiledPageGuard,
  toExportOptions,
} from "@/ui/export/formats";

import { famSimple } from "../../fixtures/families";

describe("privacy default follows the format until the user decides", () => {
  test("on for HTML and images, off for SVG and PDF", () => {
    const base = defaultSettings();
    expect(base.format).toBe("svg");
    expect(base.privacy).toBe(false);
    expect(switchFormat(base, "png").privacy).toBe(true);
    expect(switchFormat(base, "jpeg").privacy).toBe(true);
    expect(switchFormat(base, "html").privacy).toBe(true);
    expect(switchFormat(switchFormat(base, "html"), "pdf-poster").privacy).toBe(false);
  });

  test("a choice made by the user is kept across formats", () => {
    const chosen = { ...defaultSettings(), privacy: true, privacyTouched: true };
    expect(switchFormat(chosen, "pdf-tiled").privacy).toBe(true);
    const off = {
      ...switchFormat(defaultSettings(), "html"),
      privacy: false,
      privacyTouched: true,
    };
    expect(switchFormat(off, "png").privacy).toBe(false);
  });
});

describe("file names", () => {
  const doc = { ...famSimple(), name: "The Khan Family!" };
  const day = new Date(2026, 9, 5);
  test("{slug}-{yyyy-mm-dd}.{ext}", () => {
    expect(exportFileName(doc, "svg", day)).toBe("the-khan-family-2026-10-05.svg");
    expect(exportFileName(doc, "png", day)).toBe("the-khan-family-2026-10-05.png");
    expect(exportFileName(doc, "jpeg", day)).toBe("the-khan-family-2026-10-05.jpg");
    expect(exportFileName(doc, "pdf-poster", day)).toBe("the-khan-family-2026-10-05.pdf");
    expect(exportFileName(doc, "pdf-tiled", day)).toBe("the-khan-family-2026-10-05.pdf");
    expect(exportFileName(doc, "html", day)).toBe("the-khan-family-2026-10-05.html");
  });
  test("falls back to family for a name with no letters", () => {
    expect(exportFileName({ ...doc, name: "!!!" }, "svg", day)).toBe("family-2026-10-05.svg");
  });
});

describe("toExportOptions", () => {
  test("maps the settings and drops blank titles", () => {
    const s = {
      ...defaultSettings(),
      title: "  ",
      subtitle: "Since 1900",
      scope: "branch" as const,
    };
    const o = toExportOptions(s);
    expect(o.scope).toBe("branch");
    expect(o.title).toBeUndefined();
    expect(o.subtitle).toBe("Since 1900");
    expect(o.background).toBe("solid");
  });
  test("JPEG, PDF and HTML are always on a solid ground", () => {
    for (const format of ["jpeg", "pdf-poster", "pdf-tiled", "html"] as const) {
      const s = { ...defaultSettings(), format, background: "transparent" as const };
      expect(toExportOptions(s).background).toBe("solid");
    }
    const png = {
      ...defaultSettings(),
      format: "png" as const,
      background: "transparent" as const,
    };
    expect(toExportOptions(png).background).toBe("transparent");
  });
});

describe("estimateOutput", () => {
  const doc = famSimple();
  const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
  const input = { doc, layout, viewRootId: null, selectedId: null };
  const pad = 96;

  test("pixels scale with the raster factor", () => {
    const one = estimateOutput({ ...defaultSettings(), format: "png", scale: 1 }, input);
    const two = estimateOutput({ ...defaultSettings(), format: "png", scale: 2 }, input);
    expect(one).toEqual({
      kind: "px",
      width: Math.ceil(layout.bounds.width + pad),
      height: Math.ceil(layout.bounds.height + pad),
    });
    expect(two).toEqual({
      kind: "px",
      width: (one as { width: number }).width * 2,
      height: (one as { height: number }).height * 2,
    });
  });

  test("the visible scope uses the visible rectangle", () => {
    const e = estimateOutput(
      { ...defaultSettings(), format: "png", scale: 1, scope: "visible" },
      { ...input, visibleRect: { x: 0, y: 0, width: 300, height: 200 } },
    );
    expect(e).toEqual({ kind: "px", width: 396, height: 296 });
  });

  test("a poster is one page; tiling counts pages, guide included", () => {
    expect(estimateOutput({ ...defaultSettings(), format: "pdf-poster" }, input)).toEqual({
      kind: "pages",
      count: 1,
    });
    const small = estimateOutput({ ...defaultSettings(), format: "pdf-tiled" }, input);
    const big = estimateOutput({ ...defaultSettings(), format: "pdf-tiled", tiledScale: 4 }, input);
    expect(small?.kind).toBe("pages");
    expect((small as { count: number }).count).toBeGreaterThanOrEqual(2);
    expect((big as { count: number }).count).toBeGreaterThan((small as { count: number }).count);
  });

  test("SVG, HTML and JSON have no pixel size worth quoting for JSON", () => {
    expect(estimateOutput({ ...defaultSettings(), format: "json" }, input)).toBeNull();
    expect(estimateOutput({ ...defaultSettings(), format: "svg" }, input)?.kind).toBe("px");
  });
});

describe("posterPageSpec", () => {
  test("a named page stays a name; Custom is the size in mm, clamped to 100 to 5000", () => {
    expect(posterPageSpec({ ...defaultSettings(), page: "A2" })).toBe("A2");
    const custom = { ...defaultSettings(), page: "Custom" as const };
    expect(posterPageSpec({ ...custom, customW: 600, customH: 900 })).toEqual({ w: 600, h: 900 });
    expect(posterPageSpec({ ...custom, customW: 10, customH: 99999 })).toEqual({ w: 100, h: 5000 });
    expect(posterPageSpec({ ...custom, customW: Number.NaN, customH: 300 })).toEqual({
      w: 100,
      h: 300,
    });
  });
});

describe("tiled page count", () => {
  const doc = famSimple();
  const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
  const input = { doc, layout, viewRootId: null, selectedId: null };

  test("is the real tileLayout page count, landscape pages included", () => {
    const s = { ...defaultSettings(), format: "pdf-tiled" as const, tiledScale: 4 as number };
    const w = Math.ceil(layout.bounds.width + 96);
    const h = Math.ceil(layout.bounds.height + 96);
    const real = tileLayout(w, h, { page: "A4", scale: 4, overlapMm: 10 });
    expect(estimateOutput(s, input)).toEqual({ kind: "pages", count: real.pageCount });
  });

  test("the guard asks above 100 pages and refuses above 400", () => {
    expect(tiledPageGuard(100)).toBe("ok");
    expect(tiledPageGuard(101)).toBe("confirm");
    expect(tiledPageGuard(400)).toBe("confirm");
    expect(tiledPageGuard(401)).toBe("refuse");
  });
});

describe("GEDCOM", () => {
  const doc = { ...famSimple(), name: "Khan Family" };
  test("saves as .ged, privacy on by default (the files get shared), no size estimate", () => {
    expect(exportFileName(doc, "gedcom", new Date(2026, 9, 5))).toBe("khan-family-2026-10-05.ged");
    const s = switchFormat(defaultSettings(), "gedcom");
    expect(s.privacy).toBe(true);
    expect(s.includePhotos).toBe(false);
    const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
    expect(estimateOutput(s, { doc, layout, viewRootId: null, selectedId: null })).toBeNull();
  });
});
