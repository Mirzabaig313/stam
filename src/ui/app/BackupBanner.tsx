import { useTranslation } from "react-i18next";

/** Nudges the user to download a backup after a week of edits (FR-X7). */
export function BackupBanner({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="banner">
      <output>{t("banner.backupDue")}</output>
      <button type="button" className="button" onClick={onDismiss}>
        {t("common.dismiss")}
      </button>
    </div>
  );
}
