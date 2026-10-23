import "./dnd.css";

import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

type Point = [number, number];

/** Space kept between a popup and the window edge. */
const EDGE = 8;

const ITEM =
  '[role="menuitem"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled]),[role="menuitemradio"]:not([disabled])';

/**
 * Keeps a box opened at `at` (client px) inside the window. Pointer positions are physical, so
 * the box is placed with physical offsets; it opens toward the inline end (leftward in RTL) and
 * its content follows the page direction. `opens: "start"` turns it the other way, so a menu
 * anchored at a button's inline end lines up with that end.
 */
export function useAnchoredBox(at: Point, opens: "end" | "start" = "end", above = false) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    // It opens toward the inline end: right of the point in LTR, left of it in RTL.
    const rtl = box.closest("[dir]:not([dir=auto])")?.getAttribute("dir") === "rtl";
    const start = rtl === (opens === "end") ? at[0] - width : at[0];
    const x = Math.max(EDGE, Math.min(start, window.innerWidth - width - EDGE));
    // `above`: the box's bottom edge sits at the point (a menu opened from a bottom bar).
    const top = above ? at[1] - height : at[1];
    const y = Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE));
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
  });
  return { ref, style: { left: at[0], top: at[1] } };
}

/**
 * Closes on a press anywhere outside `ref`. A press on `toggle` (the button that opens the box)
 * is left to that button, whose click closes it: closing here too would reopen it on the click.
 */
export function useCloseOnOutsidePress(
  ref: { current: HTMLElement | null },
  onClose: () => void,
  toggle?: { current: HTMLElement | null },
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      if (event.target instanceof Node && toggle?.current?.contains(event.target)) return;
      closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [ref, toggle]);
}

/**
 * A small menu at a point: the first item takes the focus, arrow keys, Home and End move between
 * items, Esc or Tab closes, and a press outside closes. Focus goes back to whatever had it.
 */
export function PopupMenu({
  at,
  opens = "end",
  label,
  onClose,
  above = false,
  className,
  toggle,
  children,
}: {
  at: Point;
  /** Which way from `at` it opens along the line: toward the inline end (default) or start. */
  opens?: "end" | "start";
  label: string;
  onClose: () => void;
  /** Opens upward from `at` (its bottom edge at the point) instead of downward. */
  above?: boolean;
  /** Extra classes on the menu box. */
  className?: string;
  /** The button that opens and closes the menu: a press on it is left to its own click. */
  toggle?: { current: HTMLElement | null };
  children: ReactNode;
}) {
  const { ref, style } = useAnchoredBox(at, opens, above);
  useCloseOnOutsidePress(ref, onClose, toggle);

  useEffect(() => {
    const box = ref.current;
    const opener = document.activeElement as HTMLElement | SVGElement | null;
    box?.querySelector<HTMLElement>(ITEM)?.focus();
    return () => {
      // Only hand the focus back when it is still ours to give (not taken by a dialog).
      const active = document.activeElement;
      if (!active || active === document.body || box?.contains(active)) {
        opener?.focus?.();
      }
    };
  }, [ref]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Keys pressed in the menu belong to it, not to the editor's shortcuts.
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={className ? `dnd-menu ${className}` : "dnd-menu"}
      style={style}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
