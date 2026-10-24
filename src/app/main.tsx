// Fonts and styles first, so the first paint is already themed.
import "@fontsource-variable/archivo/wdth.css";
import "@/i18n/fonts.css";
import "@/ui/styles/app.css";

import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { authStore } from "@/cloud/auth";
import { i18n } from "@/i18n";
import { registerShellWorker } from "@/offline/register";
import { openStamDb } from "@/storage/db";
import { createTreeRepo, type TreeRepo } from "@/storage/treeRepo";
import { AppRoutes } from "@/ui/app/AppRoutes";
import { DbNotice, resetDbNotice, showDbNotice } from "@/ui/app/DbNotice";
import { RepoContext } from "@/ui/app/RepoContext";
import { offerUpdate, UpdateToast } from "@/ui/app/UpdateToast";
import { startMotion } from "@/ui/settings/motion";
import { startSettings } from "@/ui/settings/settings";

// The cached settings, at once: theme, colour mode, language and direction are right on the first
// paint (production builds also run src/app/boot.js before any of this loads).
const cachedReady = startSettings();
void startMotion();

const elem = document.getElementById("root")!;

// Bun only allows `import.meta.hot.data` to be accessed directly (never aliased or destructured).
// `import.meta.hot` is statically false in production builds, so the hot branches are stripped.
// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
const root: Root = import.meta.hot
  ? (import.meta.hot.data.root ??= createRoot(elem))
  : createRoot(elem);

async function createRepo(): Promise<TreeRepo> {
  const db = await openStamDb("stam", {
    onBlocked() {
      // Nothing else is on screen yet: say why the app is waiting.
      showDbNotice("blocked");
      root.render(
        <main className="page">
          <DbNotice />
        </main>,
      );
    },
    onBlocking: () => showDbNotice("blocking"),
    onTerminated: () => showDbNotice("terminated"),
  });
  resetDbNotice(); // a "blocked" notice is over once the database opened
  return createTreeRepo(db);
}

/** Opens the database once and shares the repo; undefined when the browser refuses storage. */
async function openRepo(): Promise<TreeRepo | undefined> {
  try {
    return import.meta.hot
      ? (import.meta.hot.data.repo ??= await createRepo())
      : await createRepo();
  } catch {
    return undefined;
  }
}

// Offline support (FR §8): production builds only, so the dev server's hot reload is never
// served from a cache. This entry is /app's alone, so the landing page never registers it.
if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  void registerShellWorker({
    container: navigator.serviceWorker,
    onUpdate: offerUpdate,
    reload: () => window.location.reload(),
  });
}

// Back from Google sign-in: note it (so the account is asked about from now on) and tidy the URL.
const returned = authStore
  .getState()
  .noteReturn(location.pathname + location.search + location.hash);
if (returned !== null) history.replaceState(history.state, "", returned);
// Only a browser that has signed in before asks the server anything (spec D14).
void authStore.getState().refresh();

const repo = await openRepo();
// What the repo holds wins over the cache (another device's cache, or a cleared one).
// Either way, the first render waits for the chosen language's strings (Urdu and Arabic load on demand).
await (repo ? Promise.all([startSettings(repo), startMotion(repo)]) : cachedReady);

root.render(
  <StrictMode>
    {repo ? (
      <RepoContext.Provider value={repo}>
        <DbNotice />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </RepoContext.Provider>
    ) : (
      <main className="page">
        <p role="alert">{i18n.t("app.storageUnavailable")}</p>
      </main>
    )}
    <UpdateToast />
  </StrictMode>,
);
