import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { animate, prefersReducedMotion, QUICK_MS } from "./motion";
import { type Viewport, zoomAt } from "./viewport";

type Point = [number, number];
type Size = { width: number; height: number };

/** Pointer travel below this is a click, not a pan (global drag threshold). */
export const DRAG_THRESHOLD = 5;
/** Zoom speed per wheel pixel, and the most one wheel event may count (a mouse notch). */
const ZOOM_PER_PX = 0.006;
const MAX_WHEEL_PX = 40;
const LINE_PX = 16;

export type WheelInput = Pick<
  WheelEvent,
  "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "metaKey" | "shiftKey"
>;

/**
 * A wheel event's effect: Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as
 * Ctrl + wheel) zooms around `anchor`; a plain wheel pans; Shift + vertical wheel pans sideways.
 */
export function wheelViewport(v: Viewport, e: WheelInput, anchor: Point): Viewport {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? 800 : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (e.ctrlKey || e.metaKey) {
    const px = Math.max(-MAX_WHEEL_PX, Math.min(MAX_WHEEL_PX, dy));
    return zoomAt(v, anchor, Math.exp(-px * ZOOM_PER_PX));
  }
  if (e.shiftKey && dx === 0) return { ...v, x: v.x - dy };
  return { ...v, x: v.x - dx, y: v.y - dy };
}

/** Two-finger move: zoom by the change in finger distance, pan with their midpoint. */
export function pinchViewport(v: Viewport, prev: [Point, Point], next: [Point, Point]): Viewport {
  const mid = ([a, b]: [Point, Point]): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dist = ([a, b]: [Point, Point]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const [px, py] = mid(prev);
  const [nx, ny] = mid(next);
  const before = dist(prev);
  const zoomed = zoomAt(v, [px, py], before > 0 ? dist(next) / before : 1);
  return { ...zoomed, x: zoomed.x + nx - px, y: zoomed.y + ny - py };
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export type PanZoomOptions = {
  /** True when a pointer-down on this element may start a pan (the empty background). */
  isBackground: (target: Element) => boolean;
  /** A press and release on the background that did not move past the drag threshold. */
  onBackgroundClick: () => void;
  /** A second finger came down: the gesture is a pinch now, so a card's press must stop. */
  onTouchTakeover?: () => void;
  /** A card is picked up (touch long-press): a finger that started on it moves the card. */
  isCardHeld?: () => boolean;
};

export type PanZoom = {
  viewport: Viewport;
  /** Canvas size on screen. */
  size: Size;
  /** The latest viewport, also between renders. */
  viewportRef: RefObject<Viewport>;
  /**
   * Jumps, or with `animated` glides over `duration` (250 ms by default) with the global easing;
   * instant under reduced motion.
   */
  setViewport: (v: Viewport, animated?: boolean, duration?: number) => void;
  /** Where the viewport is heading: the end of a running glide, else the current viewport. */
  goal: () => Viewport;
  /** True while two fingers pinch: a touch on a card then belongs to the pinch. */
  isPinching: () => boolean;
};

/**
 * `fromCard`: a one-finger touch that started on a card. It pans once it moves past the drag
 * threshold, and stops panning if the card's long-press picks the card up first.
 */
type Gesture =
  | { kind: "pan"; id: number; start: Point; moved: boolean; fromCard: boolean }
  | { kind: "pinch" }
  | null;

/**
 * Pan and zoom for the canvas. `containerRef` is measured and takes the wheel;
 * `surfaceRef` takes pointer gestures: drag on the background pans, two pointers pinch-zoom.
 */
export function usePanZoom(
  containerRef: RefObject<HTMLElement | null>,
  surfaceRef: RefObject<Element | null>,
  options: PanZoomOptions,
): PanZoom {
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const viewportRef = useRef(viewport);
  const cancelGlide = useRef<(() => void) | null>(null);
  const goalRef = useRef<Viewport | null>(null);
  const pinchingRef = useRef(false);
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const apply = useCallback((v: Viewport) => {
    viewportRef.current = v;
    setViewportState(v);
  }, []);

  const setViewport = useCallback(
    (target: Viewport, animated = false, duration = QUICK_MS) => {
      cancelGlide.current?.();
      cancelGlide.current = null;
      goalRef.current = null;
      if (!animated || prefersReducedMotion()) {
        apply(target);
        return;
      }
      // Linear in x, y and k keeps a fixed zoom anchor fixed all the way.
      const from = viewportRef.current;
      goalRef.current = target;
      cancelGlide.current = animate(duration, (p) => {
        if (p >= 1) goalRef.current = null;
        apply({
          x: lerp(from.x, target.x, p),
          y: lerp(from.y, target.y, p),
          k: lerp(from.k, target.k, p),
        });
      });
    },
    [apply],
  );
  const goal = useCallback(() => goalRef.current ?? viewportRef.current, []);
  const isPinching = useCallback(() => pinchingRef.current, []);

  // Size: measured before paint, then kept up to date.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    const surface = surfaceRef.current;
    if (!container || !surface) return;

    const local = (e: { clientX: number; clientY: number }): Point => {
      const box = container.getBoundingClientRect();
      return [e.clientX - box.left, e.clientY - box.top];
    };
    const move = (v: Viewport) => {
      cancelGlide.current?.();
      cancelGlide.current = null;
      goalRef.current = null;
      apply(v);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      move(wheelViewport(viewportRef.current, e, local(e)));
    };

    // Safari reports trackpad pinch as gesture events instead of Ctrl + wheel.
    let gestureScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      move(zoomAt(viewportRef.current, local(g), g.scale / gestureScale));
      gestureScale = g.scale;
    };

    const pointers = new Map<number, Point>();
    let gesture: Gesture = null;
    const pair = (): [Point, Point] => {
      const [a, b] = [...pointers.values()];
      return [a!, b!];
    };
    const capture = (id: number) => {
      try {
        surface.setPointerCapture(id);
      } catch {
        // The pointer is already gone; nothing to capture.
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (pointers.size === 0) {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        const onBackground = optionsRef.current.isBackground(target);
        // Mouse and pen presses on cards belong to them (select, drag and drop). A finger on a
        // card is tracked too: it may become a pan or the first finger of a pinch.
        if (!onBackground && e.pointerType !== "touch") return;
        pointers.set(e.pointerId, local(e));
        gesture = {
          kind: "pan",
          id: e.pointerId,
          start: local(e),
          moved: false,
          fromCard: !onBackground,
        };
        // Capturing a card's finger would send its tap's click to the canvas, not the card.
        if (onBackground) {
          capture(e.pointerId);
          container.dataset.panning = "true";
        }
      } else if (pointers.size === 1) {
        pointers.set(e.pointerId, local(e));
        gesture = { kind: "pinch" };
        pinchingRef.current = true;
        capture(e.pointerId);
        optionsRef.current.onTouchTakeover?.();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev || !gesture) return;
      if (gesture.kind === "pinch") {
        if (pointers.size < 2) return;
        const before = pair();
        pointers.set(e.pointerId, local(e));
        move(pinchViewport(viewportRef.current, before, pair()));
        return;
      }
      if (gesture.id !== e.pointerId) return;
      const now = local(e);
      const travel = Math.hypot(now[0] - gesture.start[0], now[1] - gesture.start[1]);
      if (gesture.fromCard) {
        // The card's long-press won: this finger now drags the card.
        if (optionsRef.current.isCardHeld?.()) return;
        // Still a tap or a long-press in the making: the canvas waits, then catches up.
        if (!gesture.moved && travel <= DRAG_THRESHOLD) return;
      }
      pointers.set(e.pointerId, now);
      if (travel > DRAG_THRESHOLD) gesture.moved = true;
      const v = viewportRef.current;
      move({ ...v, x: v.x + now[0] - prev[0], y: v.y + now[1] - prev[1] });
    };

    const end = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      const ended = gesture;
      if (pointers.size === 1 && ended?.kind === "pinch") {
        // One finger lifted: keep panning with the other, never as a click.
        const [id, at] = [...pointers][0]!;
        gesture = { kind: "pan", id, start: at, moved: true, fromCard: false };
        pinchingRef.current = false;
        return;
      }
      if (pointers.size > 0) return;
      gesture = null;
      pinchingRef.current = false;
      delete container.dataset.panning;
      // A tap on a card is the card's click, never a background click.
      if (e.type === "pointerup" && ended?.kind === "pan" && !ended.moved && !ended.fromCard) {
        optionsRef.current.onBackgroundClick();
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("gesturestart", onGestureStart);
    container.addEventListener("gesturechange", onGestureChange);
    surface.addEventListener("pointerdown", onPointerDown as EventListener);
    surface.addEventListener("pointermove", onPointerMove as EventListener);
    surface.addEventListener("pointerup", end as EventListener);
    surface.addEventListener("pointercancel", end as EventListener);
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("gesturestart", onGestureStart);
      container.removeEventListener("gesturechange", onGestureChange);
      surface.removeEventListener("pointerdown", onPointerDown as EventListener);
      surface.removeEventListener("pointermove", onPointerMove as EventListener);
      surface.removeEventListener("pointerup", end as EventListener);
      surface.removeEventListener("pointercancel", end as EventListener);
      cancelGlide.current?.();
    };
  }, [containerRef, surfaceRef, apply]);

  return { viewport, size, viewportRef, setViewport, goal, isPinching };
}
