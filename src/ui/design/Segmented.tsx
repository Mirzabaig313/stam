// A radio group of buttons: the roving tab stop is on the radios, so the group itself is not
// focusable, and native radio inputs cannot be drawn as segments with a focus ring of their own.
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/interactive-supports-focus */
import { type KeyboardEvent, type ReactNode, useRef } from "react";

import { Icon, type IconName } from "@/ui/app/Icon";

import { cx } from "./cx";

export type SegmentedOption<V extends string> = {
  value: V;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
};

export type SegmentedProps<V extends string> = {
  /** Names the group (aria-label); or pass `labelledBy`. */
  label?: string;
  labelledBy?: string;
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Stretch the segments across the container. */
  block?: boolean;
  className?: string;
};

/**
 * One choice out of a few, shown side by side: a radio group of buttons. One Tab stop (the chosen
 * segment); the arrow keys move and choose, toward the reading direction's end with → in LTR and
 * ← in RTL; Home and End jump to the ends.
 */
export function Segmented<V extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  block = false,
  className,
}: SegmentedProps<V>) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const current = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = group.current?.closest("[dir]")?.getAttribute("dir") === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    const index = enabled.findIndex((o) => o.value === current);
    let next: number | null = null;
    if (event.key === forward || event.key === "ArrowDown") next = (index + 1) % enabled.length;
    else if (event.key === back || event.key === "ArrowUp")
      next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    if (next === null || enabled.length === 0) return;
    event.preventDefault();
    const option = enabled[next]!;
    onChange(option.value);
    [...(group.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])]
      .find((el) => el.dataset.value === option.value)
      ?.focus();
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cx("segmented", block && "segmented--block", className)}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const checked = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            data-value={o.value}
            className="segmented__option"
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
