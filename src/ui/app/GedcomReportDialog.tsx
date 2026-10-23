import { Fragment, useId } from "react";
import { useTranslation } from "react-i18next";

import type { GedcomReport, GedcomWarning } from "@/io/gedcom";

import { Dialog } from "./Dialog";

/** More than this many skipped lines, or unknown-sex names, are summed up as "and N more". */
const MAX_LISTED = 200;
const MAX_NAMES = 20;

/** Names as a localised list ("A, B and C"), each isolated so a right-to-left name stays put. */
function NameList({ names, lang }: { names: string[]; lang: string }) {
  const { t } = useTranslation();
  const shown = names.slice(0, MAX_NAMES);
  const rest = names.length - shown.length;
  const items = rest > 0 ? [...shown, t("app.import.gedcom.more", { count: rest })] : shown;
  const parts = new Intl.ListFormat(lang, { type: "conjunction" }).formatToParts(items);
  let index = 0;
  return (
    <>
      {parts.map((part, i) =>
        part.type === "element" ? (
          <Fragment key={i}>
            {index++ < shown.length ? <bdi>{part.value}</bdi> : part.value}
          </Fragment>
        ) : (
          <Fragment key={i}>{part.value}</Fragment>
        ),
      )}
    </>
  );
}

function Warning({ warning, lang }: { warning: GedcomWarning; lang: string }) {
  const { t } = useTranslation();
  switch (warning.code) {
    case "UNKNOWN_SEX":
      return (
        <>
          {t("app.import.gedcom.warning.UNKNOWN_SEX", { count: warning.people.length })}{" "}
          <NameList names={warning.people} lang={lang} />
        </>
      );
    case "MALFORMED_LINES":
      return <>{t("app.import.gedcom.warning.MALFORMED_LINES", { count: warning.count })}</>;
    case "CHARSET":
      return <>{t("app.import.gedcom.warning.CHARSET", { charset: warning.charset })}</>;
    case "NO_HEADER":
      return <>{t("app.import.gedcom.warning.NO_HEADER")}</>;
    case "NOTES_CUT":
      return (
        <>
          {t("app.import.gedcom.warning.NOTES_CUT", {
            count: warning.people.length,
            limit: warning.limit,
          })}{" "}
          <NameList names={warning.people} lang={lang} />
        </>
      );
    case "NOTES_FULL":
      return (
        <>
          {t("app.import.gedcom.warning.NOTES_FULL", {
            count: warning.count,
            limit: warning.limit,
          })}
        </>
      );
  }
}

/** What a GEDCOM import brought in, what it guessed and what it left out (by line). */
export function GedcomReportDialog({
  report,
  onOpen,
  onClose,
}: {
  report: GedcomReport;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { skipped, warnings } = report;
  const listed = skipped.slice(0, MAX_LISTED);
  const notesCut = warnings.some((w) => w.code === "NOTES_CUT" || w.code === "NOTES_FULL");
  const summaryId = useId();
  return (
    <Dialog title={t("app.import.gedcom.title")} onClose={onClose} closeButton={false}>
      <div className="dialog-body import-report">
        <p>
          {t("app.import.gedcom.counts", {
            people: t("app.import.gedcom.people", { count: report.people }),
            families: t("app.import.gedcom.families", { count: report.families }),
          })}
        </p>
        {warnings.length > 0 && (
          <ul className="import-warnings">
            {warnings.map((warning, i) => (
              <li key={i}>
                <Warning warning={warning} lang={i18n.language} />
              </li>
            ))}
          </ul>
        )}
        {skipped.length === 0 ? (
          !notesCut && <p>{t("app.import.gedcom.allImported")}</p>
        ) : (
          <details className="import-skipped">
            <summary id={summaryId}>
              {t("app.import.gedcom.skipped", { count: skipped.length })}
            </summary>
            {/* It scrolls inside the dialog: focusable, so the keyboard can scroll it too (axe's
                scrollable-region-focusable, on phones). */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <ul tabIndex={0} aria-labelledby={summaryId}>
              {listed.map((s, i) => (
                <li key={i}>
                  {t(s.tag ? "app.import.gedcom.item" : "app.import.gedcom.itemNoTag", {
                    line: s.line,
                    tag: s.tag,
                    reason: t(`app.import.gedcom.reason.${s.reason}`),
                  })}
                </li>
              ))}
              {skipped.length > listed.length && (
                <li>{t("app.import.gedcom.more", { count: skipped.length - listed.length })}</li>
              )}
            </ul>
          </details>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          {t("app.import.gedcom.close")}
        </button>
        <button type="button" className="button button-primary" onClick={onOpen}>
          {t("app.import.gedcom.open")}
        </button>
      </div>
    </Dialog>
  );
}
