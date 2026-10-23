import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { TreeDocument } from "@/core/model/types";
import type { TreeRepo } from "@/storage/treeRepo";
import { RepoContext } from "@/ui/app/RepoContext";
import { usePhotoUrls } from "@/ui/photos/usePhotoUrls";

import { famSimple } from "../../fixtures/families";

afterEach(cleanup);

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let created: Blob[];
let revoked: string[];
let loads: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  loads = [];
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return `blob:photos/${created.length}`;
  };
  URL.revokeObjectURL = (url: string) => {
    // Other test files revoke their own URLs from timers; only ours count.
    if (url.startsWith("blob:photos/")) revoked.push(url);
  };
});

afterEach(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

function wrapperFor(photos: Record<string, Blob>) {
  const repo = {
    getPhoto: async (id: string) => {
      loads.push(id);
      return photos[id];
    },
  } as unknown as TreeRepo;
  return ({ children }: { children: ReactNode }) => (
    <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>
  );
}

/** famSimple with photos on the given people. */
function withPhotos(photoIds: Record<string, string | undefined>): TreeDocument {
  const doc = famSimple();
  const persons = { ...doc.persons };
  for (const [personId, photoId] of Object.entries(photoIds)) {
    persons[personId] = { ...persons[personId]!, photoId };
  }
  return { ...doc, persons };
}

const [firstId, secondId] = Object.keys(famSimple().persons) as [string, string];

describe("usePhotoUrls", () => {
  test("loads nothing for a document without photos", async () => {
    const { result } = renderHook(() => usePhotoUrls(famSimple()), { wrapper: wrapperFor({}) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loads).toEqual([]);
    expect(result.current("p1")).toBeUndefined();
  });

  test("a null document is fine", () => {
    const { result } = renderHook(() => usePhotoUrls(null), { wrapper: wrapperFor({}) });
    expect(result.current("p1")).toBeUndefined();
  });

  test("builds an object URL for every photo in the document", async () => {
    const photos = { a: new Blob(["a"]), b: new Blob(["b"]) };
    const doc = withPhotos({ [firstId]: "a", [secondId]: "b" });
    const { result } = renderHook(() => usePhotoUrls(doc), { wrapper: wrapperFor(photos) });
    await waitFor(() => expect(result.current("a")).toBeDefined());
    await waitFor(() => expect(result.current("b")).toBeDefined());
    expect(result.current("a")).not.toBe(result.current("b"));
    expect(new Set(created)).toEqual(new Set([photos.a, photos.b]));
  });

  test("a photo shared by two people is loaded once", async () => {
    const doc = withPhotos({ [firstId]: "a", [secondId]: "a" });
    const { result } = renderHook(() => usePhotoUrls(doc), {
      wrapper: wrapperFor({ a: new Blob(["a"]) }),
    });
    await waitFor(() => expect(result.current("a")).toBeDefined());
    expect(loads).toEqual(["a"]);
    expect(created).toHaveLength(1);
  });

  test("a photo that is not stored stays undefined and makes no URL", async () => {
    const doc = withPhotos({ [firstId]: "gone" });
    const { result } = renderHook(() => usePhotoUrls(doc), { wrapper: wrapperFor({}) });
    await waitFor(() => expect(loads).toEqual(["gone"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current("gone")).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  test("keeps the cached URL when the document changes but the photo stays", async () => {
    const photos = { a: new Blob(["a"]) };
    const { result, rerender } = renderHook(({ doc }) => usePhotoUrls(doc), {
      wrapper: wrapperFor(photos),
      initialProps: { doc: withPhotos({ [firstId]: "a" }) },
    });
    await waitFor(() => expect(result.current("a")).toBe("blob:photos/1"));
    rerender({ doc: withPhotos({ [firstId]: "a", [secondId]: undefined }) });
    expect(result.current("a")).toBe("blob:photos/1");
    expect(loads).toEqual(["a"]);
    expect(revoked).toEqual([]);
  });

  test("revokes the URL of a photo that left the document, and keeps the others", async () => {
    const photos = { a: new Blob(["a"]), b: new Blob(["b"]) };
    const { result, rerender } = renderHook(({ doc }) => usePhotoUrls(doc), {
      wrapper: wrapperFor(photos),
      initialProps: { doc: withPhotos({ [firstId]: "a", [secondId]: "b" }) },
    });
    await waitFor(() => expect(result.current("a") && result.current("b")).toBeTruthy());
    const urlA = result.current("a");
    const urlB = result.current("b");
    rerender({ doc: withPhotos({ [firstId]: "a", [secondId]: undefined }) });
    await waitFor(() => expect(result.current("b")).toBeUndefined());
    expect(revoked).toEqual([urlB!]);
    expect(result.current("a")).toBe(urlA);
  });

  test("loads a photo added later", async () => {
    const photos = { a: new Blob(["a"]) };
    const { result, rerender } = renderHook(({ doc }) => usePhotoUrls(doc), {
      wrapper: wrapperFor(photos),
      initialProps: { doc: famSimple() },
    });
    expect(result.current("a")).toBeUndefined();
    rerender({ doc: withPhotos({ [firstId]: "a" }) });
    await waitFor(() => expect(result.current("a")).toBe("blob:photos/1"));
  });

  test("revokes every URL on unmount", async () => {
    const photos = { a: new Blob(["a"]), b: new Blob(["b"]) };
    const doc = withPhotos({ [firstId]: "a", [secondId]: "b" });
    const { result, unmount } = renderHook(() => usePhotoUrls(doc), {
      wrapper: wrapperFor(photos),
    });
    await waitFor(() => expect(result.current("a") && result.current("b")).toBeTruthy());
    unmount();
    expect([...revoked].toSorted()).toEqual(["blob:photos/1", "blob:photos/2"]);
  });

  test("a photo that finishes loading after unmount makes no URL", async () => {
    let release: ((blob: Blob) => void) | undefined;
    const repo = {
      getPhoto: () => new Promise<Blob>((resolve) => (release = resolve)),
    } as unknown as TreeRepo;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>
    );
    const doc = withPhotos({ [firstId]: "a" });
    const { unmount } = renderHook(() => usePhotoUrls(doc), { wrapper });
    unmount();
    release?.(new Blob(["a"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toHaveLength(0);
  });
});
