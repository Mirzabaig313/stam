/**
 * The service worker's logic, without the worker global, so tests can run it on fake caches:
 * - install precaches the app shell (`/app` and every hashed file it loads) in a cache named
 *   after the build's version;
 * - activate deletes the caches of older versions;
 * - `/app` pages come from the network first and, offline, from the cached shell;
 * - shell files come from the cache first;
 * - nothing else is touched (`handle` returns null and the browser fetches as usual).
 */

/** The message a page sends a waiting worker to make it take over now. */
export const SKIP_WAITING_TYPE = "SKIP_WAITING";

export const CACHE_PREFIX = "stam-shell-";
/** The editor's page, cached under its route: it serves every `/app/...` page offline. */
export const SHELL_URL = "/app";

export type ShellWorkerOptions = {
  version: string;
  /** Paths to precache: `SHELL_URL` and the files it loads. */
  files: readonly string[];
  caches: CacheStorage;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** The site's origin; requests to any other are left alone. */
  origin: string;
};

const isAppPage = (path: string) => path === SHELL_URL || path.startsWith(`${SHELL_URL}/`);

export function createShellWorker({ version, files, caches, fetch, origin }: ShellWorkerOptions) {
  const cacheName = `${CACHE_PREFIX}${version}`;
  const assets = new Set(files.filter((f) => f !== SHELL_URL));

  async function cached(path: string): Promise<Response | undefined> {
    return (await caches.open(cacheName)).match(path);
  }

  async function networkFirst(request: Request): Promise<Response> {
    try {
      return await fetch(request);
    } catch (error) {
      const shell = await cached(SHELL_URL);
      if (shell) return shell;
      throw error;
    }
  }

  async function cacheFirst(request: Request, path: string): Promise<Response> {
    return (await cached(path)) ?? fetch(request);
  }

  return {
    cacheName,

    /** Precaches every file, or fails (and the new version never takes over). */
    async install(): Promise<void> {
      const cache = await caches.open(cacheName);
      await Promise.all(
        files.map(async (path) => {
          // Past the HTTP cache: a stale copy of the page would name another version's files.
          const response = await fetch(new URL(path, origin), { cache: "reload" });
          if (!response.ok) throw new Error(`Precache of ${path} failed: ${response.status}`);
          await cache.put(path, response);
        }),
      );
    },

    async activate(): Promise<void> {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName)
          .map((name) => caches.delete(name)),
      );
    },

    /** The response for a request, or null to leave it to the browser. */
    handle(request: Request): Promise<Response> | null {
      if (request.method !== "GET") return null;
      const url = new URL(request.url);
      if (url.origin !== origin) return null;
      if (request.mode === "navigate")
        return isAppPage(url.pathname) ? networkFirst(request) : null;
      return assets.has(url.pathname) ? cacheFirst(request, url.pathname) : null;
    },
  };
}
