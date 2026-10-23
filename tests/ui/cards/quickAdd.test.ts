import { describe, expect, test } from "bun:test";

import { createTree } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import { startAdd } from "@/ui/cards/quickAdd";
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
