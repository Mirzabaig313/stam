import { expect, test } from "bun:test";

import { api, cookie, d1, describeWorker, http, ORIGIN, signIn, startSignIn, url } from "./helpers";

const googleMock = process.env.GOOGLE_MOCK_URL ?? "";

/** base64url(SHA-256(verifier)), the PKCE S256 challenge. */
function s256(verifier: string): string {
  return new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
}

describeWorker("Google sign-in and sessions", () => {
  test("sign-in redirects to Google with state and an S256 challenge", async () => {
    const { res, location, oauth } = await startSignIn("/app/t/abc");
    expect(res.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(`${googleMock}/auth`);
    const q = location.searchParams;
    expect(q.get("client_id")).toBe("test-client");
    expect(q.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("state")?.length).toBeGreaterThanOrEqual(32);
    expect(oauth).toStartWith("stam_oauth=");
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("stam_oauth="))!;
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Lax");
    expect(raw).toContain("Path=/");
  });

  test("callback with matching state creates the user and a session", async () => {
    const { location, oauth } = await startSignIn("/app/t/abc");
    const state = location.searchParams.get("state");
    const res = await http(url(`/api/auth/google/callback?code=alice&state=${state}`), {
      headers: { cookie: oauth },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/app/t/abc?signedIn=1");
    const session = cookie(res, "stam_session")!;
    expect(session).toBeDefined();
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("stam_session="))!;
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("Path=/");
    // PKCE: the token request carried the verifier for the challenge sent to Google.
    const sent = (await (await http(`${googleMock}/__last`)).json()) as Record<string, string>;
    expect(s256(sent.code_verifier!)).toBe(location.searchParams.get("code_challenge")!);
    expect(sent.client_secret).toBe("test-secret");
    const me = await api("/api/me", { session });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { name: "Alice", email: "alice@example.com" },
      trees: [],
    });
    // Only the hash of the session token is stored.
    const token = session.split("=")[1]!;
    expect(JSON.stringify(d1("SELECT token_hash FROM session"))).not.toContain(token);
  });

  test("callback with a wrong or missing state is refused and sets no session", async () => {
    const { oauth } = await startSignIn();
    for (const query of ["code=alice&state=forged", "code=alice"]) {
      const res = await http(url(`/api/auth/google/callback?${query}`), {
        headers: { cookie: oauth },
        redirect: "manual",
      });
      expect(res.status).toBe(400);
      expect(cookie(res, "stam_session")).toBeUndefined();
    }
    const { location } = await startSignIn();
    const noCookie = await http(
      url(`/api/auth/google/callback?code=alice&state=${location.searchParams.get("state")}`),
      { redirect: "manual" },
    );
    expect(noCookie.status).toBe(400);
  });

  test("a code Google refuses is refused", async () => {
    const { location, oauth } = await startSignIn();
    const res = await http(
      url(`/api/auth/google/callback?code=bad&state=${location.searchParams.get("state")}`),
      { headers: { cookie: oauth }, redirect: "manual" },
    );
    expect(res.status).toBe(502);
    expect(cookie(res, "stam_session")).toBeUndefined();
  });

  test("return only accepts same-origin paths", async () => {
    for (const evil of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "/\t/evil.com",
      "/\n/evil.com",
    ]) {
      const { location, oauth } = await startSignIn(evil);
      const res = await http(
        url(`/api/auth/google/callback?code=alice&state=${location.searchParams.get("state")}`),
        { headers: { cookie: oauth }, redirect: "manual" },
      );
      expect(res.headers.get("location")).toBe("/app?signedIn=1");
    }
  });

  test("/api/me renews the session cookie, so an active user stays signed in", async () => {
    const session = await signIn("greta");
    const res = await api("/api/me", { session });
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("stam_session="))!;
    expect(raw).toContain(`${session};`);
    expect(raw).toContain("Max-Age=2592000");
  });

  test("/api/me without a session is 401", async () => {
    const res = await api("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SIGNED_OUT" });
  });

  test("an expired session is 401", async () => {
    const session = await signIn("carol");
    d1(
      "UPDATE session SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM user WHERE google_sub = 'sub-carol')",
    );
    expect((await api("/api/me", { session })).status).toBe(401);
  });

  test("signout deletes the session", async () => {
    const session = await signIn("dave");
    const out = await api("/api/auth/signout", { method: "POST", session });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie().join()).toContain("stam_session=;");
    expect((await api("/api/me", { session })).status).toBe(401);
  });

  test("a state-changing request without the site's Origin is 403", async () => {
    const session = await signIn("erin");
    const res = await http(url("/api/auth/signout"), {
      method: "POST",
      headers: { cookie: session },
    });
    expect(res.status).toBe(403);
    const other = await http(url("/api/auth/signout"), {
      method: "POST",
      headers: { cookie: session, origin: "https://evil.com" },
    });
    expect(other.status).toBe(403);
    expect((await api("/api/me", { session })).status).toBe(200);
  });

  test("signing in again with the same Google account reuses the user", async () => {
    const first = (await (await api("/api/me", { session: await signIn("frank") })).json()) as {
      user: { id: string };
    };
    const second = (await (await api("/api/me", { session: await signIn("frank") })).json()) as {
      user: { id: string };
    };
    expect(second.user.id).toBe(first.user.id);
  });
});
