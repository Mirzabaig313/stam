import { afterEach, describe, expect, test } from "bun:test";

import { act, cleanup, renderHook } from "@testing-library/react";

import { DEFAULT_METRICS } from "@/core/layout/constants";
import type { LayoutEdge, LayoutNode, LayoutResult } from "@/core/layout/types";
import { ease } from "@/ui/canvas/motion";
import { settledFrame, tweenFrame, useLayoutTween } from "@/ui/canvas/useLayoutTween";

import { reduceMotion } from "../i18n";

afterEach(() => {
  cleanup();
  reduceMotion(false);
});

const node = (nodeId: string, x: number, y: number): LayoutNode => ({
  nodeId,
  personId: nodeId,
  kind: "blood",
  x,
  y,
  generation: y / 168,
  hiddenCount: 0,
});

const edge = (id: string, points: [number, number][]): LayoutEdge => ({
  id,
  kind: "union",
  unionId: id,
  status: "married",
  points,
});

function layoutOf(nodes: LayoutNode[], edges: LayoutEdge[] = []): LayoutResult {
  return {
    nodes,
    edges,
    bounds: { x: 0, y: 0, width: 1000, height: 500 },
    generationCount: 1,
    primaryNode: Object.fromEntries(nodes.map((n) => [n.personId, n.nodeId])),
    unreachable: [],
    metrics: DEFAULT_METRICS,
  };
}

describe("ease", () => {
  test("is the expo-out curve: starts fast, ends at 1", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.85);
    expect(ease(0.1)).toBeGreaterThan(0.25);
  });
});

describe("tweenFrame", () => {
  const before = layoutOf(
    [node("a", 0, 0), node("b", 200, 0)],
    [
      edge("e", [
        [180, 36],
        [200, 36],
      ]),
    ],
  );
  const after = layoutOf(
    [node("a", 100, 0), node("b", 400, 168), node("c", 600, 168)],
    [
      edge("e", [
        [280, 36],
        [400, 36],
      ]),
      edge("f", [
        [0, 0],
        [10, 0],
      ]),
    ],
  );
  const from = settledFrame(before);

  test("at progress 0 shows the old positions, at 1 the new ones", () => {
    const start = tweenFrame(from, after, 0);
    expect(start.nodes.map((n) => [n.nodeId, n.x, n.y, n.opacity])).toEqual([
      ["a", 0, 0, 1],
      ["b", 200, 0, 1],
      ["c", 600, 168, 0],
    ]);
    const end = tweenFrame(from, after, 1);
    expect(end.nodes.map((n) => [n.nodeId, n.x, n.y, n.opacity])).toEqual([
      ["a", 100, 0, 1],
      ["b", 400, 168, 1],
      ["c", 600, 168, 1],
    ]);
  });

  test("halfway interpolates kept nodes and edge points; new ones fade in at their target", () => {
    const mid = tweenFrame(from, after, 0.5);
    expect(mid.nodes.find((n) => n.nodeId === "b")).toMatchObject({ x: 300, y: 84, opacity: 1 });
    expect(mid.nodes.find((n) => n.nodeId === "c")).toMatchObject({ x: 600, y: 168, opacity: 0.5 });
    expect(mid.edges.find((e) => e.id === "e")!.points).toEqual([
      [230, 36],
      [300, 36],
    ]);
    expect(mid.edges.find((e) => e.id === "f")).toMatchObject({ opacity: 0.5 });
  });

  test("nodes that left the layout are dropped", () => {
    const shrunk = tweenFrame(from, layoutOf([node("a", 0, 0)]), 0.3);
    expect(shrunk.nodes.map((n) => n.nodeId)).toEqual(["a"]);
  });
});

describe("useLayoutTween", () => {
  test("first layout shows at once, and a settled layout keeps its identity", () => {
    const first = layoutOf([node("a", 0, 0)]);
    const { result, rerender } = renderHook(({ layout }) => useLayoutTween(layout), {
      initialProps: { layout: first },
    });
    const shown = result.current;
    expect(shown.nodes[0]).toMatchObject({ x: 0, opacity: 1 });
    rerender({ layout: first });
    expect(result.current).toBe(shown);
  });

  test("a new layout starts from the old positions and moves toward the new ones", async () => {
    reduceMotion(false);
    const { result, rerender } = renderHook(({ layout }) => useLayoutTween(layout), {
      initialProps: { layout: layoutOf([node("a", 0, 0)]) },
    });
    rerender({ layout: layoutOf([node("a", 1000, 0)]) });
    expect(result.current.nodes[0]!.x).toBe(0);
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    const x = result.current.nodes[0]!.x;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThanOrEqual(1000);
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(result.current.nodes[0]!.x).toBe(1000);
  });

  test("runs no tween under prefers-reduced-motion", () => {
    reduceMotion(true);
    const { result, rerender } = renderHook(({ layout }) => useLayoutTween(layout), {
      initialProps: { layout: layoutOf([node("a", 0, 0)]) },
    });
    rerender({ layout: layoutOf([node("a", 1000, 0), node("b", 0, 168)]) });
    expect(result.current.nodes.map((n) => [n.x, n.opacity])).toEqual([
      [1000, 1],
      [0, 1],
    ]);
  });
});
