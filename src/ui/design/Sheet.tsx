import { type PointerEvent, type ReactNode, useId, useRef, useState } from "react";

import { cx } from "./cx";
import { IconButton } from "./IconButton";

/** How far (px) the handle must travel before a press counts as a drag. */
const DRAG_PX = 24;

export type SheetProps = {
  /** The sheet's heading: in the display voice (a person's name, a tool's name). */
  title: ReactNode;
  children: ReactNode;
  /** Shows a close button in the header, named `closeLabel`. */
  onClose?: () => void;
  closeLabel?: string;
  /** Actions pinned under the scrolling body. */
  footer?: ReactNode;
  /** Something before the title in the header, such as an Avatar. */
  leading?: ReactNode;
  /** Lines under the title, inside the header (a lifespan, a few chips). */
  subtitle?: ReactNode;
  /** Extra header controls, before the close button. */
  headerActions?: ReactNode;
  /** Names the landmark when the title alone would not say what the sheet is. */
  label?: string;
  /**
   * Bottom sheets only: the grabber becomes a handle. A tap or a drag up expands the sheet to
   * nearly the full height, a drag down collapses it, and a drag down from collapsed closes it.
   */
  expandable?: boolean;
  expandLabel?: string;
  collapseLabel?: string;
  className?: string;
  /** For the side panel's id hooks (aria-controls, tests). */
  id?: string;
};

/**
 * A non-modal panel beside the canvas (a side sheet at the inline end), which becomes a bottom
 * sheet under 768 px, at most half the screen so the selection stays visible above it. A
 * `complementary` landmark named by its title (or `label`).
 */
export function Sheet({
  title,
  children,
  onClose,
  closeLabel,
  footer,
  leading,
  subtitle,
  headerActions,
  label,
  expandable = false,
  expandLabel,
  collapseLabel,
  className,
  id,
}: SheetProps) {
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const press = useRef<{ y: number; dragged: boolean } | null>(null);
  /** A drag ends in a click on the handle: that click must not toggle again. */
  const swallowClick = useRef(false);

  const heading = (
    <h2 id={titleId} className="display display--md sheet__title">
      {title}
    </h2>
  );

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    press.current = { y: event.clientY, dragged: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (p && Math.abs(event.clientY - p.y) >= DRAG_PX) p.dragged = true;
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const dy = event.clientY - p.y;
    if (!p.dragged && Math.abs(dy) < DRAG_PX) return; // a tap: the click toggles
    swallowClick.current = true;
    if (dy < 0) setExpanded(true);
    else if (expanded) setExpanded(false);
    else onClose?.();
  }

  return (
    <aside
      id={id}
      className={cx("sheet", expanded && "sheet--expanded", className)}
      aria-labelledby={label ? undefined : titleId}
      aria-label={label}
    >
      {expandable ? (
        <button
          type="button"
          className="sheet__grabber sheet__grabber--handle"
          aria-label={expanded ? collapseLabel : expandLabel}
          aria-expanded={expanded}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (press.current = null)}
          onClick={() => {
            if (swallowClick.current) swallowClick.current = false;
            else setExpanded((e) => !e);
          }}
        />
      ) : (
        <div className="sheet__grabber" aria-hidden="true" />
      )}
      <div className="sheet__header">
        {leading}
        {subtitle ? (
          <div className="sheet__heading">
            {heading}
            {subtitle}
          </div>
        ) : (
          heading
        )}
        <div className="sheet__header-actions">
          {headerActions}
          {onClose && <IconButton icon="close" label={closeLabel ?? ""} onClick={onClose} />}
        </div>
      </div>
      <div className="sheet__body">{children}</div>
      {footer && <div className="sheet__footer">{footer}</div>}
    </aside>
  );
}
