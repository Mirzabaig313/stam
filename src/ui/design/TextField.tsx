import { type ComponentPropsWithRef, type ReactNode, useId } from "react";

import { cx } from "./cx";

type Common = {
  label: ReactNode;
  /** Help under the field, linked by aria-describedby. */
  hint?: ReactNode;
  /** What is wrong and how to fix it; marks the field invalid. */
  error?: ReactNode;
  /** Classes for the wrapper (the input keeps `.field`). */
  wrapperClassName?: string;
};

export type TextFieldProps =
  | (Common & { multiline?: false } & ComponentPropsWithRef<"input">)
  | (Common & { multiline: true } & ComponentPropsWithRef<"textarea">);

/** A labelled text input (or textarea), with an optional hint and error under it. */
export function TextField(props: TextFieldProps) {
  const { label, hint, error, wrapperClassName, multiline, id, className, ...rest } = props;
  const ownId = useId();
  const fieldId = id ?? ownId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy =
    cx(rest["aria-describedby"] as string | undefined, hintId, errorId) || undefined;
  const shared = {
    id: fieldId,
    className: cx("field", className),
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : (rest["aria-invalid"] ?? undefined),
  };
  return (
    <div className={cx("text-field", wrapperClassName)}>
      <label htmlFor={fieldId} className="field-label">
        {label}
      </label>
      {multiline ? (
        <textarea {...(rest as ComponentPropsWithRef<"textarea">)} {...shared} />
      ) : (
        <input {...(rest as ComponentPropsWithRef<"input">)} {...shared} />
      )}
      {hint && (
        <p id={hintId} className="field-note">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
