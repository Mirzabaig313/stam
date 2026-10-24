import { expect, test } from "bun:test";

import { encodeCommand } from "@/sync/wire";

import { api, describeWorker, newTree, signIn, Socket, upload, viewLink } from "./helpers";

const rename = (opId: string, name: string) => ({
  type: "op",
  opId,
  cmd: encodeCommand({ type: "renameTree", name }),
});

describeWorker("live tree rooms", () => {
  test("the owner's op is broadcast to a viewer", async () => {
    const owner = await signIn("bea");
    const doc = await upload(owner);
    const link = await viewLink(owner, doc.id);
    const o = new Socket(`/api/trees/${doc.id}/ws`, owner);
    const v = new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`);
    expect(await o.opened).toBe(true);
    expect(await v.opened).toBe(true);
    o.send({ type: "hello", lastVersion: 0 });
    v.send({ type: "hello" });
    expect(await o.next("welcome")).toMatchObject({ role: "owner", version: 0 });
    expect(await v.next("welcome")).toMatchObject({
      role: "view",
      version: 0,
      doc: { id: doc.id },
    });
    o.send(rename("aaaaaaaaaa", "Renamed"));
    const seen = await v.next("applied");
    expect(seen).toMatchObject({
      version: 1,
      opId: "aaaaaaaaaa",
      changes: { tree: { name: "Renamed" } },
    });
    expect(seen.author).toEqual({ kind: "owner", name: "Bea" });
    o.close();
    v.close();
  });

  test("a hide-living viewer gets a redacted welcome and redacted changes", async () => {
    const owner = await signIn("cleo");
    const tree = newTree();
    const id = Object.keys(tree.persons)[0]!;
    tree.persons[id] = { ...tree.persons[id]!, isLiving: true, notes: "secret", death: undefined };
    const doc = await upload(owner, tree);
    const link = await viewLink(owner, doc.id, true);
    const o = new Socket(`/api/trees/${doc.id}/ws`, owner);
    const v = new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`);
    await Promise.all([o.opened, v.opened]);
    v.send({ type: "hello" });
    const welcome = await v.next("welcome");
    expect(JSON.stringify(welcome)).not.toContain("secret");
    o.send({
      type: "op",
      opId: "bbbbbbbbbb",
      cmd: encodeCommand({ type: "updatePerson", personId: id, patch: { notes: "new secret" } }),
    });
    const applied = await v.next("applied");
    expect(JSON.stringify(applied)).not.toContain("secret");
    o.close();
    v.close();
  });

  test("a viewer's op is FORBIDDEN", async () => {
    const owner = await signIn("dina");
    const doc = await upload(owner);
    const link = await viewLink(owner, doc.id);
    const v = new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`);
    await v.opened;
    v.send(rename("cccccccccc", "Mine now"));
    expect(await v.next("rejected")).toMatchObject({ code: "FORBIDDEN" });
    v.close();
  });

  test("no session and no link, or another tree's link, cannot connect", async () => {
    const owner = await signIn("ella");
    const doc = await upload(owner);
    const other = await upload(owner);
    const link = await viewLink(owner, other.id);
    expect(await new Socket(`/api/trees/${doc.id}/ws`).opened).toBe(false);
    expect(await new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`).opened).toBe(false);
    expect(await new Socket(`/api/trees/${doc.id}/ws`, await signIn("fred")).opened).toBe(false);
  });

  test("a revoked link closes its sockets with 4401 and cannot reconnect", async () => {
    const owner = await signIn("gail");
    const doc = await upload(owner);
    const link = await viewLink(owner, doc.id);
    const v = new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`);
    await v.opened;
    await api(`/api/trees/${doc.id}/links/${link.id}`, { method: "DELETE", session: owner });
    expect(await v.next("closed")).toMatchObject({ code: 4401 });
    expect(await new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`).opened).toBe(false);
  });

  test("deleting the tree closes every socket with 4404", async () => {
    const owner = await signIn("hana");
    const doc = await upload(owner);
    const link = await viewLink(owner, doc.id);
    const o = new Socket(`/api/trees/${doc.id}/ws`, owner);
    const v = new Socket(`/api/trees/${doc.id}/ws?t=${link.token}`);
    await Promise.all([o.opened, v.opened]);
    await api(`/api/trees/${doc.id}`, { method: "DELETE", session: owner });
    expect(await o.next("closed")).toMatchObject({ code: 4404 });
    expect(await v.next("closed")).toMatchObject({ code: 4404 });
  });

  test("a reconnecting owner gets the ops it missed", async () => {
    const owner = await signIn("ivy");
    const doc = await upload(owner);
    const a = new Socket(`/api/trees/${doc.id}/ws`, owner);
    await a.opened;
    a.send(rename("dddddddddd", "One"));
    await a.next("applied");
    a.send(rename("eeeeeeeeee", "Two"));
    await a.next("applied");
    a.close();
    const b = new Socket(`/api/trees/${doc.id}/ws`, owner);
    await b.opened;
    b.send({ type: "hello", lastVersion: 1, pending: ["eeeeeeeeee"] });
    const welcome = await b.next("welcome");
    expect(welcome.version).toBe(2);
    expect((welcome.ops as { opId: string }[]).map((o) => o.opId)).toEqual(["eeeeeeeeee"]);
    expect(welcome.known).toEqual(["eeeeeeeeee"]);
    b.close();
  });
});
