import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Autosaver, AutosaveStatus } from "@/storage/autosave";

/**
 * "Saving…" from the first unsaved change until the save resolves, then "Saved"; "Couldn't save"
 * on failure. Before any edit there is nothing to say.
 */
export function SaveStatus({ autosaver }: { autosaver: Autosaver }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AutosaveStatus>("idle");

  useEffect(() => autosaver.onStatus(setStatus), [autosaver]);

  const className = `save-status save-status-${status}`;
  if (status === "idle") return <span className={className} />;
  const key = status;
  // "Saving…" and "Saved" come and go with every edit; announcing them would be noise. Only a
  // failure is worth interrupting for.
  if (status === "error") return <output className={className}>{t(`saveStatus.${key}`)}</output>;
  return <span className={className}>{t(`saveStatus.${key}`)}</span>;
}
