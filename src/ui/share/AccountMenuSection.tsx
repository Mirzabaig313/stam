import "./share.css";

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useStore } from "zustand";

import { type Api, api as defaultApi } from "@/cloud/api";
import { authStore as defaultAuth } from "@/cloud/auth";
import { settingsSyncedAt } from "@/cloud/settingsSync";
import { MenuItem, MenuSeparator } from "@/ui/design/Menu";

/** The first letter of a name, for the account's disc. */
function initialOf(name: string): string {
  return [...name.trim()][0]?.toLocaleUpperCase() ?? "";
}

/** "3 min ago" style time for the settings-sync note. */
function ago(ms: number, lang: string): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return format.format(-hours, "hour");
  return format.format(-Math.round(hours / 24), "day");
}

/**
 * "My account" in the ⋯ menu: signed in, who (name and email), the trees in the account, a note
 * that settings follow the account, and Sign out; signed out, Sign in with Google. `onDone`
 * closes the menu. `part` draws only the header (who) or only the actions, for a menu that puts
 * the header at its top; without it both come together.
 */
export function AccountMenuSection({
  onDone,
  part,
  api = defaultApi,
  auth = defaultAuth,
}: {
  onDone: () => void;
  part?: "header" | "actions";
  api?: Api;
  auth?: typeof defaultAuth;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const status = useStore(auth, (s) => s.status);
  const me = useStore(auth, (s) => s.me);
  if (status === "unknown") return null;

  if (status !== "signedIn" || !me) {
    if (part === "header") return null;
    return (
      <>
        <MenuSeparator />
        <MenuItem
          icon="account"
          onClick={() => {
            onDone();
            location.assign(api.signInUrl(location.pathname));
          }}
        >
          {t("account.signIn")}
        </MenuItem>
      </>
    );
  }

  const synced = settingsSyncedAt();
  const header = (
    <div className="menu-account" role="none">
      <span className="menu-account__avatar" aria-hidden="true">
        {initialOf(me.user.name || me.user.email)}
      </span>
      <span className="menu-account__name">{me.user.name}</span>
      <span className="menu-account__email">{me.user.email}</span>
      <span className="menu-account__note">
        {synced
          ? t("account.settingsSynced", { when: ago(synced, i18n.language) })
          : t("account.settingsFollow")}
      </span>
    </div>
  );
  if (part === "header") return header;
  return (
    <>
      <MenuSeparator />
      {part !== "actions" && header}
      <MenuItem
        icon="cloud"
        onClick={() => {
          onDone();
          navigate("/app#in-your-account");
        }}
      >
        {t("account.trees")}
      </MenuItem>
      <MenuItem
        icon="signOut"
        onClick={() => {
          onDone();
          void auth.getState().signOut();
        }}
      >
        {t("account.signOut")}
      </MenuItem>
    </>
  );
}
