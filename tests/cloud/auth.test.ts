import { describe, expect, test } from "bun:test";

import { ApiError, createApi } from "@/cloud/api";
import { createAuthStore, HAS_SIGNED_IN } from "@/cloud/auth";

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

  test("sign-in URL returns to the given path", () => {
    expect(createApi().signInUrl("/app/t/x?share=1")).toBe(
      "/api/auth/google?return=%2Fapp%2Ft%2Fx%3Fshare%3D1",
    );
  });
});

describe("sign-in state", () => {
  test("a browser that never signed in asks the server nothing", async () => {
    const { fetch, calls } = fakeFetch({ "GET /api/me": () => json(ME) });
    const auth = createAuthStore({ api: createApi(fetch), storage: memoryStorage() });
    await auth.getState().refresh();
    expect(calls).toEqual([]);
    expect(auth.getState().status).toBe("signedOut");
  });

  test("after a sign-in on this browser, refresh asks who is signed in", async () => {
    const { fetch, calls } = fakeFetch({ "GET /api/me": () => json(ME) });
    const auth = createAuthStore({
      api: createApi(fetch),
      storage: memoryStorage({ [HAS_SIGNED_IN]: "1" }),
    });
    await auth.getState().refresh();
    expect(calls.map((c) => c.path)).toEqual(["/api/me"]);
    expect(auth.getState()).toMatchObject({ status: "signedIn", me: ME });
  });

  test("a forced refresh asks even without the flag (Share and the account menu)", async () => {
    const { fetch, calls } = fakeFetch({ "GET /api/me": () => json({ error: "SIGNED_OUT" }, 401) });
    const auth = createAuthStore({ api: createApi(fetch), storage: memoryStorage() });
    await auth.getState().refresh({ force: true });
    expect(calls).toHaveLength(1);
    expect(auth.getState().status).toBe("signedOut");
  });

  test("returning from Google with signedIn=1 sets the flag and cleans the URL", () => {
    const storage = memoryStorage();
    const auth = createAuthStore({ api: createApi(fakeFetch().fetch), storage });
    expect(auth.getState().noteReturn("/app/t/x?signedIn=1&share=1")).toBe("/app/t/x?share=1");
    expect(storage.data[HAS_SIGNED_IN]).toBe("1");
    expect(auth.getState().noteReturn("/app")).toBeNull();
  });

  test("signing out clears the flag and the user", async () => {
    const storage = memoryStorage({ [HAS_SIGNED_IN]: "1" });
    const { fetch, calls } = fakeFetch({
      "GET /api/me": () => json(ME),
      "POST /api/auth/signout": () => new Response(null, { status: 204 }),
    });
    const auth = createAuthStore({ api: createApi(fetch), storage });
    await auth.getState().refresh();
    await auth.getState().signOut();
    expect(auth.getState()).toMatchObject({ status: "signedOut", me: null });
    expect(storage.data[HAS_SIGNED_IN]).toBeUndefined();
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/api/auth/signout" });
  });

  test("an API call that finds the session gone reports signed out", async () => {
    const { fetch } = fakeFetch({ "GET /api/me": () => json(ME) });
    const auth = createAuthStore({
      api: createApi(fetch),
      storage: memoryStorage({ [HAS_SIGNED_IN]: "1" }),
    });
    await auth.getState().refresh();
    auth.getState().sessionLost();
    expect(auth.getState().status).toBe("signedOut");
  });
});
