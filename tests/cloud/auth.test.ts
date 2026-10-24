import { describe, expect, test } from "bun:test";

import { ApiError, createApi } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createSessionStore, SESSION_KEY } from "@/cloud/session";

import { famSimple } from "../fixtures/families";
import { fakeFetch, json } from "./fakeFetch";

const ME = { user: { id: "u1", name: "Alice", email: "a@x" }, trees: [] };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
    data,
  };
}

/** An api and an auth store sharing one session store, as the app's do. */
function setup(routes: Parameters<typeof fakeFetch>[0], initial: Record<string, string> = {}) {
  const storage = memoryStorage(initial);
  const session = createSessionStore(storage);
  const { fetch, calls } = fakeFetch(routes);
  const api = createApi(fetch, { session });
  return { storage, session, calls, api, auth: createAuthStore({ api, session }) };
}

describe("api", () => {
  test("errors carry the status and the server's code", async () => {
    const { fetch } = fakeFetch({ "POST /api/trees": () => json({ error: "TREE_ID_TAKEN" }, 409) });
    const err = await createApi(fetch)
      .uploadTree(famSimple())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "TREE_ID_TAKEN" });
  });

  test("getMe is null when signed out", async () => {
    const { fetch } = fakeFetch({ "GET /api/me": () => json({ error: "SIGNED_OUT" }, 401) });
    expect(await createApi(fetch).getMe()).toBeNull();
  });

  test("requests go to the API's origin and carry the session token", async () => {
    const session = createSessionStore(memoryStorage());
    session.set("tok123");
    const { fetch, calls } = fakeFetch({ "GET /api/me": () => json(ME) });
    const api = createApi(fetch, { base: "https://api.test", session });
    await api.getMe();
    expect(calls).toEqual([{ method: "GET", path: "/api/me", authorization: "Bearer tok123" }]);
    expect(api.signInUrl("/app/t/x?share=1")).toBe(
      "https://api.test/api/auth/google?return=%2Fapp%2Ft%2Fx%3Fshare%3D1",
    );
    expect(api.photoUrl("t1", "p1", "link tok")).toBe(
      "https://api.test/api/trees/t1/photos/p1?t=link%20tok",
    );
  });

  test("without a session, requests carry no token", async () => {
    const { fetch, calls } = fakeFetch({ "GET /api/s/tok": () => json({}) });
    await createApi(fetch, { session: createSessionStore(memoryStorage()) }).resolveLink("tok");
    expect(calls[0]!.authorization).toBeUndefined();
  });
});

describe("sign-in state", () => {
  test("a browser that never signed in asks the server nothing", async () => {
    const { auth, calls } = setup({ "GET /api/me": () => json(ME) });
    await auth.getState().refresh();
    expect(calls).toEqual([]);
    expect(auth.getState().status).toBe("signedOut");
  });

  test("with a session token, refresh asks who is signed in", async () => {
    const { auth, calls } = setup({ "GET /api/me": () => json(ME) }, { [SESSION_KEY]: "tok" });
    await auth.getState().refresh();
    expect(calls.map((c) => c.path)).toEqual(["/api/me"]);
    expect(auth.getState()).toMatchObject({ status: "signedIn", me: ME });
  });

  test("a token the server no longer knows is forgotten", async () => {
    const { auth, storage } = setup(
      { "GET /api/me": () => json({ error: "SIGNED_OUT" }, 401) },
      { [SESSION_KEY]: "old" },
    );
    await auth.getState().refresh();
    expect(auth.getState().status).toBe("signedOut");
    expect(storage.data[SESSION_KEY]).toBeUndefined();
  });

  test("the code sign-in brings back is taken out of the address", () => {
    const { auth } = setup({});
    expect(auth.getState().takeSignInCode("/app/t/x?share=1#stamSignIn=abc")).toEqual({
      code: "abc",
      path: "/app/t/x?share=1",
    });
    expect(auth.getState().takeSignInCode("/app#stamSignIn=abc&keep=1")).toEqual({
      code: "abc",
      path: "/app#keep=1",
    });
    expect(auth.getState().takeSignInCode("/app")).toBeNull();
  });

  test("finishing sign-in trades the code for the token and asks who is signed in", async () => {
    const { auth, calls, storage } = setup({
      "POST /api/auth/exchange": () => json({ token: "session-tok" }),
      "GET /api/me": () => json(ME),
    });
    await auth.getState().finishSignIn("one-time");
    expect(calls).toEqual([
      { method: "POST", path: "/api/auth/exchange", authorization: "Bearer one-time" },
      { method: "GET", path: "/api/me", authorization: "Bearer session-tok" },
    ]);
    expect(storage.data[SESSION_KEY]).toBe("session-tok");
    expect(auth.getState()).toMatchObject({ status: "signedIn", me: ME });
  });

  test("a used code (the returned page reloaded) keeps the session there was", async () => {
    const { auth, storage } = setup(
      {
        "POST /api/auth/exchange": () => json({ error: "BAD_SIGN_IN" }, 401),
        "GET /api/me": () => json(ME),
      },
      { [SESSION_KEY]: "kept" },
    );
    await auth.getState().finishSignIn("used");
    expect(storage.data[SESSION_KEY]).toBe("kept");
    expect(auth.getState().status).toBe("signedIn");
  });

  test("signing out tells the server with the token, then forgets it", async () => {
    const { auth, calls, storage } = setup(
      {
        "GET /api/me": () => json(ME),
        "POST /api/auth/signout": () => new Response(null, { status: 204 }),
      },
      { [SESSION_KEY]: "tok" },
    );
    await auth.getState().refresh();
    await auth.getState().signOut();
    expect(auth.getState()).toMatchObject({ status: "signedOut", me: null });
    expect(storage.data[SESSION_KEY]).toBeUndefined();
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/auth/signout",
      authorization: "Bearer tok",
    });
  });

  test("an API call that finds the session gone reports signed out and forgets it", async () => {
    const { auth, storage } = setup({ "GET /api/me": () => json(ME) }, { [SESSION_KEY]: "tok" });
    await auth.getState().refresh();
    auth.getState().sessionLost();
    expect(auth.getState().status).toBe("signedOut");
    expect(storage.data[SESSION_KEY]).toBeUndefined();
  });

  test("a browser that refuses storage keeps the session for this tab", () => {
    const session = createSessionStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    session.set("tab-only");
    expect(session.get()).toBe("tab-only");
  });
});
