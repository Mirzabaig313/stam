import "./dnd.css";

import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

type Point = [number, number];

/** Space kept between a popup and the window edge. */
const EDGE = 8;

const ITEM = '[role="menuitem"]:not([disabled])';

/**
 * Keeps a box opened at `at` (client px) inside the window. Pointer positions are physical, so
 * the box is placed with physical offsets; its content still follows the page direction.
 */
export function useAnchoredBox(at: Point) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const x = Math.max(EDGE, Math.min(at[0], window.innerWidth - width - EDGE));
    const y = Math.max(EDGE, Math.min(at[1], window.innerHeight - height - EDGE));
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
  });
  return { ref, style: { left: at[0], top: at[1] } };
}

/** Closes on a press anywhere outside `ref`. */
export function useCloseOnOutsidePress(
  ref: { current: HTMLElement | null },
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [ref]);
}

/**
 * A small menu at a point: the first item takes the focus, arrow keys, Home and End move between
 * items, Esc or Tab closes, and a press outside closes. Focus goes back to whatever had it.
 */
export function PopupMenu({
  at,
  label,
  onClose,
  children,
}: {
  at: Point;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { ref, style } = useAnchoredBox(at);
  useCloseOnOutsidePress(ref, onClose);

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
      className="dnd-menu"
      style={style}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
