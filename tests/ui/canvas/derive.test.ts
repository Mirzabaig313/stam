import { describe, expect, test } from "bun:test";

import { CARD_W } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import { dimmedEdgeIds, focusSet, mirrorFrame } from "@/ui/canvas/derive";
import { settledFrame } from "@/ui/canvas/useLayoutTween";

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
