import { expect, test } from "bun:test";

import { encodeCommand } from "@/sync/wire";

import { api, describeWorker, http, newTree, signIn, Socket, url } from "./helpers";

// The whole P1 story against the real Worker (it stands in for the browser E2E; see the Task 13
// ruling): the owner signs in, uploads, makes a hide-living view link; a relative opens it and
// sees the tree with living people's details cut; the owner adds a child and the relative sees it
// within two seconds; the owner turns the link off and the relative is told.

describeWorker("sharing a tree, end to end", () => {
  test("upload, view link, live edit, turn off", async () => {
    const owner = await signIn("nadia");
    const tree = newTree("Nadia's family");
    const [rootId] = Object.keys(tree.persons);
    tree.persons[rootId!] = {
      ...tree.persons[rootId!]!,
      isLiving: true,
      death: undefined,
      birth: { date: { year: 1961 } },
      notes: "private note",
    };
    const up = await api("/api/trees", {
      method: "POST",
      session: owner,
      body: JSON.stringify({ doc: tree }),
    });
    expect(up.status).toBe(201);

    const made = await api(`/api/trees/${tree.id}/links`, {
      method: "POST",
      session: owner,
      body: JSON.stringify({ role: "view", hideLiving: true }),
    });
    const link = (await made.json()) as { id: string; url: string };
    const token = link.url.split("/s/")[1]!;

    // The relative opens the link: no sign-in.
    const resolved = await http(url(`/api/s/${token}`));
    expect(await resolved.json()).toMatchObject({
      treeId: tree.id,
      role: "view",
      hideLiving: true,
    });
    const relative = new Socket(`/api/trees/${tree.id}/ws?t=${token}`);
    expect(await relative.opened).toBe(true);
    relative.send({ type: "hello" });
    const welcome = await relative.next("welcome");
    const seen = JSON.stringify(welcome);
    expect(seen).toContain(tree.persons[rootId!]!.firstName);
    expect(seen).not.toContain("1961");
    expect(seen).not.toContain("private note");

    // The owner edits live.
    const editor = new Socket(`/api/trees/${tree.id}/ws`, owner);
    await editor.opened;
    editor.send({ type: "hello", lastVersion: 0 });
    await editor.next("welcome");
    const started = Date.now();
    editor.send({
      type: "op",
      opId: "nadiaop001",
      cmd: encodeCommand({
        type: "addChild",
        parentId: rootId!,
        unionId: tree.unionOrder[rootId!]![0],
        child: { gender: "female", firstName: "Zara" },
      }),
    });
    const applied = await relative.next("applied");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(JSON.stringify(applied)).toContain("Zara");

    // The owner turns the link off: the relative is told, and the link no longer opens.
    await api(`/api/trees/${tree.id}/links/${link.id}`, { method: "DELETE", session: owner });
    expect(await relative.next("closed")).toMatchObject({ code: 4401 });
    expect((await http(url(`/api/s/${token}`))).status).toBe(404);
    editor.close();
  });
});
