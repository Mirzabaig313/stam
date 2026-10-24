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

/** Bun's own fetch: the test preload replaces the global one with happy-dom's browser fetch. */
export const http: typeof fetch = Bun.fetch;

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

/** Starts Google sign-in; returns the redirect and the OAuth cookie. */
export async function startSignIn(returnTo = "/app") {
  const res = await http(url(`/api/auth/google?return=${encodeURIComponent(returnTo)}`), {
    redirect: "manual",
  });
  const location = new URL(res.headers.get("location") ?? "about:blank");
  return { res, location, oauth: cookie(res, "stam_oauth") ?? "" };
}

/** Signs in as `who` through the Google mock; returns the session cookie (`stam_session=...`). */
export async function signIn(who = "alice"): Promise<string> {
  const { location, oauth } = await startSignIn();
  const state = location.searchParams.get("state");
  const res = await http(url(`/api/auth/google/callback?code=${who}&state=${state}`), {
    headers: { cookie: oauth },
    redirect: "manual",
  });
  const session = cookie(res, "stam_session");
  if (!session) throw new Error(`sign-in failed: ${res.status}`);
  return session;
}

/** A same-origin JSON request, as the app sends it. */
export function api(
  path: string,
  { session, ...init }: RequestInit & { session?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("origin", ORIGIN);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  // `session` is ours (the cookie); Bun's fetch has an option of that name, so it is not passed on.
  if (session) headers.set("cookie", session);
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

  constructor(path: string, session?: string) {
    this.ws = new WebSocket(url(path).replace(/^http/, "ws"), {
      headers: session ? { cookie: session } : {},
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
