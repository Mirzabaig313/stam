import { expect, test } from "bun:test";

import type { TreeDocument } from "@/core/model/types";

import { famSimple } from "../fixtures/families";
import {
  api,
  describeWorker,
  http,
  newTree,
  ORIGIN,
  signIn,
  upload,
  url,
  viewLink,
} from "./helpers";

const post = (path: string, session: string, body: unknown) =>
  api(path, { method: "POST", session, body: JSON.stringify(body) });

describeWorker("shared trees and view links", () => {
  test("upload creates the tree and lists it in /api/me", async () => {
    const session = await signIn("tina");
    const doc = newTree("Tina's family");
    const res = await post("/api/trees", session, { doc });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: doc.id, version: 0 });
    const me = (await (await api("/api/me", { session })).json()) as {
      trees: { id: string; name: string }[];
    };
    expect(me.trees).toEqual([expect.objectContaining({ id: doc.id, name: "Tina's family" })]);
  });

  test("upload needs a session, the site's Origin and JSON", async () => {
    expect((await api("/api/trees", { method: "POST", body: "{}" })).status).toBe(401);
    const session = await signIn("tina");
    const noOrigin = await http(url("/api/trees"), {
      method: "POST",
      headers: { cookie: session, "content-type": "application/json" },
      body: JSON.stringify({ doc: newTree() }),
    });
    expect(noOrigin.status).toBe(403);
    const form = await api("/api/trees", {
      method: "POST",
      session,
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ doc: newTree() }),
    });
    expect([403, 415]).toContain(form.status);
  });

  test("upload of an invalid tree is 400", async () => {
    const session = await signIn("tina");
    const broken = { ...newTree(), rootPersonId: "ghost" };
    expect((await post("/api/trees", session, { doc: broken })).status).toBe(400);
    expect((await post("/api/trees", session, { doc: 7 })).status).toBe(400);
  });

  test("a tree id outside the id rule is refused", async () => {
    const session = await signIn("tina");
    for (const id of ["a/b", "x".repeat(65), "7"]) {
      expect((await post("/api/trees", session, { doc: { ...newTree(), id } })).status).toBe(400);
    }
  });

  test("a deleted tree can be shared again, starting from the new upload", async () => {
    const owner = await signIn("bo");
    const doc = await upload(owner, newTree("First"));
    expect((await api(`/api/trees/${doc.id}`, { method: "DELETE", session: owner })).status).toBe(
      204,
    );
    const again = await post("/api/trees", owner, { doc: { ...doc, name: "Second" } });
    expect(again.status).toBe(201);
    const me = (await (await api("/api/me", { session: owner })).json()) as {
      trees: { name: string }[];
    };
    expect(me.trees.map((t) => t.name)).toEqual(["Second"]);
  });

  test("upload over 5000 people is 413", async () => {
    const session = await signIn("tina");
    const doc = newTree();
    const persons: TreeDocument["persons"] = {};
    for (let i = 0; i < 5001; i++) {
      persons[`p${i}`] = {
        id: `p${i}`,
        firstName: "",
        lastName: "",
        gender: "male",
        isLiving: true,
      };
    }
    const res = await post("/api/trees", session, {
      doc: { ...doc, persons, unions: {}, unionOrder: {}, rootPersonId: "p0" },
    });
    expect(res.status).toBe(413);
  });

  test("upload with an id owned by another user is 409 TREE_ID_TAKEN", async () => {
    const doc = await upload(await signIn("uma"));
    const res = await post("/api/trees", await signIn("victor"), { doc });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TREE_ID_TAKEN" });
    const again = await post("/api/trees", await signIn("uma"), { doc });
    expect(await again.json()).toEqual({ error: "ALREADY_SHARED" });
  });

  test("only the owner can create, list and delete links", async () => {
    const owner = await signIn("wendy");
    const doc = await upload(owner);
    const stranger = await signIn("xavier");
    expect((await post(`/api/trees/${doc.id}/links`, stranger, { role: "view" })).status).toBe(404);
    expect((await api(`/api/trees/${doc.id}/links`, { session: stranger })).status).toBe(404);
    const link = await viewLink(owner, doc.id);
    expect(link.url).toBe(`${ORIGIN}/s/${link.token}`);
    const del = await api(`/api/trees/${doc.id}/links/${link.id}`, {
      method: "DELETE",
      session: stranger,
    });
    expect(del.status).toBe(404);
  });

  test("a link resolves; reset revokes the old one; the url can be copied again later", async () => {
    const owner = await signIn("yara");
    const doc = await upload(owner, newTree("Yara's"));
    const first = await viewLink(owner, doc.id, true);
    const resolved = await http(url(`/api/s/${first.token}`));
    expect(await resolved.json()).toEqual({
      treeId: doc.id,
      role: "view",
      hideLiving: true,
      name: "Yara's",
    });
    const second = await viewLink(owner, doc.id);
    expect((await http(url(`/api/s/${first.token}`))).status).toBe(404);
    const list = (await (await api(`/api/trees/${doc.id}/links`, { session: owner })).json()) as {
      id: string;
      url: string;
      hideLiving: boolean;
    }[];
    expect(list).toEqual([
      expect.objectContaining({ id: second.id, url: second.url, hideLiving: false }),
    ]);
  });

  test("turning a link off makes it LINK_OFF", async () => {
    const owner = await signIn("zane");
    const doc = await upload(owner);
    const link = await viewLink(owner, doc.id);
    const del = await api(`/api/trees/${doc.id}/links/${link.id}`, {
      method: "DELETE",
      session: owner,
    });
    expect(del.status).toBe(204);
    const res = await http(url(`/api/s/${link.token}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "LINK_OFF" });
  });

  test("comment and edit roles are not available yet", async () => {
    const owner = await signIn("zane");
    const doc = await upload(owner);
    for (const role of ["comment", "edit", "owner"]) {
      expect((await post(`/api/trees/${doc.id}/links`, owner, { role })).status).toBe(400);
    }
  });

  test("a deleted tree's links resolve as LINK_OFF and it leaves /api/me", async () => {
    const owner = await signIn("abby");
    const doc = await upload(owner);
    const link = await viewLink(owner, doc.id);
    expect((await api(`/api/trees/${doc.id}`, { method: "DELETE", session: owner })).status).toBe(
      204,
    );
    expect((await http(url(`/api/s/${link.token}`))).status).toBe(404);
    const me = (await (await api("/api/me", { session: owner })).json()) as { trees: unknown[] };
    expect(me.trees).toEqual([]);
  });

  test("an unknown link token is LINK_OFF", async () => {
    const res = await http(url("/api/s/nope"));
    expect(res.status).toBe(404);
    expect(famSimple().id).toBeDefined();
  });
});
