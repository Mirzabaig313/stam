import {
  currentSettings,
  normalizeSettings,
  onSettingsChosen,
  saveSettings,
  setCurrentSettings,
  type Settings,
  settingsSavedAt,
} from "@/ui/settings/settings";

import { type AccountSettings, type Api, api as defaultApi } from "./api";
import type { authStore as defaultAuth } from "./auth";

type Repo = Parameters<typeof saveSettings>[0] & Parameters<typeof settingsSavedAt>[0];

/**
 * Keeps a signed-in user's app settings with their account, so a new device or browser starts with
 * them. After sign-in the newer copy wins: the account's is applied here, or this device's is sent
 * up. Each change made here is sent up too. Signed out, nothing is sent (spec D14).
 */
export function startSettingsSync(deps: {
  repo: Repo;
  auth: typeof defaultAuth;
  api?: Api;
}): () => void {
  const api = deps.api ?? defaultApi;
  const { repo, auth } = deps;
  const send = (settings: Settings, savedAt: number) =>
    void api.saveSettings({ settings, savedAt }).catch(() => {});

  async function reconcile(account: AccountSettings | null | undefined) {
    const here = await settingsSavedAt(repo);
    if (account && account.savedAt > here) {
      const settings = normalizeSettings(account.settings);
      setCurrentSettings(settings);
      await saveSettings(repo, settings, { savedAt: account.savedAt }).catch(() => {});
    } else if (here > (account?.savedAt ?? 0)) {
      send(currentSettings(), here);
    }
  }

  let reconciledFor: string | null = null;
  const check = () => {
    const { status, me } = auth.getState();
    if (status !== "signedIn" || !me) {
      reconciledFor = null;
      return;
    }
    // Once per sign-in (refresh runs again later; the account copy is then ours anyway).
    if (reconciledFor === me.user.id) return;
    reconciledFor = me.user.id;
    void reconcile(me.settings);
  };
  check();
  const stopAuth = auth.subscribe(check);
  const stopChosen = onSettingsChosen((settings, savedAt) => {
    if (auth.getState().status === "signedIn") send(settings, savedAt);
  });
  return () => {
    stopAuth();
    stopChosen();
  };
}
