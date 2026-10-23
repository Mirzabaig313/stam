import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LayoutEdge, LayoutNode, LayoutResult } from "@/core/layout/types";

import { animate, prefersReducedMotion, REFLOW_MS } from "./motion";

export type FrameNode = LayoutNode & { opacity: number };
export type FrameEdge = LayoutEdge & { opacity: number };

/** What the canvas draws at one moment: node and edge positions plus fade-in opacity. */
export type Frame = { nodes: FrameNode[]; edges: FrameEdge[] };

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** The layout at rest. */
export function settledFrame(layout: LayoutResult): Frame {
  return {
    nodes: layout.nodes.map((n) => ({ ...n, opacity: 1 })),
    edges: layout.edges.map((e) => ({ ...e, opacity: 1 })),
  };
}

/**
 * The frame at eased progress `p` from `from` to `to`. Nodes and edges present in both move
 * from their old place; new ones fade in at their target; ones that left are dropped.
 */
export function tweenFrame(from: Frame, to: LayoutResult, p: number): Frame {
  const oldNodes = new Map(from.nodes.map((n) => [n.nodeId, n]));
  const oldEdges = new Map(from.edges.map((e) => [e.id, e]));
  return {
    nodes: to.nodes.map((n) => {
      const old = oldNodes.get(n.nodeId);
      if (!old) return { ...n, opacity: p };
      return {
        ...n,
        x: lerp(old.x, n.x, p),
        y: lerp(old.y, n.y, p),
        opacity: lerp(old.opacity, 1, p),
      };
    }),
    edges: to.edges.map((e) => {
      const old = oldEdges.get(e.id);
      if (!old) return { ...e, opacity: p };
      // A route that changed shape (line ↔ bracket) cannot be interpolated point by point.
      if (old.points.length !== e.points.length) return { ...e, opacity: p };
      const points = e.points.map(([x, y], i): [number, number] => {
        const [ox, oy] = old.points[i]!;
        return [lerp(ox, x, p), lerp(oy, y, p)];
      });
      return { ...e, points, opacity: lerp(old.opacity, 1, p) };
    }),
  };
}

/**
 * Animates between successive layouts over 450 ms with the global easing and returns the frame
 * to draw. A tween interrupted by a newer layout continues from wherever it was. The first
 * layout, and every layout under prefers-reduced-motion, shows at once.
 */
export function useLayoutTween(layout: LayoutResult): Frame {
  const settled = useMemo(() => settledFrame(layout), [layout]);
  const [tween, setTween] = useState<Frame | null>(null);
  const shown = tween ?? settled;
  const shownRef = useRef<Frame | null>(null);
  const previousLayout = useRef<LayoutResult | null>(null);

  useLayoutEffect(() => {
    // StrictMode runs mount effects twice; the same layout again is not a change.
    if (previousLayout.current === layout) return;
    const from = shownRef.current;
    const isFirst = previousLayout.current === null;
    previousLayout.current = layout;
    if (isFirst || from === null || prefersReducedMotion()) {
      setTween(null);
      return;
    }
    setTween(tweenFrame(from, layout, 0));
    let done = false;
    const cancel = animate(REFLOW_MS, (p) => {
      if (done) return;
      if (p >= 1) {
        done = true;
        setTween(null);
      } else {
        setTween(tweenFrame(from, layout, p));
      }
    });
    return () => {
      done = true;
      cancel();
    };
  }, [layout]);

  // Runs after the effect above, so a new layout's tween starts from the last frame drawn.
  useLayoutEffect(() => {
    shownRef.current = shown;
  });

  return shown;
}
