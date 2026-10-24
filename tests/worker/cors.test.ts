import { expect, test } from "bun:test";

import { api, APP, describeWorker, http, signIn, url } from "./helpers";

// The app (Pages, SITE_ORIGIN) calls the API on workers.dev cross-site: only it gets CORS answers.

describeWorker("cross-site calls from the app", () => {
  test("a preflight from the app is answered; one from another site is refused", async () => {
    const ok = await http(url("/api/trees"), {
      method: "OPTIONS",
      headers: {
        origin: APP,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(APP);
    expect(ok.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(ok.headers.get("access-control-allow-methods")).toContain("PUT");
    const evil = await http(url("/api/trees"), {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("answers to the app carry its origin, errors and rate limits included", async () => {
    const session = await signIn("cora");
    const me = await api("/api/me", { session, headers: { origin: APP } });
    expect(me.status).toBe(200);
    expect(me.headers.get("access-control-allow-origin")).toBe(APP);
    const signedOut = await api("/api/me", { headers: { origin: APP } });
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("access-control-allow-origin")).toBe(APP);
    const other = await api("/api/me", { session, headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("state-changing calls from the app's site are accepted", async () => {
    const session = await signIn("cyd");
    const out = await api("/api/auth/signout", {
      method: "POST",
      session,
      headers: { origin: APP },
    });
    expect(out.status).toBe(204);
  });

  test("preflights never count against the rate limits", async () => {
    const ip = "10.250.250.250";
    const statuses = await Promise.all(
      Array.from({ length: 40 }, () =>
        http(url("/api/s/sometoken"), {
          method: "OPTIONS",
          headers: { origin: APP, "access-control-request-method": "GET", "x-stam-test-ip": ip },
        }).then((r) => r.status),
      ),
    );
    expect(statuses.every((s) => s === 204)).toBe(true);
  });

  test("every answer varies by Origin, also those without CORS", async () => {
    const plain = await http(url("/api/health"));
    expect(plain.headers.get("vary")).toContain("Origin");
  });

  test("the Worker serves only the API", async () => {
    for (const path of ["/", "/app", "/s/sometoken"]) {
      expect((await http(url(path))).status).toBe(404);
    }
  });
});
