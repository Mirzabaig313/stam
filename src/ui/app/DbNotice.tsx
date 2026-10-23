import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { APP_NAME } from "@/config";

/**
 * What the database said about other tabs (see `DbEvents`): `blocking` (our connection was closed
 * so another tab could upgrade), `blocked` (our upgrade waits for other tabs), `terminated` (the
 * browser closed the connection).
 */
export type DbNoticeKind = "blocking" | "blocked" | "terminated";

let current: DbNoticeKind | null = null;
const listeners = new Set<() => void>();

/** A closed connection is final; "blocked" only lasts until the open goes through. */
const FINAL: ReadonlySet<DbNoticeKind> = new Set(["blocking", "terminated"]);

export function showDbNotice(kind: DbNoticeKind): void {
  if (current !== null && FINAL.has(current)) return;
  current = kind;
  for (const listener of listeners) listener();
}

/** Clears a "blocked" notice once the database opened; for tests, clears any. */
export function resetDbNotice(): void {
  current = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const KEYS = {
  blocking: "banner.dbBlocking",
  blocked: "banner.dbBlocked",
  terminated: "banner.dbTerminated",
} as const;

export function DbNotice() {
  const { t } = useTranslation();
  const kind = useSyncExternalStore(subscribe, () => current);
  if (kind === null) return null;
  return (
    <div className="banner banner-warn">
      <p role="alert">{t(KEYS[kind], { app: APP_NAME })}</p>
      {FINAL.has(kind) && (
        <button type="button" className="button" onClick={() => window.location.reload()}>
          {t("banner.reload")}
        </button>
      )}
    </div>
  );
}
