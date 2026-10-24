import { describe, expect, test } from "bun:test";

import { render } from "@testing-library/react";

import { layoutFamily } from "@/core/layout/family";
import { renderTreeSvg } from "@/export/render/renderTreeSvg";
import { TEMPLATES } from "@/templates";
import {
  type CardStyle,
  mergeCardStyle,
  normalizeCardStyle,
  normalizeCardStyles,
} from "@/templates/cardStyle";
import { DEFAULT_LOOK } from "@/templates/look";
import { metricsFor } from "@/templates/metrics";
import { stressFamily } from "@/templates/samples";
import { PersonCard } from "@/ui/cards/PersonCard";

import { t } from "../ui/i18n";

describe("normalizeCardStyle", () => {
  test("keeps usable values, clamps numbers, drops the rest", () => {
    expect(
      normalizeCardStyle({
        size: { w: 400, h: 10 },
        fill: "#ABCDEF",
        border: { colour: "#000000", width: 9 },
        radius: -4,
        padding: 100,
        lines: { name: { preset: "h1", bold: true, colour: "red", align: "middle" }, x: {} },
        extra: 1,
      }),
    ).toEqual({
      size: { w: 250, h: 60 },
      fill: "#abcdef",
      border: { colour: "#000000", width: 4 },
      radius: 0,
      padding: 32,
      lines: { name: { preset: "h1", bold: true } },
    });
    expect(normalizeCardStyle({ fill: "blue" })).toBeUndefined();
    expect(normalizeCardStyles({ a: { radius: 8 }, b: { nothing: true }, c: 3 })).toEqual({
      a: { radius: 8 },
    });
  });

  test("merging keeps other line styles and fields", () => {
    const style: CardStyle = { fill: "#111111", lines: { name: { bold: true } } };
    expect(mergeCardStyle(style, { lines: { name: { italic: true } } })).toEqual({
      fill: "#111111",
      lines: { name: { bold: true, italic: true } },
    });
  });
});

describe("faces draw a card's own style", () => {
  const doc = stressFamily();
  const metrics = metricsFor(DEFAULT_LOOK);
  const node = layoutFamily(doc, { rootId: "ismail", metrics }).nodes.find(
    (n) => n.personId === "haider",
  )!;
  const style: CardStyle = {
    fill: "#123456",
    border: { colour: "#654321", width: 3 },
    lines: {
      name: { preset: "h1", italic: true, underline: true, colour: "#aa0000", align: "end" },
    },
  };

  for (const template of Object.values(TEMPLATES)) {
    test(template.id, () => {
      const plain = render(
        <svg>
          <PersonCard doc={doc} node={node} metrics={metrics} template={template} static />
        </svg>,
      );
      const plainName = plain.container.querySelector('[data-line="name"]')!;
      const plainSize = Number(plainName.getAttribute("font-size"));
      plain.unmount();

      const { container } = render(
        <svg>
          <PersonCard
            doc={doc}
            node={node}
            metrics={metrics}
            template={template}
            cardStyle={style}
            static
          />
        </svg>,
      );
      const outline = container.querySelector(".stam-face__outline") as SVGElement;
      // Shajara keeps one fill for everyone; the rest take the card's own.
      if (template.id !== "shajara") expect(outline.style.fill).toBe("#123456");
      expect(outline.style.stroke).toBe("#654321");
      const name = container.querySelector('[data-line="name"]') as SVGTextElement;
      expect(Number(name.getAttribute("font-size"))).toBeGreaterThan(plainSize);
      expect(name.getAttribute("font-style")).toBe("italic");
      expect(name.getAttribute("text-decoration")).toBe("underline");
      expect(name.style.fill).toBe("#aa0000");
      expect(name.getAttribute("text-anchor")).toBe("end");
    });
  }
});

describe("exports", () => {
  test("a resized, styled card keeps its size and colours in the SVG", () => {
    const doc = stressFamily();
    const look = DEFAULT_LOOK;
    const metrics = metricsFor(look);
    const cardStyles = { haider: { size: { w: 200, h: 150 }, fill: "#123456" } };
    const layout = layoutFamily(doc, {
      rootId: "ismail",
      metrics,
      sizes: (id) =>
        id === "haider" ? { w: metrics.cardW * 2, h: metrics.cardH * 1.5 } : undefined,
    });
    const { svg } = renderTreeSvg(
      { doc, layout, viewRootId: null, selectedId: null, photos: {}, look, cardStyles },
      {
        scope: "whole",
        theme: "light",
        includeDates: true,
        includePhotos: false,
        showRuler: false,
        privacy: false,
        background: "solid",
        frame: true,
      },
      t,
    );
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const haider = dom.querySelector('[data-person-id="haider"] .stam-face__outline')!;
    expect(haider.getAttribute("style")).toContain("#123456");
    // Twice as wide as the template card: its outline path reaches x = 2 × cardW.
    expect(haider.getAttribute("d")).toContain(String(metrics.cardW * 2));
  });
});
