import "./share.css";

import { useTranslation } from "react-i18next";

import { type Api, api as defaultApi } from "@/cloud/api";
import { Icon } from "@/ui/app/Icon";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

/**
 * Beside Share: a local tree's "Save to my account"; a tree in the account shows how it syncs
 * (Synced, Syncing, Offline with changes waiting, Signed out) and syncs now when pressed.
 */
export function SyncButton({
  onSaveToAccount,
  api = defaultApi,
}: {
  /** Absent where saving does not apply (a tree opened by someone else's link). */
  onSaveToAccount?: () => void;
  api?: Api;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const cloud = useEditor((s) => s.cloud);

  if (!cloud) {
    if (!onSaveToAccount) return null;
    return (
      <button
        type="button"
        className="icon-button sync-button"
        aria-label={t("sync.save")}
        title={t("sync.save")}
        onClick={onSaveToAccount}
      >
        <Icon name="cloud" />
      </button>
    );
  }
  if (cloud.closed !== null) return null;

  const { status, pendingCount } = cloud;
  const state =
    status === "signedOut"
      ? "signedOut"
      : status === "offline"
        ? "offline"
        : status === "connecting" || pendingCount > 0
          ? "syncing"
          : "synced";
  const label =
    state === "signedOut"
      ? t("sync.signedOut")
      : state === "offline"
        ? pendingCount > 0
          ? t("sync.offline", { count: pendingCount })
          : t("sync.offlineNone")
        : state === "syncing"
          ? t("sync.syncing")
          : t("sync.synced");

  return (
    <button
      type="button"
      className="icon-button sync-button"
      data-state={state}
      aria-label={label}
      title={state === "signedOut" ? label : `${label} · ${t("sync.now")}`}
      onClick={() => {
        if (state === "signedOut") location.assign(api.signInUrl(location.pathname));
        else store.getState().syncNow();
      }}
    >
      <Icon name="sync" />
      <span className="sync-button__dot" aria-hidden="true" />
    </button>
  );
}
