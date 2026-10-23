import { describe, expect, test } from "bun:test";

import { layoutTimeline } from "@/core/layout/timeline";

import { docOf, famSimple, person, union } from "../../fixtures/families";

const NOW = new Date("2026-07-01T12:00:00Z");
const NOW_YEAR = 2026.5;

/**
 * gp (1900–1970) + gm (1905, dead, no death date). Children: c2 (1935), c1 (1930, living),
 * cx (no birth). c1 + w (1932–1990) have g (1960-07, living). `stranger` is not connected.
 */
function famTimeline() {
  return docOf(
    [
      person("gp", "Gul", "", "male", {
        isLiving: false,
        birth: { date: { year: 1900 } },
        death: { date: { year: 1970 } },
      }),
      person("gm", "Mah", "", "female", { isLiving: false, birth: { date: { year: 1905 } } }),
      person("c2", "Bano", "", "female", { isLiving: false, birth: { date: { year: 1935 } } }),
      person("c1", "Ali", "", "male", { birth: { date: { year: 1930 } } }),
      person("cx", "Unknown", "", "male"),
      person("w", "Wafa", "", "female", {
        isLiving: false,
        birth: { date: { year: 1932 } },
        death: { date: { qualifier: "before", year: 1990 } },
      }),
      person("g", "Gul", "", "male", { birth: { date: { year: 1960, month: 7 } } }),
      person("stranger", "S", "", "male", { birth: { date: { year: 1950 } } }),
    ],
    [union("u1", ["gp", "gm"], ["c2", "c1", "cx"]), union("u2", ["c1", "w"], ["g"])],
    "gp",
  );
}

describe("layoutTimeline", () => {
  test("rows are grouped by generation and ordered by birth", () => {
    const tl = layoutTimeline(famTimeline(), { rootId: "gp" }, NOW);
    expect(tl.bars.map((b) => [b.personId, b.row, b.generation])).toEqual([
      ["gp", 0, 0],
      ["gm", 1, 0],
      ["c1", 2, 1],
      ["w", 3, 1],
      ["c2", 4, 1],
      ["g", 5, 2],
    ]);
    expect(tl.rows).toBe(6);
    expect(tl.generationRows).toEqual([
      { generation: 0, firstRow: 0, lastRow: 1 },
      { generation: 1, firstRow: 2, lastRow: 4 },
      { generation: 2, firstRow: 5, lastRow: 5 },
    ]);
    expect(tl.minYear).toBe(1900);
    expect(tl.maxYear).toBe(NOW_YEAR);
  });

  test("known, unknown and living ends", () => {
    const tl = layoutTimeline(famTimeline(), { rootId: "gp" }, NOW);
    const bar = (id: string) => tl.bars.find((b) => b.personId === id)!;
    expect(bar("gp")).toMatchObject({
      start: 1900,
      end: 1970,
      startKnown: true,
      endKnown: true,
      living: false,
    });
    // Dead with no death date: 70 years, flagged unknown.
    expect(bar("gm")).toMatchObject({ start: 1905, end: 1975, endKnown: false, living: false });
    // Living: ends now.
    expect(bar("c1")).toMatchObject({ start: 1930, end: NOW_YEAR, endKnown: true, living: true });
    // An open-ended death date ("before 1990") is not a known end.
    expect(bar("w")).toMatchObject({ end: 1990, endKnown: false, living: false });
    // A birth month gives a fractional start.
    expect(bar("g").start).toBe(1960.5);
  });

  test("people with no birth year and people outside the family view get no bar", () => {
    const ids = layoutTimeline(famTimeline(), { rootId: "gp" }, NOW).bars.map((b) => b.personId);
    expect(ids).not.toContain("cx");
    expect(ids).not.toContain("stranger");
  });

  test("covers only the family view of the root", () => {
    const tl = layoutTimeline(famTimeline(), { rootId: "c1" }, NOW);
    expect(tl.bars.map((b) => [b.personId, b.generation])).toEqual([
      ["c1", 0],
      ["w", 0],
      ["g", 1],
    ]);
  });

  test("defaults `now` to the current date", () => {
    const tl = layoutTimeline(famSimple(), { rootId: "dad" });
    const year = new Date().getUTCFullYear();
    for (const b of tl.bars) {
      expect(b.living).toBe(true);
      expect(Math.floor(b.end)).toBe(year);
    }
  });

  test("an empty or unknown root gives no bars", () => {
    const tl = layoutTimeline(famSimple(), { rootId: "nobody" }, NOW);
    expect(tl).toEqual({
      bars: [],
      minYear: 2026,
      maxYear: 2026,
      rows: 0,
      generationRows: [],
    });
  });
});

describe("layoutTimeline: very old people", () => {
  test("someone born more than 110 years ago with no death recorded is not drawn as living", () => {
    const doc = docOf(
      [
        person("old", "Old", "", "male", { birth: { date: { year: 1880 } } }),
        person("kid", "Kid", "", "male", { birth: { date: { year: 1950 } } }),
      ],
      [union("u", ["old"], ["kid"])],
      "old",
    );
    const bars = layoutTimeline(doc, { rootId: "old" }, NOW).bars;
    expect(bars.find((b) => b.personId === "old")).toMatchObject({
      living: false,
      endKnown: false,
      end: 1950,
    });
    expect(bars.find((b) => b.personId === "kid")).toMatchObject({ living: true });
  });
});
