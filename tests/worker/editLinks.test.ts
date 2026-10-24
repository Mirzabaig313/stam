import { expect, test } from "bun:test";

import { encodeCommand } from "@/sync/wire";

import { api, describeWorker, http, makeLink, signIn, Socket, upload, url } from "./helpers";

// Edit links (P2): whoever opens one edits the tree live, without signing in.

describeWorker("edit links", () => {
  test("the owner makes an edit link; it never hides living people", async () => {
    const owner = await signIn("eda");
    const doc = await upload(owner);
    const res = await api(`/api/trees/${doc.id}/links`, {
      method: "POST",
      session: owner,
      body: JSON.stringify({ role: "edit", hideLiving: true }),
    });
    expect(res.status).toBe(201);
    const link = (await res.json()) as { role: string; hideLiving: boolean; url: string };
    expect(link).toMatchObject({ role: "edit", hideLiving: false });
    const token = link.url.split("/s/")[1]!;
    expect(await (await http(url(`/api/s/${token}`))).json()).toMatchObject({
      treeId: doc.id,
      role: "edit",
      hideLiving: false,
    });
  });

  test("a view link and an edit link live side by side", async () => {
    const owner = await signIn("edb");
    const doc = await upload(owner);
    await makeLink(owner, doc.id, "view");
    await makeLink(owner, doc.id, "edit");
    const list = (await (await api(`/api/trees/${doc.id}/links`, { session: owner })).json()) as {
      role: string;
    }[];
    expect(list.map((l) => l.role).toSorted()).toEqual(["edit", "view"]);
  });

  test("an edit link's edits reach the owner live", async () => {
    const owner = await signIn("edc");
    const doc = await upload(owner);
    const link = await makeLink(owner, doc.id, "edit");
    const o = new Socket(`/api/trees/${doc.id}/ws`, owner);
    const e = new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`);
    await Promise.all([o.opened, e.opened]);
    o.send({ type: "hello", lastVersion: 0 });
    e.send({ type: "hello" });
    await o.next("welcome");
    expect(await e.next("welcome")).toMatchObject({ role: "edit", hideLiving: false });
    e.send({
      type: "op",
      opId: "editlink01",
      cmd: encodeCommand({ type: "renameTree", name: "Edited by a relative" }),
    });
    const applied = await o.next("applied");
    expect(applied).toMatchObject({
      opId: "editlink01",
      changes: { tree: { name: "Edited by a relative" } },
      author: { kind: "link" },
    });
    o.close();
    e.close();
  });

  test("an edit link uploads photos with its token", async () => {
    const owner = await signIn("edd");
    const tree = (await import("./helpers")).newTree();
    const id = Object.keys(tree.persons)[0]!;
    tree.persons[id] = { ...tree.persons[id]!, photoId: "ph1" };
    const doc = await upload(owner, tree);
    const link = await makeLink(owner, doc.id, "edit");
    const bytes = new Uint8Array(64);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    bytes.set(new TextEncoder().encode("WEBP"), 8);
    const res = await api(`/api/trees/${doc.id}/photos/ph1?t=${link.token}`, {
      method: "PUT",
      headers: { "content-type": "image/webp" },
      body: bytes,
    });
    expect(res.status).toBe(204);
  });
});
