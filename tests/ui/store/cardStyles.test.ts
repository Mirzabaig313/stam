import { beforeEach, describe, expect, test } from "bun:test";

import { nodeWidth } from "@/core/layout/result";
import { cardStylesKey } from "@/templates/cardStyle";
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

const widthOf = (store: Awaited<ReturnType<typeof open>>["store"], personId: string) => {
  const layout = store.getState().layout!;
  const node = layout.nodes.find((n) => n.personId === personId)!;
  return nodeWidth(node, layout.metrics);
};

describe("card styles", () => {
  test("a resized card is laid out at its own size; its neighbours move over", async () => {
    const { store } = await open();
    const before = widthOf(store, "c1");
    const c2x = store.getState().layout!.nodes.find((n) => n.personId === "c2")!.x;
    store.getState().commitCardStyles({ c1: { size: { w: 150, h: 100 } } }, "Resize card");
    expect(widthOf(store, "c1")).toBe(Math.round(before * 1.5));
    expect(store.getState().layout!.nodes.find((n) => n.personId === "c2")!.x).toBeGreaterThan(c2x);
  });

  test("a preview records nothing; the commit is one undo step from where the gesture began", async () => {
    const { store } = await open();
    const s = store.getState();
    s.previewCardStyles({ c1: { fill: "#ff0000" } });
    s.previewCardStyles({ c1: { fill: "#00ff00" } });
    expect(store.getState().canUndo).toBe(false);
    s.commitCardStyles({ c1: { fill: "#0000ff" } }, "Fill");
    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().cardStyles).toEqual({});
    store.getState().redo();
    expect(store.getState().cardStyles).toEqual({ c1: { fill: "#0000ff" } });
  });

  test("style steps and tree edits undo in the order they were made", async () => {
    const { store } = await open();
    store.getState().commitCardStyles({ dad: { radius: 20 } }, "Corners");
    store.getState().dispatch({ type: "renameTree", name: "Renamed" }, "Rename");
    store.getState().undo();
    expect(store.getState().doc!.name).not.toBe("Renamed");
    expect(store.getState().cardStyles).toEqual({ dad: { radius: 20 } });
    store.getState().undo();
    expect(store.getState().cardStyles).toEqual({});
  });

  test("committed styles are kept for the tree and come back when it opens again", async () => {
    const { store, treeId } = await open();
    store.getState().commitCardStyles({ mom: { padding: 20 } }, "Padding");
    // The save is asynchronous (IndexedDB): wait until it is there.
    let saved: unknown;
    for (let i = 0; i < 50 && saved === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      saved = await env.repo.getSetting(cardStylesKey(treeId));
    }
    expect(saved).toEqual({ mom: { padding: 20 } });
    const again = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
    await again.getState().load(treeId);
    expect(again.getState().cardStyles).toEqual({ mom: { padding: 20 } });
  });
});
