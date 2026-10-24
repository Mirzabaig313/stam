import { expect, test } from "bun:test";

import { describeWorker, http, url } from "./helpers";

describeWorker("the Worker serves the site", () => {
  test("/app/t/abc serves the app with the CSP", async () => {
    const res = await http(url("/app/t/abc"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("ws://localhost:*"); // dev only: the local Worker sockets
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("/app and /s/token serve the app", async () => {
    for (const path of ["/app", "/s/sometoken"]) {
      const res = await http(url(path));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('id="root"');
    }
  });

  test("/ serves the prerendered landing page", async () => {
    const res = await http(url("/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1");
  });

  test("an unknown page gets the 404 page", async () => {
    const res = await http(url("/no-such-page"));
    expect(res.status).toBe(404);
  });

  test("/api/health is ok", async () => {
    const res = await http(url("/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("an unknown /api route is a JSON 404", async () => {
    const res = await http(url("/api/nope"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });
});
