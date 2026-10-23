import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import type { LayoutNode } from "@/core/layout/types";
import { animate, prefersReducedMotion, QUICK_MS } from "@/ui/canvas/motion";
import { DRAG_THRESHOLD } from "@/ui/canvas/usePanZoom";

import type { DropTarget } from "./resolveDrop";

type Point = [number, number];

/** A touch press held this long without moving picks the card up. */
export const LONG_PRESS_MS = 350;

const NONE: DropTarget = { kind: "none" };

/**
 * A card being dragged. `armed`: picked up by a long-press, not moved yet. `dragging`: following
 * the pointer. `returning`: gliding back to its place after a cancel or a refused drop.
 */
export type DragSession = {
  node: LayoutNode;
  phase: "armed" | "dragging" | "returning";
  /** The pointer, in client px. */
  pointer: Point;
  /** Pointer minus the card's top-left at pick-up, so the card stays where it was grabbed. */
  grab: Point;
  target: DropTarget;
};

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: never) => void;
};

export type UseDragOptions = {
  /** Client px to world (layout) coordinates; null when the canvas is gone. */
  toWorld: (client: Point) => Point | null;
  resolve: (personId: string, world: Point) => DropTarget;
  /** The card's top-left in client px, where a cancelled drag returns to. */
  homeOf: (node: LayoutNode) => Point | null;
  /** The card was released over `session.target`. Return false to send it back to its place. */
  onDrop: (session: DragSession) => boolean;
  /** A touch long-press released without moving: the card's context menu. */
  onLongPress: (node: LayoutNode, client: Point) => void;
  longPressMs?: number;
  /** For tests; defaults to the global timers. */
  timers?: Timers;
};

type Press = {
  pointerId: number;
  touch: boolean;
  node: LayoutNode;
  start: Point;
  grab: Point;
  /** Long-press timer while a touch press waits. */
  timer: unknown;
};

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const point = (e: PointerEvent): Point => [e.clientX, e.clientY];

function swallow(event: MouseEvent): void {
  event.stopPropagation();
  event.preventDefault();
}

/**
 * Swallows the click the browser sends right after a drag ends on a card. A drop away from any
 * card sends no click, so the trap is removed on the next turn. Returns the remover.
 */
function swallowNextClick(): () => void {
  const remove = () => {
    clearTimeout(timer);
    window.removeEventListener("click", swallow, { capture: true });
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  const timer = setTimeout(remove, 0);
  return remove;
}

/**
 * Pointer drag for cards. A mouse or pen drag starts after 5 px; a touch drag after a 350 ms
 * long-press (moving sooner is not a drag). Esc or a refused drop sends the card back with a
 * 250 ms glide (instant under reduced motion).
 */
export function useDrag(options: UseDragOptions) {
  const [session, setSession] = useState<DragSession | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const sessionRef = useRef<DragSession | null>(null);
  const pressRef = useRef<Press | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const clickTrapRef = useRef<(() => void) | null>(null);

  const show = (next: DragSession | null) => {
    sessionRef.current = next;
    setSession(next);
  };

  // Wrapped, not `{ setTimeout, clearTimeout }`: browsers throw "Illegal invocation" when the
  // global timers are called as methods of another object.
  const timers = (): Timers =>
    optionsRef.current.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    };

  /** Stops listening to the current press. */
  const release = () => {
    const press = pressRef.current;
    if (press?.timer !== undefined) timers().clearTimeout(press.timer as never);
    pressRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
  };

  /** Moves the card to `pointer` and asks what it is over. */
  const follow = (current: DragSession, pointer: Point, phase: DragSession["phase"]) => {
    const { toWorld, resolve } = optionsRef.current;
    const world = toWorld(pointer);
    const target = world ? resolve(current.node.personId, world) : NONE;
    show({ ...current, pointer, phase, target });
  };

  /** Sends the card back to its place, then clears it. */
  const sendBack = (current: DragSession) => {
    const home = optionsRef.current.homeOf(current.node);
    if (!home || prefersReducedMotion()) {
      show(null);
      return;
    }
    const from = current.pointer;
    const to: Point = [home[0] + current.grab[0], home[1] + current.grab[1]];
    const returning: DragSession = { ...current, phase: "returning", target: NONE };
    show(returning);
    let cancelled = false;
    const stop = animate(QUICK_MS, (p) => {
      if (cancelled) return;
      if (p >= 1) {
        cleanupRef.current = null;
        show(null);
        return;
      }
      const pointer: Point = [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p];
      show({ ...returning, pointer });
    });
    if (sessionRef.current === null) return; // finished at once (no animation frames)
    cleanupRef.current = () => {
      cancelled = true;
      stop();
    };
  };

  const begin = (press: Press, pointer: Point, phase: "armed" | "dragging") => {
    follow({ node: press.node, phase, pointer, grab: press.grab, target: NONE }, pointer, phase);
  };

  function start(node: LayoutNode, event: ReactPointerEvent<Element>) {
    const touch = event.pointerType === "touch";
    if (!touch && event.button !== 0) return;
    if (pressRef.current) return;
    // A new press takes over from a card still gliding home.
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (sessionRef.current) show(null);

    const pressedAt: Point = [event.clientX, event.clientY];
    const home = optionsRef.current.homeOf(node) ?? pressedAt;
    const press: Press = {
      pointerId: event.pointerId,
      touch,
      node,
      start: pressedAt,
      grab: [pressedAt[0] - home[0], pressedAt[1] - home[1]],
      timer: undefined,
    };
    pressRef.current = press;

    if (touch) {
      press.timer = timers().setTimeout(() => {
        press.timer = undefined;
        if (pressRef.current === press) begin(press, press.start, "armed");
      }, optionsRef.current.longPressMs ?? LONG_PRESS_MS);
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== press.pointerId) return;
      const at = point(e);
      const current = sessionRef.current;
      if (current) {
        const moved = current.phase === "dragging" || distance(at, press.start) > DRAG_THRESHOLD;
        follow(current, at, moved ? "dragging" : current.phase);
        return;
      }
      if (distance(at, press.start) <= DRAG_THRESHOLD) return;
      if (touch)
        release(); // moved before the long-press: not a drag
      else begin(press, at, "dragging");
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== press.pointerId) return;
      const current = sessionRef.current;
      release();
      if (!current) return;
      if (current.phase === "armed") {
        show(null);
        optionsRef.current.onLongPress(press.node, point(e));
        return;
      }
      clickTrapRef.current = swallowNextClick();
      const dropped = { ...current, pointer: point(e) };
      if (optionsRef.current.onDrop(dropped)) show(null);
      else sendBack(dropped);
    };

    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== press.pointerId) return;
      const current = sessionRef.current;
      release();
      if (current) sendBack(current);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const current = sessionRef.current;
      release();
      if (!current) return;
      e.preventDefault();
      e.stopPropagation();
      sendBack(current);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
    cleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey, true);
    };
  }

  // Unmounting mid-drag must not leave listeners, timers or a running glide behind.
  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });
  useEffect(
    () => () => {
      releaseRef.current();
      clickTrapRef.current?.();
    },
    [],
  );

  /** True while a press is held or a card is picked up (not while it glides home). */
  const isPressing = () => pressRef.current !== null;

  /** True while a card is picked up (armed by a long-press, or dragging). */
  const isHolding = () => {
    const phase = sessionRef.current?.phase;
    return phase === "armed" || phase === "dragging";
  };

  /**
   * Drops the current press (a pinch took over): a waiting long-press never fires, a card that was
   * picked up goes back to its place.
   */
  const cancel = () => {
    const current = sessionRef.current;
    if (!pressRef.current) return;
    release();
    if (current?.phase === "armed") show(null);
    else if (current) sendBack(current);
  };

  return { session, start, isPressing, isHolding, cancel };
}
