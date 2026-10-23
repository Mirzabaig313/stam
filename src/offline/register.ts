import { SKIP_WAITING_TYPE } from "./shellWorker";

export type RegisterOptions = {
  container: ServiceWorkerContainer;
  /**
   * A new version is installed and waiting (`apply` activates it and reloads the page), or another
   * tab already activated it (`apply` reloads).
   */
  onUpdate: (apply: () => void) => void;
  reload: () => void;
};

/**
 * Registers the service worker for `/app` and reports new versions. The first install is not an
 * update (nothing controlled the page). A failure is ignored: the app works online without it.
 */
export async function registerShellWorker({
  container,
  onUpdate,
  reload,
}: RegisterOptions): Promise<void> {
  let applying = false;
  let controlled = container.controller !== null;
  // The first worker claims the page too: no reload, no offer. A change the user asked for here
  // reloads at once. A new version activated from another tab takes this page over as well, and
  // has deleted the old version's cache, so lazy chunks of this (old) page may no longer load:
  // offer the reload, but never reload by itself, mid-edit (the autosave journal is safe anyway).
  container.addEventListener("controllerchange", () => {
    const wasControlled = controlled;
    controlled = true;
    if (applying) reload();
    else if (wasControlled) onUpdate(reload);
  });

  const offer = (worker: ServiceWorker) =>
    onUpdate(() => {
      applying = true;
      // A ServiceWorker's postMessage takes no target origin: the worker is same-origin.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage({ type: SKIP_WAITING_TYPE });
    });

  let registration: ServiceWorkerRegistration;
  try {
    registration = await container.register("/sw.js", { scope: "/app" });
  } catch {
    return;
  }
  if (registration.waiting && container.controller) offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && container.controller) offer(worker);
    });
  });
}
