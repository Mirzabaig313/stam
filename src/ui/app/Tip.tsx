import { type ReactNode, useId } from "react";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");

/** "⌘Z" / "⇧⌘Z" on Apple keyboards, "Ctrl+Z" / "Ctrl+Shift+Z" elsewhere. */
export function shortcutLabel(key: string, mods: { shift?: boolean } = {}, mac = IS_MAC): string {
  if (mac) return `${mods.shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${mods.shift ? "Shift+" : ""}${key}`;
}

/**
 * A short description under a control, shown on hover (after a short pause) and at once on
 * keyboard focus. The control gets `aria-describedby`, so screen readers read it too.
 * `children` receives the id to put on the control's `aria-describedby`.
 */
export function Tip({
  hint,
  shortcut,
  align = "center",
  children,
}: {
  hint: string;
  shortcut?: string;
  /** "end" keeps tips of controls near the window's inline end on screen. */
  align?: "center" | "end";
  children: (tipId: string) => ReactNode;
}) {
  const tipId = `tip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span className="tip-anchor">
      {children(tipId)}
      <span role="tooltip" id={tipId} className={`tip tip--${align}`}>
        <span className="tip__text">{hint}</span>
        {shortcut && <kbd className="tip__key">{shortcut}</kbd>}
      </span>
    </span>
  );
}
