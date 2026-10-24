import { expect, test } from "bun:test";

import { api, describeWorker, http, newTree, signIn, upload, url, viewLink } from "./helpers";

/** The smallest bytes the server accepts as WebP: RIFF....WEBP, then content. */
function webp(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  return bytes;
}

async function treeWithPhoto(owner: string, living: boolean) {
  const tree = newTree();
  const id = Object.keys(tree.persons)[0]!;
  tree.persons[id] = {
    ...tree.persons[id]!,
    isLiving: living,
    death: living ? undefined : { place: "Lahore" },
    photoId: "ph1",
  };
  return upload(owner, tree);
}

const put = (
  treeId: string,
  session: string | undefined,
  body: Uint8Array<ArrayBuffer>,
  query = "",
) =>
  api(`/api/trees/${treeId}/photos/ph1${query}`, {
    method: "PUT",
    session,
    headers: { "content-type": "image/webp" },
    body,
  });

describeWorker("photos", () => {
  test("the owner uploads and a viewer downloads a photo", async () => {
    const owner = await signIn("jade");
    const doc = await treeWithPhoto(owner, false);
    expect((await put(doc.id, owner, webp())).status).toBe(204);
    const link = await viewLink(owner, doc.id);
    const res = await http(url(`/api/trees/${doc.id}/photos/ph1?t=${link.token}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp());
  });

  test("non-WebP or over 300 KB is refused", async () => {
    const owner = await signIn("jade");
    const doc = await treeWithPhoto(owner, false);
    expect((await put(doc.id, owner, new Uint8Array(64))).status).toBe(415);
    expect((await put(doc.id, owner, webp(300 * 1024 + 1))).status).toBe(413);
  });

  test("a photo no one in the tree has is refused", async () => {
    const owner = await signIn("jade");
    const doc = await upload(owner);
    expect((await put(doc.id, owner, webp())).status).toBe(404);
  });

  test("a living person's photo is 404 for hide-living links", async () => {
    const owner = await signIn("kai");
    const doc = await treeWithPhoto(owner, true);
    await put(doc.id, owner, webp());
    const hidden = await viewLink(owner, doc.id, true);
    expect((await http(url(`/api/trees/${doc.id}/photos/ph1?t=${hidden.token}`))).status).toBe(404);
    const owned = await api(`/api/trees/${doc.id}/photos/ph1`, { session: owner });
    expect(owned.status).toBe(200);
  });

  test("a viewer cannot upload, and nobody unauthenticated can read", async () => {
    const owner = await signIn("lia");
    const doc = await treeWithPhoto(owner, false);
    const link = await viewLink(owner, doc.id);
    expect((await put(doc.id, undefined, webp(), `?t=${link.token}`)).status).toBe(403);
    expect((await http(url(`/api/trees/${doc.id}/photos/ph1`))).status).toBe(401);
  });
});
