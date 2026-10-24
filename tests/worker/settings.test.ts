import { expect, test } from "bun:test";

import { api, describeWorker, http, signIn, url } from "./helpers";

// A signed-in user's app settings, kept with the account so a new device starts with them.

const put = (session: string | undefined, body: unknown) =>
  api("/api/me/settings", { method: "PUT", session, body: JSON.stringify(body) });

describeWorker("settings in the account", () => {
  test("a new account has none; saved settings come back with /api/me", async () => {
    const session = await signIn("sofi");
    const before = (await (await api("/api/me", { session })).json()) as { settings: unknown };
    expect(before.settings).toBeNull();
    const settings = { language: "ur", theme: "dark", colorMode: "branch", treeDirection: "rtl" };
    expect((await put(session, { settings, savedAt: 1_700_000_000_000 })).status).toBe(204);
    const after = (await (await api("/api/me", { session })).json()) as { settings: unknown };
    expect(after.settings).toEqual({ settings, savedAt: 1_700_000_000_000 });
  });

  test("each account keeps its own", async () => {
    const a = await signIn("tala");
    const b = await signIn("umar");
    await put(a, { settings: { theme: "dark" }, savedAt: 1 });
    const other = (await (await api("/api/me", { session: b })).json()) as { settings: unknown };
    expect(other.settings).toBeNull();
  });

  test("refused: signed out, from another site, not an object, or over 2 KB", async () => {
    expect((await put(undefined, { settings: {}, savedAt: 1 })).status).toBe(401);
    const session = await signIn("vera");
    const evil = await http(url("/api/me/settings"), {
      method: "PUT",
      headers: {
        origin: "https://evil.example",
        authorization: `Bearer ${session}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ settings: {}, savedAt: 1 }),
    });
    expect(evil.status).toBe(403);
    expect((await put(session, { settings: [1, 2], savedAt: 1 })).status).toBe(400);
    expect((await put(session, { settings: { theme: "dark" } })).status).toBe(400);
    expect((await put(session, { settings: { big: "x".repeat(3000) }, savedAt: 1 })).status).toBe(
      413,
    );
  });
});
