import { describe, expect, test } from "bun:test";

import { CARD_H, CARD_W } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import type { LayoutResult } from "@/core/layout/types";
import { selectScope } from "@/export/render/scope";
import type { ExportInput, ExportOptions, ExportScope } from "@/export/types";

import { famCousinMarriage } from "../../fixtures/families";

const OPTS: ExportOptions = {
  scope: "view",
  theme: "light",
  includeDates: true,
  includePhotos: false,
  showRuler: false,
  privacy: false,
  background: "solid",
};

const people = (layout: LayoutResult) => new Set(layout.nodes.map((n) => n.personId));

function input(extra: Partial<ExportInput> = {}): ExportInput {
  const doc = famCousinMarriage();
  // The editor shows both branches collapsed.
  const layout = layoutFamily(doc, { rootId: "g1", collapsed: new Set(["p1", "p2"]) });
  return { doc, layout, viewRootId: null, selectedId: null, photos: {}, ...extra };
}

const scope = (s: ExportScope, extra?: Partial<ExportInput>) =>
  selectScope(input(extra), { ...OPTS, scope: s });

describe("selectScope", () => {
  test("view is the input layout as it is", () => {
    const i = input();
    expect(selectScope(i, OPTS)).toBe(i.layout);
  });

  test("whole re-lays out from the document root with nothing collapsed", () => {
    const view = input().layout;
    expect(people(view).has("kid")).toBe(false);
    expect(people(scope("whole"))).toEqual(
      new Set(["g1", "g2", "p1", "p2", "s1", "s2", "cousin1", "cousin2", "kid"]),
    );
  });

  test("branch is the selected person, their partners and descendants", () => {
    expect(people(scope("branch", { selectedId: "p2" }))).toEqual(
      new Set(["p2", "s2", "cousin2", "cousin1", "kid"]),
    );
  });

  test("branch without a selection falls back to view", () => {
    const i = input();
    expect(selectScope(i, { ...OPTS, scope: "branch" })).toBe(i.layout);
    expect(selectScope({ ...i, selectedId: "gone" }, { ...OPTS, scope: "branch" })).toBe(i.layout);
  });

  test("visible keeps the nodes and edges that intersect the rect", () => {
    const full = scope("whole");
    const g1 = full.nodes.find((n) => n.personId === "g1")!;
    // Just the top row, cut half way into its first card.
    const rect = { x: g1.x + CARD_W / 2, y: g1.y, width: 10_000, height: CARD_H };
    const cropped = selectScope(
      { ...input(), layout: full, visibleRect: rect },
      { ...OPTS, scope: "visible" },
    );
    expect(people(cropped)).toEqual(new Set(["g1", "g2"]));
    expect(cropped.edges.map((e) => e.id)).toContain(
      full.edges.find((e) => e.kind === "union" && e.unionId === "ug")!.id,
    );
    expect(cropped.edges.every((e) => e.unionId === "ug")).toBe(true);
    // The whole first card stays in the bounds; edge stubs are cut at the rect.
    expect(cropped.bounds.x).toBe(g1.x);
    expect(cropped.bounds.y).toBe(g1.y);
    expect(cropped.bounds.y + cropped.bounds.height).toBe(g1.y + CARD_H);
    expect(Object.keys(cropped.primaryNode).toSorted()).toEqual(["g1", "g2"]);
  });

  test("visible without a rect falls back to view", () => {
    const i = input();
    expect(selectScope(i, { ...OPTS, scope: "visible" })).toBe(i.layout);
  });
});
