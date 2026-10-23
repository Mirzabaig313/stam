import { describe, expect, mock, test } from "bun:test";

import { CACHE_PREFIX, createShellWorker, SHELL_URL } from "@/offline/shellWorker";

const ORIGIN = "https://stam.example";

const keyOf = (req: RequestInfo | URL) =>
  new URL(typeof req === "string" || req instanceof URL ? req : req.url, ORIGIN).pathname;

/** An in-memory CacheStorage keyed by path: just what the worker uses. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    let store = stores.get(name);
    if (!store) stores.set(name, (store = new Map()));
    const s = store;
    return {
      put: async (req: RequestInfo | URL, res: Response) => void s.set(keyOf(req), res),
      match: async (req: RequestInfo | URL) => s.get(keyOf(req))?.clone(),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  return { caches: caches as unknown as CacheStorage, stores };
}

const FILES = [SHELL_URL, "/chunk-abc.js", "/chunk-def.css", "/fonts/123.woff2"];

/** A network that answers each path with its name, or is offline. */
function network(opts: { offline?: boolean; failing?: string } = {}) {
  return mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (opts.offline) throw new TypeError("Failed to fetch");
    const path = new URL(input instanceof Request ? input.url : String(input), ORIGIN).pathname;
    if (path === opts.failing) return new Response("gone", { status: 404 });
    return new Response(`network ${path}`, { status: 200 });
  });
}

function setup(opts: { offline?: boolean; failing?: string } = {}) {
  const { caches, stores } = fakeCaches();
  const fetch = network(opts);
  const worker = createShellWorker({
    version: "v1",
    files: FILES,
    caches,
    fetch,
    origin: ORIGIN,
  });
  return { worker, caches, stores, fetch };
}

const get = (path: string, mode: RequestMode = "cors") => {
  const req = new Request(`${ORIGIN}${path}`);
  // `mode: "navigate"` cannot be set through the constructor.
  Object.defineProperty(req, "mode", { value: mode });
  return req;
};

describe("shell worker", () => {
  test("install precaches every shell file in a cache named after the version", async () => {
    const { worker, stores, fetch } = setup();
    await worker.install();
    expect(worker.cacheName).toBe(`${CACHE_PREFIX}v1`);
    expect([...stores.get(worker.cacheName)!.keys()].toSorted()).toEqual(FILES.toSorted());
    // Past the HTTP cache, so a new version never precaches an old file.
    const [, init] = fetch.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(init.cache).toBe("reload");
  });

  test("an install with a missing file fails, so a broken version never takes over", async () => {
    const { worker } = setup({ failing: "/chunk-abc.js" });
    await expect(worker.install()).rejects.toThrow();
  });

  test("activate deletes the caches of older versions and nothing else", async () => {
    const { worker, caches, stores } = setup();
    await caches.open(`${CACHE_PREFIX}old`);
    await caches.open("someone-elses-cache");
    await worker.install();
    await worker.activate();
    expect([...stores.keys()].toSorted()).toEqual(["someone-elses-cache", worker.cacheName]);
  });

  test("a hashed asset comes from the cache first", async () => {
    const { worker, fetch } = setup();
    await worker.install();
    fetch.mockClear();
    const res = await worker.handle(get("/chunk-abc.js"))!;
    expect(await res.text()).toBe("network /chunk-abc.js");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("an /app page comes from the network first, and from the cached shell offline", async () => {
    const online = setup();
    await online.worker.install();
    const fresh = await online.worker.handle(get("/app/t/xyz", "navigate"))!;
    expect(await fresh.text()).toBe("network /app/t/xyz");

    const offline = setup();
    await offline.worker.install();
    offline.fetch.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    for (const path of ["/app", "/app/t/xyz"]) {
      const res = await offline.worker.handle(get(path, "navigate"))!;
      expect(await res.text()).toBe(`network ${SHELL_URL}`);
    }
  });

  test("everything else is left to the browser: no caching of anything else", async () => {
    const { worker } = setup();
    await worker.install();
    expect(worker.handle(get("/", "navigate"))).toBeNull();
    expect(worker.handle(get("/privacy", "navigate"))).toBeNull();
    expect(worker.handle(get("/og.png"))).toBeNull();
    expect(worker.handle(new Request("https://elsewhere.example/chunk-abc.js"))).toBeNull();
    expect(worker.handle(new Request(`${ORIGIN}/chunk-abc.js`, { method: "POST" }))).toBeNull();
  });

  test("a hashed asset missing from the cache still loads from the network", async () => {
    const { worker } = setup();
    const res = await worker.handle(get("/chunk-abc.js"))!;
    expect(await res.text()).toBe("network /chunk-abc.js");
  });
});
