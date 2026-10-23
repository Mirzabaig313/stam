import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { storagePressure } from "@/storage/persist";

/** More than this fraction of the quota in use triggers the warning (FR-S4). */
export const STORAGE_WARN_AT = 0.8;

export function StorageBanner() {
  const { t } = useTranslation();
  const [full, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void storagePressure().then((pressure) => {
      if (!cancelled) setFull(pressure > STORAGE_WARN_AT);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!full) return null;
  return (
    <div className="banner banner-warn">
      <output>{t("banner.storageFull")}</output>
    </div>
  );
}
