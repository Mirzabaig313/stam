import type { ReactNode } from "react";

import { Icon } from "@/ui/app/Icon";

import { cx } from "./cx";

export type ChipProps = {
  children: ReactNode;
  /** An album hue (0–5): the soft hue behind, a deep-hue dot in front (a branch or generation key). */
  hue?: number;
  /** A filter chip: a toggle button with aria-pressed. Leave both unset for a static tag. */
  selected?: boolean;
  onClick?: () => void;
  /** Adds a remove button, named by `removeLabel`. */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
};

/** A small rounded tag: a fact ("b. 1952"), a key, a filter. */
export function Chip({
  children,
  hue,
  selected,
  onClick,
  onRemove,
  removeLabel,
  className,
}: ChipProps) {
  const classes = cx("chip", className);
  const content = (
    <>
      {hue !== undefined && <span className="chip__dot" aria-hidden="true" />}
      <span className="chip__label">{children}</span>
    </>
  );
  if (onClick || selected !== undefined) {
    return (
      <button
        type="button"
        className={classes}
        data-hue={hue}
        aria-pressed={selected ?? false}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={classes} data-hue={hue}>
      {content}
      {onRemove && (
        <button type="button" className="chip__remove" aria-label={removeLabel} onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}
