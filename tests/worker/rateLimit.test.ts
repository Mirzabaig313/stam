import { expect, test } from "bun:test";

import { describeWorker, freshIp, http, Socket, url } from "./helpers";

// Per-IP limits (wrangler.jsonc): share links 30 per minute, the rest of the API 120.

describeWorker("rate limits", () => {
  test("opening links: the 31st try in a minute from one address is refused", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await http(url(`/api/s/nosuchtoken${i}`), { headers: { "x-stam-test-ip": ip } });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    const last = await http(url("/api/s/nosuchtoken"), { headers: { "x-stam-test-ip": ip } });
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBe("60");
    expect(await last.json()).toEqual({ error: "RATE_LIMITED" });
    // Another address is not affected.
    const other = await http(url("/api/s/nosuchtoken"), {
      headers: { "x-stam-test-ip": freshIp() },
    });
    expect(other.status).toBe(404);
  });

  test("a link user's socket counts against the link limit", async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++)
      await http(url(`/api/s/nosuchtoken${i}`), { headers: { "x-stam-test-ip": ip } });
    const socket = new Socket(
      "/api/trees/tnosuchtree0000/ws?t=nosuchtoken",
      undefined,
      undefined,
      ip,
    );
    expect(await socket.opened).toBe(false);
  });

  test("the API allows 120 requests a minute from one address", async () => {
    const ip = freshIp();
    const statuses = await Promise.all(
      Array.from({ length: 121 }, () =>
        http(url("/api/me"), { headers: { "x-stam-test-ip": ip } }).then((r) => r.status),
      ),
    );
    expect(statuses.filter((s) => s === 401).length).toBe(120);
    expect(statuses.filter((s) => s === 429).length).toBe(1);
  });

  test("the health check is never limited", async () => {
    const ip = freshIp();
    const statuses = await Promise.all(
      Array.from({ length: 130 }, () =>
        http(url("/api/health"), { headers: { "x-stam-test-ip": ip } }).then((r) => r.status),
      ),
    );
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
