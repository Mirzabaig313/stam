// The service worker, built by scripts/build.ts to /sw.js. The build defines the two constants
// below: the app shell's files and a version taken from their contents (scripts/precache.ts).
import { createShellWorker, SKIP_WAITING_TYPE } from "@/offline/shellWorker";

declare const STAM_PRECACHE: string[];
declare const STAM_VERSION: string;

/** The parts of the worker global used here (the DOM lib has no ServiceWorkerGlobalScope). */
type WorkerEvent = Event & { waitUntil(p: Promise<unknown>): void };
type FetchEvent = WorkerEvent & { request: Request; respondWith(r: Promise<Response>): void };
type MessageEvt = Event & { data: unknown };
type WorkerScope = {
  location: Location;
  caches: CacheStorage;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", fn: (e: WorkerEvent) => void): void;
  addEventListener(type: "fetch", fn: (e: FetchEvent) => void): void;
  addEventListener(type: "message", fn: (e: MessageEvt) => void): void;
};

const scope = globalThis as unknown as WorkerScope;

const worker = createShellWorker({
  version: STAM_VERSION,
  files: STAM_PRECACHE,
  caches: scope.caches,
  fetch: (input, init) => fetch(input, init),
  origin: scope.location.origin,
});

// A new version waits for the page's "Reload" (see register.ts) instead of taking over mid-edit.
scope.addEventListener("install", (event) => event.waitUntil(worker.install()));

scope.addEventListener("activate", (event) =>
  event.waitUntil(worker.activate().then(() => scope.clients.claim())),
);

scope.addEventListener("fetch", (event) => {
  const response = worker.handle(event.request);
  if (response) event.respondWith(response);
});

scope.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === SKIP_WAITING_TYPE) void scope.skipWaiting();
});
