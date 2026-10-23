import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatFuzzyDate, type FuzzyDate, parseFuzzyDate } from "@/core/dates/fuzzy";

const QUALIFIER_PREFIX = { about: "abt ", before: "bef ", after: "aft " } as const;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The text `parseFuzzyDate` reads back to the same date: "1950-03-14", "abt 1950", "1948–1952".
 * (`formatFuzzyDate` is for display: "14 Mar 1950" can't be parsed.)
 */
export function toInputText(date: FuzzyDate | undefined): string {
  if (!date || date.year === undefined) return "";
  if (date.qualifier === "between" && date.toYear !== undefined) {
    // The short "1948–1952" form needs a four-digit end year; the long form takes any.
    return date.toYear >= 100
      ? `${date.year}–${date.toYear}`
      : `bet ${date.year} and ${date.toYear}`;
  }
  let text = String(date.year);
  if (date.month !== undefined) {
    text += `-${pad(date.month)}`;
    if (date.day !== undefined) text += `-${pad(date.day)}`;
  }
  const { qualifier } = date;
  return (
    (qualifier === undefined || qualifier === "between" ? "" : QUALIFIER_PREFIX[qualifier]) + text
  );
}

type DateFieldProps = {
  label: string;
  value: FuzzyDate | undefined;
  /** Called with the new date, or undefined when the field was cleared. Never called for an invalid or unchanged date. */
  onCommit: (date: FuzzyDate | undefined) => void;
};

/**
 * A text field for a fuzzy date. It previews the parsed date as you type, flags text it can't
 * read, and commits on blur or Enter.
 */
export function DateField({ label, value, onCommit }: DateFieldProps) {
  // When the date changes from outside (undo), start over from the new value.
  return <DateInput key={toInputText(value)} label={label} value={value} onCommit={onCommit} />;
}

function DateInput({ label, value, onCommit }: DateFieldProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const noteId = useId();
  const stored = toInputText(value);
  const [text, setText] = useState(stored);

  const parsed = parseFuzzyDate(text);
  const invalid = !parsed.ok && parsed.error === "INVALID";

  function commit() {
    if (!parsed.ok) {
      if (parsed.error === "EMPTY" && stored !== "") onCommit(undefined);
      return;
    }
    if (toInputText(parsed.date) !== stored) onCommit(parsed.date);
  }

  return (
    <div className="panel-field">
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <input
        id={inputId}
        className="field"
        value={text}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={text.trim() === "" ? undefined : noteId}
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {text.trim() !== "" && (
        <p id={noteId} className={invalid ? "field-note field-error" : "field-note"}>
          {parsed.ok ? formatFuzzyDate(parsed.date) : t("panel.dateError")}
        </p>
      )}
    </div>
  );
}
