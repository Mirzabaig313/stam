import { type ComponentPropsWithRef, type ReactNode, useId } from "react";

import { cx } from "./cx";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<ComponentPropsWithRef<"select">, "children"> & {
  label: ReactNode;
  options: readonly SelectOption[];
  hint?: ReactNode;
  wrapperClassName?: string;
};

/**
 * A labelled native select (phones get their own picker), styled like a text field with a drawn
 * chevron that sits at the inline end.
 */
export function Select({
  label,
  options,
  hint,
  wrapperClassName,
  id,
  className,
  ...rest
}: SelectProps) {
  const ownId = useId();
  const selectId = id ?? ownId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  return (
    <div className={cx("text-field", wrapperClassName)}>
      <label htmlFor={selectId} className="field-label">
        {label}
      </label>
      <span className="select">
        <select
          {...rest}
          id={selectId}
          className={cx("field", className)}
          aria-describedby={cx(rest["aria-describedby"], hintId) || undefined}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      {hint && (
        <p id={hintId} className="field-note">
          {hint}
        </p>
      )}
    </div>
  );
}
