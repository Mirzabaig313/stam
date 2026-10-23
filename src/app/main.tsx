// Fonts and styles first, so the first paint is already themed.
import "@fontsource-variable/archivo/wdth.css";
import "@/ui/styles/app.css";

import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { i18n } from "@/i18n";
import { openStamDb } from "@/storage/db";
import { createTreeRepo, type TreeRepo } from "@/storage/treeRepo";
import { AppRoutes } from "@/ui/app/AppRoutes";
import { DbNotice, resetDbNotice, showDbNotice } from "@/ui/app/DbNotice";
import { RepoContext } from "@/ui/app/RepoContext";

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

const repo = await openRepo();

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
  </StrictMode>,
);
