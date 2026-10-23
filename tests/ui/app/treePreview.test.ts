import { describe, expect, test } from "bun:test";

import { CARD_H, ROW_H } from "@/core/layout/constants";
import type { TreeDocument } from "@/core/model/types";
import {
  cachedPreview,
  PREVIEW_ASPECT,
  PREVIEW_GENERATIONS,
  previewOf,
  treePreview,
} from "@/ui/app/treePreview";

import { docOf, famSimple, person, union } from "../../fixtures/families";

/** Five generations in a line: g0 → g1 → g2 → g3 → g4, each with a spouse. */
function fiveGenerations(): TreeDocument {
  const persons = [];
  const unions = [];
  for (let g = 0; g < 5; g++) {
    persons.push(person(`g${g}`, `Gen${g}`, "Line", "male"));
    persons.push(person(`s${g}`, `Spouse${g}`, "Line", "female", { isLiving: g > 1 }));
    unions.push(union(`u${g}`, [`g${g}`, `s${g}`], g < 4 ? [`g${g + 1}`] : []));
  }
  return { ...docOf(persons, unions, "g0"), id: "five" };
}

/** A root couple with twelve children: far wider than the preview frame. */
function wideFamily(): TreeDocument {
  const kids = Array.from({ length: 12 }, (_, i) => `k${i}`);
  return {
    ...docOf(
      [
        person("dad", "A", "Wide", "male"),
        person("mom", "B", "Wide", "female"),
        ...kids.map((id) => person(id, id, "Wide", "male")),
      ],
      [union("u", ["dad", "mom"], kids)],
      "dad",
    ),
    id: "wide",
  };
}

const empty = (): TreeDocument => ({
  ...famSimple(),
  id: "empty",
  persons: {},
  unions: {},
  unionOrder: {},
  rootPersonId: undefined,
});

describe("treePreview", () => {
  test("an empty tree has no preview and no generations", () => {
    expect(treePreview(empty())).toEqual({ generations: 0, drawing: null });
  });

  test("draws every card of a small family, with its gender, life and generation", () => {
    const { generations, drawing } = treePreview(famSimple());
    expect(generations).toBe(2);
    expect(drawing!.cards).toHaveLength(5);
    expect(drawing!.cards.map((c) => c.generation).toSorted()).toEqual([0, 0, 1, 1, 1]);
    expect(drawing!.cards.filter((c) => c.gender === "female")).toHaveLength(2);
    expect(drawing!.cards.every((c) => c.living)).toBe(true);
    // The union line and three child lines.
    expect(drawing!.lines.length).toBeGreaterThanOrEqual(4);
    for (const d of drawing!.lines) expect(d).toMatch(/^M[-\d.]+ [-\d.]+(L[-\d.]+ [-\d.]+)+$/);
  });

  test("counts every generation but draws only the first three", () => {
    const { generations, drawing } = treePreview(fiveGenerations());
    expect(generations).toBe(5);
    expect(PREVIEW_GENERATIONS).toBe(3);
    const shown = new Set(drawing!.cards.map((c) => c.generation));
    expect([...shown].toSorted()).toEqual([0, 1, 2]);
    expect(drawing!.cards.filter((c) => !c.living)).toHaveLength(2);
    // No line runs down to a generation that is not drawn.
    const lowest = (PREVIEW_GENERATIONS - 1) * ROW_H + CARD_H;
    for (const d of drawing!.lines) {
      for (const [, y] of d.matchAll(/[ML][-\d.]+ ([-\d.]+)/g)) {
        expect(Number(y)).toBeLessThanOrEqual(lowest);
      }
    }
  });

  test("the view box has the frame's aspect ratio and contains the root", () => {
    for (const doc of [famSimple(), fiveGenerations(), wideFamily()]) {
      const { viewBox, cards } = treePreview(doc).drawing!;
      const [x, y, w, h] = viewBox;
      expect(w / h).toBeCloseTo(PREVIEW_ASPECT, 5);
      const root = cards.find((c) => c.generation === 0)!;
      expect(root.x).toBeGreaterThanOrEqual(x);
      expect(root.y).toBeGreaterThanOrEqual(y);
      expect(root.x + root.width).toBeLessThanOrEqual(x + w);
    }
  });

  test("a wide family is cropped around the root instead of shrunk to a sliver", () => {
    const { viewBox, cards } = treePreview(wideFamily()).drawing!;
    const right = Math.max(...cards.map((c) => c.x + c.width));
    const left = Math.min(...cards.map((c) => c.x));
    expect(viewBox[2]).toBeLessThan(right - left);
    expect(treePreview(wideFamily()).drawing!.cropped).toBe(true);
    expect(treePreview(famSimple()).drawing!.cropped).toBe(false);
    // The card height stays a readable share of the frame.
    expect(cards[0]!.height / viewBox[3]).toBeGreaterThan(0.12);
  });

  test("a tree without a root is drawn from its first person's topmost ancestor", () => {
    const doc = { ...famSimple(), rootPersonId: undefined };
    expect(treePreview(doc).generations).toBe(2);
  });
});

describe("previewOf: cached by tree and edit time", () => {
  test("the same tree at the same edit time gives the very same preview", () => {
    const doc = { ...famSimple(), id: "cache-a" };
    expect(previewOf(doc)).toBe(previewOf({ ...doc }));
  });

  test("an edit makes a new preview", () => {
    const doc = { ...famSimple(), id: "cache-b" };
    const before = previewOf(doc);
    const edited = {
      ...doc,
      persons: { dad: doc.persons.dad! },
      unions: {},
      unionOrder: {},
      updatedAt: "2026-02-01T00:00:00.000Z",
    };
    const after = previewOf(edited);
    expect(after).not.toBe(before);
    expect(after.drawing!.cards).toHaveLength(1);
  });

  test("cachedPreview finds a preview only at the edit time it was made for", () => {
    const doc = { ...famSimple(), id: "cache-c" };
    expect(cachedPreview("cache-c", doc.updatedAt)).toBeUndefined();
    const made = previewOf(doc);
    expect(cachedPreview("cache-c", doc.updatedAt)).toBe(made);
    expect(cachedPreview("cache-c", "2027-01-01T00:00:00.000Z")).toBeUndefined();
  });
});
