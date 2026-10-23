import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

/** Activates the waiting version and reloads (see `registerShellWorker`); null when none. */
let apply: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: (() => void) | null): void {
  apply = next;
  for (const listener of listeners) listener();
}

/** A new version of the app is installed and waiting: offer it. */
export function offerUpdate(applyUpdate: () => void): void {
  set(applyUpdate);
}

/** Hides the offer; for tests, and for "Dismiss". */
export function resetUpdate(): void {
  set(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** "New version available. Reload": a polite status, so an edit in progress is not cut off. */
export function UpdateToast() {
  const { t } = useTranslation();
  const current = useSyncExternalStore(subscribe, () => apply);
  if (current === null) return null;
  return (
    <output className="toast">
      <p>{t("app.updateAvailable")}</p>
      <button type="button" className="button button-primary" onClick={current}>
        {t("banner.reload")}
      </button>
      <button type="button" className="button button-quiet" onClick={resetUpdate}>
        {t("common.dismiss")}
      </button>
    </output>
  );
}
