import { memo, type PointerEvent, useMemo, useRef } from "react";

import { DEFAULT_METRICS } from "@/core/layout/constants";

import type { Rect, Viewport } from "./viewport";

export const MINIMAP_W = 160;
export const MINIMAP_H = 120;
/** A tree drawn with fewer cards fits on the screen: no minimap (on a phone, CSS hides it). */
export const MINIMAP_MIN_CARDS = 10;
const PAD = 8;
/** Smallest dot side in minimap px, so single cards stay visible on huge trees. */
const MIN_DOT = 1.5;

/** minimap = world * scale + (x, y): `bounds` fitted into the minimap with padding, centred. */
export function minimapTransform(
  bounds: Rect,
  size = { width: MINIMAP_W, height: MINIMAP_H },
): { scale: number; x: number; y: number } {
  const fitW = bounds.width > 0 ? (size.width - 2 * PAD) / bounds.width : 1;
  const fitH = bounds.height > 0 ? (size.height - 2 * PAD) / bounds.height : 1;
  const scale = Math.min(fitW, fitH);
  return {
    scale,
    x: (size.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (size.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

/** A card's spot; `width` and `height` when it was resized on its own. */
type Dot = { nodeId: string; x: number; y: number; width?: number; height?: number };

/** All nodes as one path of small squares: one element, however big the tree. */
const Dots = memo(function Dots({
  nodes,
  bounds,
  card,
}: {
  nodes: readonly Dot[];
  bounds: Rect;
  card: CardSize;
}) {
  const d = useMemo(() => {
    const m = minimapTransform(bounds);
    const r = (n: number) => Math.round(n * 10) / 10;
    return nodes
      .map((n) => {
        const w = Math.max(MIN_DOT, (n.width ?? card.width) * m.scale);
        const h = Math.max(MIN_DOT, (n.height ?? card.height) * m.scale);
        return `M${r(n.x * m.scale + m.x)} ${r(n.y * m.scale + m.y)}h${r(w)}v${r(h)}h${r(-w)}z`;
      })
      .join("");
  }, [nodes, bounds, card]);
  return <path className="stam-minimap__dots" d={d} />;
});

type CardSize = { width: number; height: number };
const DEFAULT_CARD: CardSize = { width: DEFAULT_METRICS.cardW, height: DEFAULT_METRICS.cardH };

export type MinimapProps = {
  /** The layout's card size; the default metrics when left out. */
  card?: CardSize;
  /** Node positions in the canvas's (display) world coordinates. */
  nodes: readonly Dot[];
  bounds: Rect;
  viewport: Viewport;
  /** Canvas size on screen. */
  screen: { width: number; height: number };
  /** Card top-left corners of the selected person, drawn in the accent colour. */
  selected?: readonly { x: number; y: number }[];
  /** Called with the world point to centre on, on click and while dragging. */
  onCenter: (worldPoint: [number, number]) => void;
};

/** An overview of the whole tree, bottom inline-end, with the visible area as a rectangle. */
export function Minimap({
  nodes,
  bounds,
  viewport,
  screen,
  selected,
  onCenter,
  card = DEFAULT_CARD,
}: MinimapProps) {
  const m = minimapTransform(bounds);
  const dragging = useRef<number | null>(null);

  const centreAt = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - box.left;
    const my = e.clientY - box.top;
    onCenter([(mx - m.x) / m.scale, (my - m.y) / m.scale]);
  };

  const view = {
    x: (-viewport.x / viewport.k) * m.scale + m.x,
    y: (-viewport.y / viewport.k) * m.scale + m.y,
    width: (screen.width / viewport.k) * m.scale,
    height: (screen.height / viewport.k) * m.scale,
  };

  return (
    <div className="stam-minimap" aria-hidden="true">
      <svg
        width={MINIMAP_W}
        height={MINIMAP_H}
        viewBox={`0 0 ${MINIMAP_W} ${MINIMAP_H}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          dragging.current = e.pointerId;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          centreAt(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current === e.pointerId) centreAt(e);
        }}
        onPointerUp={(e) => {
          if (dragging.current === e.pointerId) dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
      >
        <Dots nodes={nodes} bounds={bounds} card={card} />
        {selected?.map((s, i) => (
          <rect
            key={i}
            className="stam-minimap__selected"
            x={s.x * m.scale + m.x - 1}
            y={s.y * m.scale + m.y - 1}
            width={Math.max(MIN_DOT, card.width * m.scale) + 2}
            height={Math.max(MIN_DOT, card.height * m.scale) + 2}
          />
        ))}
        <rect className="stam-minimap__view" {...view} />
      </svg>
    </div>
  );
}
