import { describe, expect, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import { growUpward } from "@/core/layout/flip";
import { fontsFor } from "@/export/render/fonts";
import { legendUse } from "@/export/render/frame";
import { renderTreeSvg } from "@/export/render/renderTreeSvg";
import type { ExportOptions } from "@/export/types";
import { TEMPLATES } from "@/templates";
import { MARHUM } from "@/templates/faces/shajara";
import { DEFAULT_LOOK, type Look, TEMPLATE_IDS, type TemplateId } from "@/templates/look";
import { metricsFor } from "@/templates/metrics";
import { bigFamily, stressFamily } from "@/templates/samples";

import { t } from "../ui/i18n";

const OPTS: ExportOptions = {
  scope: "whole",
  theme: "light",
  includeDates: true,
  includePhotos: false,
  showRuler: false,
  privacy: false,
  background: "solid",
  frame: true,
};

function poster(template: TemplateId, doc = stressFamily(), extra: Partial<ExportOptions> = {}) {
  const look: Look = { ...DEFAULT_LOOK, template };
  const raw = layoutFamily(doc, { rootId: doc.rootPersonId!, metrics: metricsFor(look) });
  const layout = TEMPLATES[template].growth === "up" ? growUpward(raw) : raw;
  const input = { doc, layout, viewRootId: null, selectedId: null, photos: {}, look };
  const { svg } = renderTreeSvg(input, { ...OPTS, look, ...extra }, t);
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

const texts = (dom: Document, selector: string) =>
  [...dom.querySelectorAll(selector)].map((el) => el.textContent ?? "");

describe("every template draws the stress family's marks", () => {
  for (const id of TEMPLATE_IDS) {
    test(id, () => {
      const dom = poster(id);
      expect(dom.querySelector("parsererror")).toBeNull();
      // Everyone is drawn, each with a photo slot whose ring is the gender marker.
      expect(dom.querySelectorAll("[data-person-id]")).toHaveLength(11);
      // Gallery's unknown person is a dashed medallion with no ring; everyone else has one.
      expect(dom.querySelectorAll(".stam-card__key")).toHaveLength(id === "gallery" ? 10 : 11);
      // The divorce: a "//" on Nasreen and Haider's couple line.
      expect(dom.querySelectorAll(".stam-edge__divorce")).toHaveLength(1);
      // The adopted son: only his own drop is dashed.
      const dashed = [...dom.querySelectorAll("[data-edge-id] path, path[data-edge-id]")].filter(
        (p) => p.getAttribute("stroke-dasharray"),
      );
      expect(dashed).toHaveLength(1);
      // The unknown husband: a dashed outline (Gallery: a dashed medallion).
      const unknown = dom.querySelector(
        id === "gallery"
          ? '[data-person-id="unknown"] .stam-card__avatar circle'
          : '[data-person-id="unknown"] .stam-face__outline',
      );
      expect(unknown?.getAttribute("style")).toContain("stroke-dasharray");
      // The legend explains what the tree uses, and the credit is there.
      const legend = texts(dom, ".stam-export__legend text").join(" | ");
      expect(legend).toContain(t("export.frameText.legend.divorced"));
      expect(legend).toContain(t("export.frameText.legend.adopted"));
      expect(legend).toContain(t("export.frameText.legend.unknown"));
      expect(legend).toContain(t("export.frameText.legend.deceased"));
      expect(legend).toContain("Made with Stam");
      // A title, and no stylesheet variables: exports carry literal colours.
      expect(dom.querySelector(".stam-export__title")?.textContent).toBeTruthy();
      expect(new XMLSerializer().serializeToString(dom)).not.toContain("var(--");
    });
  }

  test("Shajara marks the departed with مرحوم and reads right to left in its legend", () => {
    const dom = poster("shajara");
    const years = texts(dom, '[data-person-id="haider"] .stam-card__years');
    expect(years[0]).toContain(MARHUM);
    expect(texts(dom, ".stam-export__legend text").join(" ")).toContain(MARHUM);
  });

  test("Swiss marks the departed with † after the name", () => {
    const dom = poster("swiss");
    expect(texts(dom, '[data-person-id="haider"] .stam-card__name')[0]).toContain("†");
  });

  test("Gallery draws the eldest generation in its accent", () => {
    const dom = poster("gallery");
    const accent = TEMPLATES.gallery.palettes.light.accent;
    const raje = dom.querySelector('[data-person-id="raje"] .stam-card__avatar circle');
    // Raje has died: a hollow medallion with an accent ring.
    expect(raje?.getAttribute("style")).toContain(accent);
  });

  test("Botanical grows upward: the eldest couple is drawn below their children", () => {
    const dom = poster("botanical");
    const y = (id: string) =>
      Number(
        /translate\([-\d.]+ ([-\d.]+)/.exec(
          dom.querySelector(`[data-person-id="${id}"]`)!.getAttribute("transform")!,
        )![1],
      );
    expect(y("ismail")).toBeGreaterThan(y("haider"));
    expect(y("haider")).toBeGreaterThan(y("ibrahim"));
    expect(dom.querySelector(".stam-export__trunk")).not.toBeNull();
    expect(texts(dom, ".stam-export__trunk text")[0]).toBe("Lahore · 1921");
  });

  test("the credit line can be turned off", () => {
    const dom = poster("album", stressFamily(), { madeWith: false });
    expect(texts(dom, ".stam-export__legend text").join(" ")).not.toContain("Made with Stam");
  });

  test("40 people over five generations fit every template's page", () => {
    for (const id of TEMPLATE_IDS) {
      const dom = poster(id, bigFamily());
      expect(dom.querySelectorAll("[data-person-id]").length).toBeGreaterThanOrEqual(30);
      const svg = dom.documentElement;
      expect(Number(svg.getAttribute("width"))).toBeGreaterThan(0);
    }
  });
});

describe("legendUse", () => {
  test("a plain family uses none of the special marks", () => {
    const doc = bigFamily();
    const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
    expect(legendUse(doc, layout)).toMatchObject({
      divorced: false,
      adopted: false,
      unknown: false,
      folded: false,
    });
  });
});

describe("growUpward", () => {
  test("mirrors rows about the tree's band and keeps card sizes", () => {
    const doc = stressFamily();
    const layout = layoutFamily(doc, { rootId: doc.rootPersonId! });
    const up = growUpward(layout);
    const top = Math.min(...layout.nodes.map((n) => n.y));
    const bottom = Math.max(...layout.nodes.map((n) => n.y));
    for (const [i, n] of layout.nodes.entries()) {
      expect(up.nodes[i]!.y).toBe(top + bottom - n.y);
      expect(up.nodes[i]!.x).toBe(n.x);
    }
    expect(growUpward(up).nodes).toEqual(layout.nodes);
  });
});

describe("export fonts", () => {
  test("each template embeds its own families; Shajara always brings Nastaliq", () => {
    const doc = bigFamily();
    const families = (id: TemplateId) => new Set(fontsFor(doc, [], id).map((f) => f.family));
    expect(families("heritage").has("Cormorant Garamond Variable")).toBe(true);
    expect(families("botanical").has("Fraunces Variable")).toBe(true);
    expect(families("album").has("Caveat Variable")).toBe(true);
    expect(families("gallery").has("Cormorant Garamond Variable")).toBe(false);
    expect(families("shajara").has("Noto Nastaliq Urdu")).toBe(true);
  });
});
