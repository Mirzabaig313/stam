import type { ComponentPropsWithRef } from "react";

import { Icon, type IconName } from "@/ui/app/Icon";

import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  /** primary: the one main action; secondary (default): the rest; quiet: low-key; danger: destroys. */
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** A leading icon, drawn before the text (the text is the label). */
  icon?: IconName;
  /** Danger only: filled, for the final "Delete" in a confirmation. */
  solid?: boolean;
  /** Full width of its container. */
  block?: boolean;
};

/**
 * A text button, pill-shaped. `type` defaults to "button", so a button in a form never submits it
 * by accident. Renders the app's long-standing `.button` classes (src/ui/design/design.css).
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  solid = false,
  block = false,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "button",
        variant !== "secondary" && `button-${variant}`,
        size === "sm" && "button-sm",
        solid && variant === "danger" && "button-solid",
        block && "button-block",
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
