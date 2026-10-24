import { describe } from "bun:test";

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
  if (init.body !== undefined) headers.set("content-type", "application/json");
  // `session` is ours (the cookie); Bun's fetch has an option of that name, so it is not passed on.
  if (session) headers.set("cookie", session);
  return http(url(path), { ...init, headers, redirect: "manual" });
}
