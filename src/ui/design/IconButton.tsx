import type { ComponentPropsWithRef } from "react";

import { Icon, type IconName } from "@/ui/app/Icon";

import { cx } from "./cx";

export type IconButtonProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  icon: IconName;
  /** What the button does. The accessible name always; the visible text when `showLabel`. */
  label: string;
  /** Show the label next to the icon: for actions people must find without hovering. */
  showLabel?: boolean;
  size?: "md" | "sm";
  /** A toggle: sets aria-pressed (undefined leaves it a plain button). */
  pressed?: boolean;
};

/**
 * A round icon button. Icon-only, it is named by `aria-label`; with `showLabel` the label is
 * visible text and names it. Renders the app's `.icon-button` class.
 */
export function IconButton({
  icon,
  label,
  showLabel = false,
  size = "md",
  pressed,
  type = "button",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "icon-button",
        showLabel && "icon-button--labelled",
        size === "sm" && "icon-button--sm",
        className,
      )}
      aria-label={showLabel ? undefined : label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} />
      {showLabel && <span className="icon-button__label">{label}</span>}
    </button>
  );
}
