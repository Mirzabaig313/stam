import type { TreeDocument } from "@/core/model/types";

// The REST side of the backend (spec §7). Same-origin requests: the browser sends the session
// cookie and the Origin header the server checks.

export type Me = {
  user: { id: string; name: string; email: string };
  trees: { id: string; name: string; createdAt: string }[];
};

export type Link = {
  id: string;
  role: "view" | "comment" | "edit";
  hideLiving: boolean;
  url: string;
  createdAt: string;
};

export type ResolvedLink = {
  treeId: string;
  role: "view" | "comment" | "edit";
  hideLiving: boolean;
  name: string;
};

/** A refused request: the HTTP status and the server's error code. */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export type Api = ReturnType<typeof createApi>;

/** The part of `fetch` the client uses (Bun's `typeof fetch` adds members tests need not fake). */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function createApi(fetchFn: FetchFn = (input, init) => globalThis.fetch(input, init)) {
  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetchFn(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const code = await res
        .json()
        .then((b: unknown) => (b as { error?: string }).error ?? "ERROR")
        .catch(() => "ERROR");
      throw new ApiError(res.status, code);
    }
    return res;
  }

  const json = async <T>(method: string, path: string, body?: unknown) =>
    (await (await request(method, path, body)).json()) as T;

  return {
    /** The signed-in user, or null when nobody is. */
    async getMe(): Promise<Me | null> {
      try {
        return await json<Me>("GET", "/api/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    uploadTree: (doc: TreeDocument) =>
      json<{ id: string; version: number }>("POST", "/api/trees", { doc }),
    deleteCloudTree: async (id: string) => void (await request("DELETE", `/api/trees/${id}`)),
    listLinks: (id: string) => json<Link[]>("GET", `/api/trees/${id}/links`),
    createLink: (id: string, link: { role: "view"; hideLiving: boolean }) =>
      json<Link>("POST", `/api/trees/${id}/links`, link),
    deleteLink: async (id: string, linkId: string) =>
      void (await request("DELETE", `/api/trees/${id}/links/${linkId}`)),
    resolveLink: (token: string) =>
      json<ResolvedLink>("GET", `/api/s/${encodeURIComponent(token)}`),
    async uploadPhoto(treeId: string, photoId: string, blob: Blob): Promise<void> {
      const res = await fetchFn(`/api/trees/${treeId}/photos/${photoId}`, {
        method: "PUT",
        headers: { "content-type": "image/webp" },
        body: blob,
      });
      if (!res.ok) throw new ApiError(res.status, "PHOTO_REFUSED");
    },
    async downloadPhoto(treeId: string, photoId: string): Promise<Blob> {
      return (await request("GET", `/api/trees/${treeId}/photos/${photoId}`)).blob();
    },
    /** Where a cloud tree's photo is; link users add their token. */
    photoUrl: (treeId: string, photoId: string, token?: string) =>
      `/api/trees/${treeId}/photos/${photoId}${token ? `?t=${encodeURIComponent(token)}` : ""}`,
    signInUrl: (returnPath: string) => `/api/auth/google?return=${encodeURIComponent(returnPath)}`,
    signOut: async () => void (await request("POST", "/api/auth/signout")),
  };
}

export const api = createApi();
