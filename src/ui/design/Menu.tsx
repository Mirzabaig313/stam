import type { ComponentPropsWithRef } from "react";

import { Icon, type IconName } from "@/ui/app/Icon";
import { PopupMenu } from "@/ui/dnd/PopupMenu";

import { cx } from "./cx";

/**
 * The menu: `PopupMenu` (src/ui/dnd/PopupMenu.tsx) under its design-system name. It opens at a
 * point, focuses the first item, moves with the arrow keys, Home and End, and closes on Esc, Tab
 * or a press outside.
 */
export const Menu = PopupMenu;

export type MenuItemProps = ComponentPropsWithRef<"button"> & {
  icon?: IconName;
  /** Destroys something: drawn in the danger colour, and best kept last after a separator. */
  danger?: boolean;
};

/** One action in a Menu (role="menuitem"). */
export function MenuItem({
  icon,
  danger = false,
  className,
  children,
  type = "button",
  ...rest
}: MenuItemProps) {
  return (
    <button
      type={type}
      role="menuitem"
      className={cx("menu-item", danger && "menu-item--danger", className)}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/** A divider between groups of items. */
export function MenuSeparator() {
  return <hr className="menu-separator" />;
}
