import { useId } from "react";

import { displayName } from "@/core/model/tree";
import type { Person } from "@/core/model/types";

/** The name to show for a person; unnamed people get the translated `unnamed` label. */
export function personLabel(person: Person, unnamed: string): string {
  return displayName(person) || unnamed;
}

type TextFieldProps = {
  label: string;
  /** What is stored; "" when absent. */
  value: string;
  /** Called with the trimmed text, only when it differs from `value`. */
  onCommit: (next: string) => void;
  multiline?: boolean;
  dir?: "auto" | "ltr" | "rtl";
};

/**
 * A text field that commits on blur (and, for a single line, Enter). Esc puts the stored text
 * back. A field whose text is unchanged commits nothing.
 */
export function TextField({ label, value, onCommit, multiline, dir }: TextFieldProps) {
  const id = useId();

  function commit(element: HTMLInputElement | HTMLTextAreaElement) {
    // Notes keep their inner line breaks; only the ends are trimmed.
    const next = element.value.trim();
    element.value = next;
    if (next !== value) onCommit(next);
  }

  const common = {
    id,
    className: "field",
    // Typing is uncontrolled; a new stored value (after a commit or an undo) remounts the field.
    defaultValue: value,
    dir,
    autoComplete: "off",
  } as const;

  return (
    <div className="panel-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {multiline ? (
        <textarea
          key={value}
          {...common}
          rows={4}
          onBlur={(event) => commit(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.value = value;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <input
          key={value}
          {...common}
          onBlur={(event) => commit(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = value;
              event.currentTarget.blur();
            }
          }}
        />
      )}
    </div>
  );
}
