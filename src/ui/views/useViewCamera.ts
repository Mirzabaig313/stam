import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

import { usePanZoom } from "@/ui/canvas/usePanZoom";
import { centerOn, type Rect, type Viewport, zoomAt } from "@/ui/canvas/viewport";

type Size = { width: number; height: number };

/** Imperative controls shared by the fan chart and the timeline (toolbar zoom and fit). */
export type ViewHandle = {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /** Glides the person's segment or bar to the middle of the screen. */
  centerOnPerson(personId: string): void;
};

/** Zoom buttons step by this factor, as on the canvas. */
const ZOOM_STEP = 1.2;
/** A focused item closer than this to the screen edge is brought into the middle. */
const FOCUS_MARGIN = 24;

type Options = {
  containerRef: RefObject<HTMLElement | null>;
  svgRef: RefObject<SVGSVGElement | null>;
  /** The drawing's world extent. */
  bounds: Rect;
  /** The viewport that shows the drawing best on a screen of `size`. */
  fitView: (bounds: Rect, size: Size) => Viewport;
  /** A new key (another focus person, direction) fits the drawing again. */
  fitKey: string;
  onBackgroundClick: () => void;
};

/**
 * Pan and zoom for the read-only views, on the canvas's own gesture code (`usePanZoom`): drag the
 * background to pan, wheel and pinch to zoom. Fits once the view has a size and again when
 * `fitKey` changes.
 */
export function useViewCamera({
  containerRef,
  svgRef,
  bounds,
  fitView,
  fitKey,
  onBackgroundClick,
}: Options) {
  const clickRef = useRef(onBackgroundClick);
  useLayoutEffect(() => {
    clickRef.current = onBackgroundClick;
  });
  const { viewport, size, viewportRef, setViewport, goal } = usePanZoom(containerRef, svgRef, {
    isBackground: (el) => el.closest("[data-person-id]") === null,
    onBackgroundClick: () => clickRef.current(),
  });

  const fittedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    if (fittedFor.current === fitKey) return;
    const first = fittedFor.current === null;
    fittedFor.current = fitKey;
    setViewport(fitView(bounds, size), !first);
  }, [fitKey, size, bounds, fitView, setViewport]);

  const centre = (): [number, number] => [size.width / 2, size.height / 2];

  /** Glides the world point to the middle of the screen. */
  const centerOnPoint = useCallback(
    (p: [number, number]) => setViewport(centerOn(goal(), p, size), true),
    [goal, setViewport, size],
  );

  /** Keyboard focus on an item near the screen edge brings it into the middle. */
  const reveal = (rect: Rect) => {
    const v = viewportRef.current;
    const left = rect.x * v.k + v.x;
    const top = rect.y * v.k + v.y;
    const inside =
      left >= FOCUS_MARGIN &&
      top >= FOCUS_MARGIN &&
      left + rect.width * v.k <= size.width - FOCUS_MARGIN &&
      top + rect.height * v.k <= size.height - FOCUS_MARGIN;
    if (!inside) {
      setViewport(centerOn(v, [rect.x + rect.width / 2, rect.y + rect.height / 2], size), true);
    }
  };

  return {
    viewport,
    size,
    reveal,
    centerOnPoint,
    zoomIn: () => setViewport(zoomAt(goal(), centre(), ZOOM_STEP), true),
    zoomOut: () => setViewport(zoomAt(goal(), centre(), 1 / ZOOM_STEP), true),
    fit: () => setViewport(fitView(bounds, size), true),
  };
}

/** Moves the keyboard focus to the item with `data-key` inside `root`. */
export function focusItem(root: Element | null, key: string): void {
  const id = key.replace(/["\\]/g, "\\$&");
  root?.querySelector<SVGElement>(`[data-key="${id}"]`)?.focus();
}
