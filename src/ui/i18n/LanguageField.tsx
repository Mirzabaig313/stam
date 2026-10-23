import { useId } from "react";
import { useTranslation } from "react-i18next";

import { isInReview, LANGUAGES } from "@/i18n";
import type { Language } from "@/ui/settings/settings";

/**
 * The interface language: each language named in its own script, and a note while the chosen
 * translation still waits for a native speaker's review. For the settings dialog.
 */
export function LanguageField({
  value,
  onChange,
}: {
  value: Language;
  onChange: (language: Language) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const noteId = `${id}-review`;
  const review = isInReview(value);
  return (
    <div className="language-field">
      <label htmlFor={id} className="field-label">
        {t("language.label")}
      </label>
      <select
        id={id}
        className="field"
        value={value}
        aria-describedby={review ? noteId : undefined}
        onChange={(event) => onChange(event.target.value as Language)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>
            {l.name}
          </option>
        ))}
      </select>
      {review && (
        <p id={noteId} className="muted language-review">
          {t("language.inReview")}
        </p>
      )}
    </div>
  );
}
