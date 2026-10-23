import { describe, expect, test } from "bun:test";

import { createTree } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import type { AddRole } from "@/ui/cards/nameEntry";
import { quickAddRoles, startAdd } from "@/ui/cards/quickAdd";
import { createEditorStore } from "@/ui/store/editorStore";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";

async function storeWith(doc: TreeDocument) {
  const env = await makeEditorEnv();
  await env.repo.saveTree({ ...doc, id: "t1" });
  const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
  await store.getState().load("t1");
  return store;
}

describe("startAdd", () => {
  test("dispatches the add with an empty name and starts editing the new person", async () => {
    const store = await storeWith(famSimple());
    const id = startAdd(store, "child", "c1");
    expect(id).not.toBeNull();
    const s = store.getState();
    expect(s.doc!.persons[id!]).toMatchObject({ firstName: "", lastName: "" });
    expect(s.editing).toEqual({ personId: id!, role: "child", fromId: "c1" });
  });

  test("the first person of an empty tree becomes its root", async () => {
    const store = await storeWith(createTree("Empty"));
    const id = startAdd(store, "first");
    expect(store.getState().doc!.rootPersonId).toBe(id!);
    expect(store.getState().layout?.primaryNode[id!]).toBeDefined();
  });

  test("a refused add returns null, keeps the store error and opens no editor", async () => {
    const store = await storeWith(famSimple());
    expect(startAdd(store, "parent", "c1")).toBeNull();
    expect(store.getState().error).toBe("PARENTS_FULL");
    expect(store.getState().editing).toBeNull();
  });

  test("a new person outside the current view moves the view root so their card shows", async () => {
    const store = await storeWith(famSimple());
    store.getState().setViewRoot("c1");
    const id = startAdd(store, "sibling", "c1")!;
    expect(store.getState().layout!.primaryNode[id]).toBeDefined();
    expect(store.getState().viewRootId).toBe("dad");
  });

  test("an add while another is being named cancels the first one", async () => {
    const store = await storeWith(famSimple());
    const first = startAdd(store, "child", "c1")!;
    const second = startAdd(store, "child", "c2")!;
    expect(store.getState().doc!.persons[first]).toBeUndefined();
    expect(store.getState().editing?.personId).toBe(second);
  });
});

describe("startAdd in the focus views", () => {
  // [view, focus, role, from]: every add is drawn and the family view's root never moves.
  test.each([
    ["pedigree", "dad", "parent", "dad"],
    ["pedigree", "c1", "sibling", "c1"],
    ["pedigree", "c1", "spouse", "c1"],
    ["descendants", "c1", "child", "c1"],
    ["descendants", "c1", "spouse", "c1"],
    ["descendants", "c1", "sibling", "c1"],
    ["hourglass", "c1", "child", "c1"],
    ["hourglass", "c1", "spouse", "c1"],
    ["hourglass", "c1", "sibling", "c1"],
    ["hourglass", "c1", "parent", "dad"],
  ] as const)("%s around %s: add %s of %s", async (view, focus, role, from) => {
    const store = await storeWith(famSimple());
    store.getState().select(focus);
    store.getState().setViewMode(view);
    const id = startAdd(store, role, from)!;
    expect(id).not.toBeNull();
    const s = store.getState();
    expect(s.viewMode).toBe(view);
    expect(s.layout!.primaryNode[id]).toBeDefined();
    expect(s.viewRootId).toBeNull();
    expect(s.editing?.personId).toBe(id);
  });

  test("a new person the focus view can't draw becomes the focus", async () => {
    const store = await storeWith(famSimple());
    store.getState().select("c1");
    store.getState().setViewMode("pedigree");
    const id = startAdd(store, "sibling", "c1")!;
    expect(store.getState().focusId).toBe(id);
  });
});

describe("quickAddRoles", () => {
  const all: AddRole[] = ["parent", "child", "spouse", "sibling"];
  const roles = (view: Parameters<typeof quickAddRoles>[0], generation: number) =>
    all.filter((r) => quickAddRoles(view, { generation }).has(r));

  test("the family view offers every handle", () => {
    expect(roles("family", 0)).toEqual(all);
    expect(roles("family", 3)).toEqual(all);
  });

  test("the pedigree only adds parents, the descendants view only children", () => {
    expect(roles("pedigree", 0)).toEqual(["parent"]);
    expect(roles("pedigree", -2)).toEqual(["parent"]);
    expect(roles("descendants", 0)).toEqual(["child"]);
    expect(roles("descendants", 2)).toEqual(["child"]);
  });

  test("the hourglass adds parents above the focus row, anything on it and below", () => {
    expect(roles("hourglass", -1)).toEqual(["parent"]);
    expect(roles("hourglass", 0)).toEqual(all);
    expect(roles("hourglass", 1)).toEqual(all);
  });

  test("fan and timeline offer nothing", () => {
    expect(roles("fan", 0)).toEqual([]);
    expect(roles("timeline", 0)).toEqual([]);
  });
});
