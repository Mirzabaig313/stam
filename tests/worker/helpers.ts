import { describe } from "bun:test";

import { WebSocket } from "ws";

import type { TreeDocument } from "@/core/model/types";

import { famSimple } from "../fixtures/families";

/** The local Worker (`wrangler dev`) that `bun run test:worker` starts; unset in plain `bun test`. */
export const WORKER_URL = process.env.WORKER_URL ?? "";

/** A describe block that runs only against a live local Worker. */
export const describeWorker = describe.skipIf(WORKER_URL === "");

export function url(path: string): string {
  return new URL(path, WORKER_URL).toString();
}

/** The Worker's own origin, as browsers send it on same-origin requests. */
export const ORIGIN = WORKER_URL.replace(/\/$/, "");

/** The app's site (`SITE_ORIGIN` in scripts/test-worker.ts): it calls the API cross-site. */
export const APP = "http://app.test";

/** A made-up client address: the local Worker rate-limits by it (`x-stam-test-ip`, dev only). */
export const freshIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join(".")}`;

/**
 * Bun's own fetch (the test preload replaces the global one with happy-dom's browser fetch). Each
 * request comes from its own address unless it names one, so only the rate-limit tests share one.
 */
export const http = ((input: string | URL | Request, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("x-stam-test-ip")) headers.set("x-stam-test-ip", freshIp());
  return Bun.fetch(input, { ...init, headers });
}) as typeof fetch;

/** Runs SQL on the test Worker's local D1 (the same files `wrangler dev` uses). */
export function d1(sql: string): unknown[] {
  const r = Bun.spawnSync(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "stam",
      "--local",
      "--json",
      "--persist-to",
      process.env.WORKER_STATE ?? "",
      "--command",
      sql,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (r.exitCode !== 0) throw new Error(`d1 failed: ${r.stderr.toString()}`);
  return (JSON.parse(r.stdout.toString()) as { results: unknown[] }[])[0]?.results ?? [];
}

/** The `name=value` part of a Set-Cookie for `name`, or undefined. */
export function cookie(res: Response, name: string): string | undefined {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.startsWith(`${name}=`));
}

/** A sign-in nonce as the app makes one (32 random bytes, base64url). */
export const freshNonce = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/** Starts Google sign-in; returns the redirect and the OAuth cookie. */
export async function startSignIn(returnTo = "/app", nonce: string | null = freshNonce()) {
  const query = `return=${encodeURIComponent(returnTo)}${nonce === null ? "" : `&nonce=${nonce}`}`;
  const res = await http(url(`/api/auth/google?${query}`), { redirect: "manual" });
  const location = new URL(res.headers.get("location") ?? "about:blank");
  return { res, location, oauth: cookie(res, "stam_oauth") ?? "" };
}

/** Finishes Google sign-in as `who`; returns the callback's answer and its one-time code. */
export async function finishSignIn(who = "alice", returnTo = "/app", nonce = freshNonce()) {
  const { location, oauth } = await startSignIn(returnTo, nonce);
  const state = location.searchParams.get("state");
  const res = await http(url(`/api/auth/google/callback?code=${who}&state=${state}`), {
    headers: { cookie: oauth },
    redirect: "manual",
  });
  const back = new URL(res.headers.get("location") ?? "about:blank");
  const code = new URLSearchParams(back.hash.slice(1)).get("stamSignIn") ?? "";
  return { res, back, code, nonce };
}

/** Trades a one-time sign-in code (with the nonce its sign-in started with) for a session token. */
export function exchange(code: string, nonce: string): Promise<Response> {
  return http(url("/api/auth/exchange"), {
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${code}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ nonce }),
  });
}

/** Signs in as `who` through the Google mock; returns the session token. */
export async function signIn(who = "alice"): Promise<string> {
  const { res, code, nonce } = await finishSignIn(who);
  const traded = await exchange(code, nonce);
  if (!traded.ok) throw new Error(`sign-in failed: ${res.status} ${traded.status}`);
  return ((await traded.json()) as { token: string }).token;
}

/** A same-origin JSON request, as the app sends it. */
export function api(
  path: string,
  { session, ...init }: RequestInit & { session?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  // `session` is ours (the token); Bun's fetch has an option of that name, so it is not passed on.
  if (session) headers.set("authorization", `Bearer ${session}`);
  return http(url(path), { ...init, headers, redirect: "manual" });
}

/** A tree to upload: a fixture family under a fresh id (the tests share one database). */
export function newTree(name = "Shared family"): TreeDocument {
  const doc = famSimple();
  return { ...doc, id: `t${crypto.randomUUID().replaceAll("-", "").slice(0, 15)}`, name };
}

/** Uploads a tree as `session`'s user; returns the tree. */
export async function upload(
  session: string,
  doc: TreeDocument = newTree(),
): Promise<TreeDocument> {
  const res = await api("/api/trees", { method: "POST", session, body: JSON.stringify({ doc }) });
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return doc;
}

/** Creates a view link; returns its id and token. */
export async function viewLink(session: string, treeId: string, hideLiving = false) {
  const res = await api(`/api/trees/${treeId}/links`, {
    method: "POST",
    session,
    body: JSON.stringify({ role: "view", hideLiving }),
  });
  if (res.status !== 201) throw new Error(`link failed: ${res.status} ${await res.text()}`);
  const link = (await res.json()) as { id: string; url: string };
  return { id: link.id, url: link.url, token: link.url.split("/s/")[1]! };
}

/** A test WebSocket client with a queue of received messages. */
export class Socket {
  ws: WebSocket;
  messages: Record<string, unknown>[] = [];
  closed: Promise<number>;
  opened: Promise<boolean>;
  #waiters: (() => void)[] = [];

  constructor(
    path: string,
    session?: string,
    socketOrigin: string = ORIGIN,
    ip: string = freshIp(),
  ) {
    // As the app does: the `stam` subprotocol, and the owner's token in a second one.
    const protocols = session ? ["stam", `stam-auth.${session}`] : ["stam"];
    this.ws = new WebSocket(url(path).replace(/^http/, "ws"), protocols, {
      // Browsers send the page's Origin on WebSocket upgrades; the server checks it.
      headers: { origin: socketOrigin, "x-stam-test-ip": ip },
    });
    this.opened = new Promise((resolve) => {
      this.ws.on("open", () => resolve(true));
      this.ws.on("unexpected-response", () => resolve(false));
      this.ws.on("error", () => resolve(false));
    });
    this.closed = new Promise((resolve) => this.ws.on("close", (code: number) => resolve(code)));
    this.ws.on("message", (data: Buffer) => {
      this.messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
      for (const w of this.#waiters.splice(0)) w();
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** The next message of this type (waits up to 5 s). */
  async next(type: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const i = this.messages.findIndex((m) => m.type === type);
      if (i >= 0) return this.messages.splice(i, 1)[0]!;
      if (Date.now() > deadline)
        throw new Error(`no ${type} message: ${JSON.stringify(this.messages)}`);
      await Promise.race([new Promise<void>((r) => this.#waiters.push(r)), Bun.sleep(100)]);
    }
  }

  close(): void {
    this.ws.close();
  }
}
