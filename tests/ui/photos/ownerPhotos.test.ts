import { describe, expect, test } from "bun:test";

import { createApi } from "@/cloud/api";
import { createSessionStore } from "@/cloud/session";
import type { TreeRepo } from "@/storage/treeRepo";
import { fetchOwnerPhoto } from "@/ui/photos/ownerPhotos";

import { fakeFetch } from "../../cloud/fakeFetch";

function fakeRepo() {
  const stored = new Map<string, Blob>();
  return {
    stored,
    repo: { putPhoto: async (id: string, blob: Blob) => void stored.set(id, blob) } as TreeRepo,
  };
}

const session = createSessionStore({ getItem: () => "sess", setItem() {}, removeItem() {} });

describe("an owner's photo from another device", () => {
  test("is downloaded with the session token, once, and kept on this device", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/trees/t1/photos/p1": () =>
        new Response("img", { headers: { "content-type": "image/webp" } }),
    });
    const api = createApi(fetch, { session });
    const { repo, stored } = fakeRepo();
    const [a, b] = await Promise.all([
      fetchOwnerPhoto(repo, "t1", "p1", api, session),
      fetchOwnerPhoto(repo, "t1", "p1", api, session),
    ]);
    expect(a).toBeDefined();
    expect(b).toBe(a);
    expect(calls).toEqual([
      { method: "GET", path: "/api/trees/t1/photos/p1", authorization: "Bearer sess" },
    ]);
    expect(stored.has("p1")).toBe(true);
  });

  test("is not asked for without a session (signed out on this device)", async () => {
    const { fetch, calls } = fakeFetch();
    const signedOut = createSessionStore({ getItem: () => null, setItem() {}, removeItem() {} });
    const api = createApi(fetch, { session: signedOut });
    expect(await fetchOwnerPhoto(fakeRepo().repo, "t1", "p2", api, signedOut)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("is undefined when the server does not have it", async () => {
    const api = createApi(fakeFetch().fetch, { session });
    const { repo, stored } = fakeRepo();
    expect(await fetchOwnerPhoto(repo, "t1", "nope", api, session)).toBeUndefined();
    expect(stored.size).toBe(0);
  });
});
