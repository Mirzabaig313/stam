import { describe, expect, test } from "bun:test";

import { CARD_W } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import { layoutPedigree } from "@/core/layout/pedigree";
import { dimmedEdgeIds, focusSet, mirrorFrame, pathEdgeIds } from "@/ui/canvas/derive";
import { settledFrame } from "@/ui/canvas/useLayoutTween";

import { famCousinMarriage } from "../../fixtures/families";
import { cardFamily } from "../cards/fixtures";

describe("focusSet", () => {
  test("is the person, every ancestor and every descendant", () => {
    const doc = cardFamily();
    expect([...focusSet(doc, "ali")].toSorted()).toEqual(["ahmed", "ali", "bilal", "sara"]);
    expect([...focusSet(doc, "hina")].toSorted()).toEqual(["bilal", "hina", "imran", "unknownMom"]);
  });

  test("follows adopted links too", () => {
    expect([...focusSet(cardFamily(), "omar")].toSorted()).toEqual(["ahmed", "omar", "sara"]);
  });
});

describe("dimmedEdgeIds", () => {
  test("keeps edges between focused people and dims the rest", () => {
    const doc = cardFamily();
    const layout = layoutFamily(doc, { rootId: "ahmed" });
    const dimmed = dimmedEdgeIds(layout.edges, layout.nodes, doc, focusSet(doc, "ali"));
    const kept = layout.edges.map((e) => e.id).filter((id) => !dimmed.has(id));
    expect(kept.toSorted()).toEqual(["child:u1:ali", "child:u3:bilal", "union:u1"]);
  });
});

describe("pathEdgeIds", () => {
  test("a union drawn twice (pedigree collapse, id union:<id>~2) lights both copies by unionId", () => {
    const doc = famCousinMarriage();
    const layout = layoutPedigree(doc, { focusId: "kid" });
    expect(layout.edges.some((e) => e.id === "union:ug~2")).toBe(true);
    const spouses = pathEdgeIds(layout.edges, layout.nodes, doc, ["g1", "g2"]);
    expect([...spouses].toSorted()).toEqual(["union:ug", "union:ug~2"]);
    // cousin1 → p1 → g1 → p2 → cousin2: both child lines out of the twice-drawn union.
    const cousins = pathEdgeIds(layout.edges, layout.nodes, doc, [
      "cousin1",
      "p1",
      "g1",
      "p2",
      "cousin2",
    ]);
    expect(cousins.has("union:ug")).toBe(false);
    const childLines = [...cousins].filter((id) => id.startsWith("child:ug:"));
    expect(childLines.length).toBe(2);
  });

  test("a path up and over to a sibling keeps the child lines of both and nothing else", () => {
    const doc = cardFamily();
    const layout = layoutFamily(doc, { rootId: "ahmed" });
    const ids = pathEdgeIds(layout.edges, layout.nodes, doc, ["ali", "ahmed", "omar"]);
    expect([...ids].toSorted()).toEqual(["child:u1:ali", "child:u1:omar"]);
  });

  test("a spouse link keeps the union line", () => {
    const doc = cardFamily();
    const layout = layoutFamily(doc, { rootId: "ahmed" });
    const ids = pathEdgeIds(layout.edges, layout.nodes, doc, ["ahmed", "sara"]);
    expect([...ids]).toEqual(["union:u1"]);
  });

  test("an empty or one-person path keeps nothing", () => {
    const doc = cardFamily();
    const layout = layoutFamily(doc, { rootId: "ahmed" });
    expect(pathEdgeIds(layout.edges, layout.nodes, doc, []).size).toBe(0);
    expect(pathEdgeIds(layout.edges, layout.nodes, doc, ["ali"]).size).toBe(0);
  });
});

describe("mirrorFrame", () => {
  test("flips x around 0 so the tree reads right to left", () => {
    const layout = layoutFamily(cardFamily(), { rootId: "ahmed" });
    const frame = settledFrame(layout);
    const mirrored = mirrorFrame(frame);
    const before = frame.nodes.find((n) => n.nodeId === "ali")!;
    const after = mirrored.nodes.find((n) => n.nodeId === "ali")!;
    expect(after.x).toBe(-(before.x + CARD_W));
    expect(after.y).toBe(before.y);
    expect(mirrored.edges[0]!.points[0]).toEqual([
      -frame.edges[0]!.points[0]![0],
      frame.edges[0]!.points[0]![1],
    ]);
  });
});
