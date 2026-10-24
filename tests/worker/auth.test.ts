import { expect, test } from "bun:test";

import {
  api,
  APP,
  d1,
  describeWorker,
  exchange,
  finishSignIn,
  http,
  ORIGIN,
  signIn,
  startSignIn,
  url,
} from "./helpers";

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

  test("callback goes back to the app with a one-time code it trades for a session", async () => {
    const { res, back, code } = await finishSignIn("alice", "/app/t/abc");
    expect(res.status).toBe(302);
    expect(`${back.origin}${back.pathname}`).toBe(`${APP}/app/t/abc`);
    expect(code.length).toBeGreaterThanOrEqual(32);
    // No session cookie any more: the app keeps a token; the OAuth cookie is cleared.
    expect(res.headers.getSetCookie().some((c) => c.startsWith("stam_session"))).toBe(false);
    // PKCE: the token request carried the verifier for the challenge sent to Google.
    const sent = (await (await http(`${googleMock}/__last`)).json()) as Record<string, string>;
    expect(sent.client_secret).toBe("test-secret");
    // The code itself is not a session.
    expect((await api("/api/me", { session: code })).status).toBe(401);

    const traded = await exchange(code);
    expect(traded.status).toBe(200);
    const { token } = (await traded.json()) as { token: string };
    const me = await api("/api/me", { session: token });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { name: "Alice", email: "alice@example.com" },
      trees: [],
    });
    // Only the hash of the session token is stored.
    expect(JSON.stringify(d1("SELECT token_hash FROM session"))).not.toContain(token);
  });

  test("PKCE: the token request carries the verifier for the challenge", async () => {
    const { location, oauth } = await startSignIn();
    await http(
      url(`/api/auth/google/callback?code=pia&state=${location.searchParams.get("state")}`),
      { headers: { cookie: oauth }, redirect: "manual" },
    );
    const sent = (await (await http(`${googleMock}/__last`)).json()) as Record<string, string>;
    expect(s256(sent.code_verifier!)).toBe(location.searchParams.get("code_challenge")!);
  });

  test("a sign-in code works once, and only from the app", async () => {
    const { code } = await finishSignIn("otto");
    const evil = await http(url("/api/auth/exchange"), {
      method: "POST",
      headers: { origin: "https://evil.example", authorization: `Bearer ${code}` },
    });
    expect(evil.status).toBe(403);
    expect((await exchange(code)).status).toBe(200);
    const again = await exchange(code);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "BAD_SIGN_IN" });
    expect((await exchange("made-up-code")).status).toBe(401);
  });

  test("an expired sign-in code is refused", async () => {
    const { code } = await finishSignIn("una");
    d1(
      "UPDATE session SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM user WHERE google_sub = 'sub-una')",
    );
    expect((await exchange(code)).status).toBe(401);
  });

  test("callback with a wrong or missing state is refused", async () => {
    const { oauth } = await startSignIn();
    for (const query of ["code=alice&state=forged", "code=alice"]) {
      const res = await http(url(`/api/auth/google/callback?${query}`), {
        headers: { cookie: oauth },
        redirect: "manual",
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
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
    expect(res.headers.get("location")).toBeNull();
  });

  test("return only accepts paths on the app's site", async () => {
    for (const evil of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "/\t/evil.com",
      "/\n/evil.com",
    ]) {
      const { back } = await finishSignIn("alice", evil);
      expect(`${back.origin}${back.pathname}`).toBe(`${APP}/app`);
    }
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
    expect((await api("/api/me", { session })).status).toBe(401);
  });

  test("a state-changing request without the site's Origin is 403", async () => {
    const session = await signIn("erin");
    const res = await http(url("/api/auth/signout"), {
      method: "POST",
      headers: { authorization: `Bearer ${session}` },
    });
    expect(res.status).toBe(403);
    const other = await http(url("/api/auth/signout"), {
      method: "POST",
      headers: { authorization: `Bearer ${session}`, origin: "https://evil.com" },
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
