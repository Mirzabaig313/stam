import { beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_LOOK, lookKey } from "@/templates/look";
import { metricsFor } from "@/templates/metrics";
import { createEditorStore } from "@/ui/store/editorStore";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;

beforeEach(async () => {
  env = await makeEditorEnv();
});

async function open() {
  const doc = famSimple();
  await env.repo.saveTree(doc);
  const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
  await store.getState().load(doc.id);
  return { store, treeId: doc.id };
}

describe("a tree's look", () => {
  test("a tree with no saved look opens in the default look and its card size", async () => {
    const { store } = await open();
    expect(store.getState().look).toEqual(DEFAULT_LOOK);
    expect(store.getState().layout?.metrics).toEqual(metricsFor(DEFAULT_LOOK));
  });

  test("setLook lays the tree out again with the new card size and saves it for this tree", async () => {
    const { store, treeId } = await open();
    store.getState().setLook({ template: "gallery", cardSize: 120 });
    const look = { ...DEFAULT_LOOK, template: "gallery" as const, cardSize: 120 };
    expect(store.getState().look).toEqual(look);
    expect(store.getState().layout?.metrics).toEqual(metricsFor(look));
    await Promise.resolve();
    expect(await env.repo.getSetting(lookKey(treeId))).toEqual(look);
  });

  test("a saved look comes back when the tree is opened again", async () => {
    const { store, treeId } = await open();
    store.getState().setLook({ template: "shajara", spacing: "airy" });
    await env.repo.setSetting(lookKey(treeId), store.getState().look);
    const again = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
    await again.getState().load(treeId);
    expect(again.getState().look).toMatchObject({ template: "shajara", spacing: "airy" });
  });

  test("out-of-range values are snapped into the controls' ranges", async () => {
    const { store } = await open();
    store.getState().setLook({ cardSize: 999, textSize: 3 });
    expect(store.getState().look).toMatchObject({ cardSize: 140, textSize: 85 });
  });
});
