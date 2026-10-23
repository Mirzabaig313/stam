import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { TreeRepo } from "@/storage/treeRepo";
import { RepoContext } from "@/ui/app/RepoContext";
import { usePhotoUrl } from "@/ui/photos/usePhotoUrl";

afterEach(cleanup);

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let created: Blob[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return `blob:photo/${created.length}`;
  };
  URL.revokeObjectURL = (url: string) => {
    // Other test files revoke their own URLs from timers; only ours count.
    if (url.startsWith("blob:photo/")) revoked.push(url);
  };
});

afterEach(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

function wrapperFor(photos: Record<string, Blob>) {
  const repo = { getPhoto: async (id: string) => photos[id] } as unknown as TreeRepo;
  return ({ children }: { children: ReactNode }) => (
    <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>
  );
}

describe("usePhotoUrl", () => {
  test("is undefined without a photo id and loads nothing", () => {
    const { result } = renderHook(() => usePhotoUrl(undefined), { wrapper: wrapperFor({}) });
    expect(result.current).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  test("gives an object URL for the stored blob", async () => {
    const blob = new Blob(["x"], { type: "image/webp" });
    const { result } = renderHook(() => usePhotoUrl("p1"), { wrapper: wrapperFor({ p1: blob }) });
    await waitFor(() => expect(result.current).toBe("blob:photo/1"));
    expect(created[0]).toBe(blob);
  });

  test("stays undefined for a photo that is not stored", async () => {
    const { result } = renderHook(() => usePhotoUrl("gone"), { wrapper: wrapperFor({}) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  test("revokes the URL on unmount", async () => {
    const photos = { p1: new Blob(["x"]) };
    const { result, unmount } = renderHook(() => usePhotoUrl("p1"), {
      wrapper: wrapperFor(photos),
    });
    await waitFor(() => expect(result.current).toBe("blob:photo/1"));
    unmount();
    expect(revoked).toEqual(["blob:photo/1"]);
  });

  test("switching photos revokes the old URL and never shows it for the new id", async () => {
    const photos = { p1: new Blob(["a"]), p2: new Blob(["b"]) };
    const { result, rerender } = renderHook(({ id }) => usePhotoUrl(id), {
      wrapper: wrapperFor(photos),
      initialProps: { id: "p1" },
    });
    await waitFor(() => expect(result.current).toBe("blob:photo/1"));
    rerender({ id: "p2" });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe("blob:photo/2"));
    expect(revoked).toEqual(["blob:photo/1"]);
  });
});
