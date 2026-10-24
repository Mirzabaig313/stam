import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { api } from "@/cloud/api";
import { authStore } from "@/cloud/auth";
import { Chip } from "@/ui/design";
import { useEditor } from "@/ui/store/useEditor";

/**
 * For a cloud tree: the role a link gives ("Can view") and the connection ("Live", "Offline, 2
 * changes waiting"). Nothing for a local tree.
 */
export function CloudStatus() {
  const { t } = useTranslation();
  const cloud = useEditor((s) => s.cloud);
  if (!cloud) return null;
  const { role, status, pendingCount } = cloud;
  const label =
    status === "offline"
      ? pendingCount > 0
        ? t("cloud.offline", { count: pendingCount })
        : t("cloud.offlineNone")
      : status === "signedOut"
        ? t("cloud.signedOut")
        : status === "connecting"
          ? t("cloud.connecting")
          : status === "live"
            ? t("cloud.live")
            : null;
  return (
    <span className="cloud-status" data-status={status}>
      {role !== "owner" && <Chip>{t(`cloud.role.${role}`)}</Chip>}
      {label && (
        <span aria-live="polite">
          <span className="cloud-status__dot" aria-hidden="true" /> {label}
        </span>
      )}
    </span>
  );
}

/** What happened when the room ended this tree for this browser, or a session to renew. */
export function CloudNotice() {
  const { t } = useTranslation();
  const cloud = useEditor((s) => s.cloud);
  const error = useEditor((s) => s.error);
  const signedOut = useStore(authStore, (s) => s.status === "signedOut");
  if (!cloud) return null;
  if (cloud.closed !== null) {
    return (
      <p className="cloud-notice" role="alert">
        {cloud.closed === 4401 && cloud.role !== "owner"
          ? t("cloud.linkOff")
          : t("cloud.treeDeleted")}{" "}
        <a href="/app">{t("linkPage.back")}</a>
      </p>
    );
  }
  if (cloud.status === "signedOut" && signedOut) {
    return (
      <output className="cloud-notice">
        {t("cloud.signedOutNotice")}{" "}
        <a href={api.signInUrl(location.pathname)}>{t("cloud.signInAgain")}</a>
      </output>
    );
  }
  if (error === "DROPPED" && cloud.dropped.length > 0) {
    return (
      <output className="cloud-notice">
        {t("cloud.dropped", { count: cloud.dropped.length })}
      </output>
    );
  }
  if (error === "CONFLICT") {
    return <output className="cloud-notice">{t("cloud.conflict")}</output>;
  }
  return null;
}
