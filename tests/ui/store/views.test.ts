import { beforeEach, describe, expect, test } from "bun:test";

import { layoutFamily } from "@/core/layout/family";
import type { FanLayout, TimelineLayout } from "@/core/views/types";
import { DEFAULT_LOOK } from "@/templates/look";
import { metricsFor } from "@/templates/metrics";
import { createEditorStore } from "@/ui/store/editorStore";
import { isFocusView, isReadOnlyView, type ViewLayoutFns } from "@/ui/store/viewLayouts";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";

/** Every layout is built with the tree's look; these trees keep the default one. */
const metrics = metricsFor(DEFAULT_LOOK);

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;
let calls: { name: string; args: unknown }[];

const FAN: FanLayout = { focusId: "x", segments: [], radius: 100, generations: 5 };
const TIMELINE: TimelineLayout = {
  bars: [],
  minYear: 1900,
  maxYear: 2000,
  rows: 0,
  generationRows: [],
};

/** Every non-family layout is a recording fake that answers with the family layout. */
const fakes: ViewLayoutFns = {
  family: layoutFamily,
  pedigree: (doc, o) => {
    calls.push({ name: "pedigree", args: o });
    return layoutFamily(doc, { rootId: o.focusId });
  },
  descendants: (doc, o) => {
    calls.push({ name: "descendants", args: o });
    return layoutFamily(doc, { rootId: o.rootId });
  },
  hourglass: (doc, o) => {
    calls.push({ name: "hourglass", args: o });
    return layoutFamily(doc, { rootId: o.focusId });
  },
  fan: (_doc, o) => {
    calls.push({ name: "fan", args: o });
    return { ...FAN, focusId: o.focusId };
  },
  timeline: (_doc, o, now) => {
    calls.push({ name: "timeline", args: { ...o, now } });
    return TIMELINE;
  },
};

async function open() {
  const doc = famSimple();
  await env.repo.saveTree(doc);
  const store = createEditorStore({
    repo: env.repo,
    autosaver: env.autosaver,
    now: env.now,
    layouts: fakes,
  });
  await store.getState().load(doc.id);
  return store;
}

beforeEach(async () => {
  env = await makeEditorEnv();
  calls = [];
  localStorage.removeItem("stam:pending:doc");
});

describe("view helpers", () => {
  test("fan and timeline are read-only; four views are drawn around a person", () => {
    expect(["family", "fan", "timeline"].map((m) => isReadOnlyView(m as never))).toEqual([
      false,
      true,
      true,
    ]);
    expect(
      (["family", "pedigree", "descendants", "hourglass", "fan", "timeline"] as const).filter(
        isFocusView,
      ),
    ).toEqual(["pedigree", "descendants", "hourglass", "fan"]);
  });
});

describe("viewMode and focus", () => {
  test("starts in the family view with no focus", async () => {
    const s = (await open()).getState();
    expect(s.viewMode).toBe("family");
    expect(s.focusId).toBeNull();
    expect(s.fanLayout).toBeNull();
    expect(calls).toEqual([]);
  });

  test("entering a focus view from the family view focuses the selected person", async () => {
    const store = await open();
    store.getState().select("c2");
    store.getState().setViewMode("pedigree");
    expect(store.getState().focusId).toBe("c2");
    expect(calls).toEqual([
      { name: "pedigree", args: { focusId: "c2", collapsed: new Set(), metrics } },
    ]);
    expect(store.getState().layout?.primaryNode.c2).toBeDefined();
  });

  test("with nothing selected the focus falls back to the tree root", async () => {
    const store = await open();
    store.getState().setViewMode("hourglass");
    expect(store.getState().focusId).toBeNull();
    expect(calls[0]).toEqual({
      name: "hourglass",
      args: { focusId: "dad", collapsed: new Set(), metrics },
    });
  });

  test("descendants are drawn from the focus", async () => {
    const store = await open();
    store.getState().select("mom");
    store.getState().setViewMode("descendants");
    expect(calls[0]).toEqual({
      name: "descendants",
      args: { rootId: "mom", collapsed: new Set(), metrics },
    });
  });

  test("moving between focus views keeps the focus, whatever is selected", async () => {
    const store = await open();
    store.getState().select("c1");
    store.getState().setViewMode("pedigree");
    store.getState().select("c3");
    store.getState().setViewMode("hourglass");
    expect(store.getState().focusId).toBe("c1");
  });

  test("setFocus lays out again around the new person; strangers are ignored", async () => {
    const store = await open();
    store.getState().setViewMode("pedigree");
    calls = [];
    store.getState().setFocus("c3");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({ focusId: "c3" });
    store.getState().setFocus("nobody");
    expect(store.getState().focusId).toBe("c3");
    expect(calls).toHaveLength(1);
  });

  test("switching to the same view does nothing", async () => {
    const store = await open();
    store.getState().setViewMode("family");
    store.getState().setViewMode("pedigree");
    calls = [];
    store.getState().setViewMode("pedigree");
    expect(calls).toEqual([]);
  });

  test("collapsing a branch lays out the current view again", async () => {
    const store = await open();
    store.getState().setViewMode("descendants");
    calls = [];
    store.getState().toggleCollapse("dad");
    expect(calls[0]?.args).toMatchObject({ rootId: "dad", collapsed: new Set(["dad"]) });
  });

  test("fan lays out the fan and keeps the family layout for exports; timeline too", async () => {
    const store = await open();
    store.getState().select("c1");
    store.getState().setViewMode("fan");
    let s = store.getState();
    expect(s.fanLayout?.focusId).toBe("c1");
    expect(calls[0]).toEqual({ name: "fan", args: { focusId: "c1", generations: 4 } });
    expect(s.layout?.nodes.length).toBeGreaterThan(0);
    store.getState().setViewMode("timeline");
    s = store.getState();
    expect(s.fanLayout).toBeNull();
    expect(s.timelineLayout).toBe(TIMELINE);
    expect(calls.at(-1)).toEqual({
      name: "timeline",
      args: { rootId: "dad", now: env.now() },
    });
    store.getState().setViewMode("family");
    expect(store.getState().timelineLayout).toBeNull();
  });

  test("familyUnreachable is the family view's, whatever view is shown", async () => {
    const store = await open();
    store.getState().select("c2");
    for (const mode of ["pedigree", "descendants", "hourglass", "fan", "timeline"] as const) {
      store.getState().setViewMode(mode);
      // The fakes draw the focus's family only; the badge must not count the rest.
      expect(store.getState().familyUnreachable).toEqual([]);
    }
    store.getState().setViewRoot("c1");
    store.getState().setViewMode("pedigree");
    expect(store.getState().familyUnreachable).toEqual(["dad", "mom", "c2", "c3"]);
    store.getState().setViewMode("family");
    expect(store.getState().familyUnreachable).toEqual(store.getState().layout!.unreachable);
  });

  test("the fan shows 4 generations by default; 2 to 7 can be chosen", async () => {
    const store = await open();
    expect(store.getState().fanGenerations).toBe(4);
    store.getState().setViewMode("fan");
    calls = [];
    store.getState().setFanGenerations(6);
    expect(store.getState().fanGenerations).toBe(6);
    expect(calls).toEqual([{ name: "fan", args: { focusId: "dad", generations: 6 } }]);
    store.getState().setFanGenerations(9);
    expect(store.getState().fanGenerations).toBe(7);
    store.getState().setFanGenerations(1);
    expect(store.getState().fanGenerations).toBe(2);
  });

  test("an edit lays the current view out again", async () => {
    const store = await open();
    store.getState().setViewMode("pedigree");
    calls = [];
    store.getState().dispatch({ type: "renameTree", name: "New" }, "Rename");
    expect(calls).toHaveLength(1);
  });

  test("a focus person who is deleted falls back to the root", async () => {
    const store = await open();
    store.getState().select("c3");
    store.getState().setViewMode("pedigree");
    store.getState().dispatch({ type: "deletePerson", personId: "c3", mode: "person" }, "Delete");
    expect(store.getState().focusId).toBeNull();
  });

  test("revealing a person the focus view does not show makes them the focus", async () => {
    const store = await open();
    store.getState().select("c2");
    store.getState().setViewMode("pedigree"); // the fake draws the focus person alone
    expect(store.getState().layout?.primaryNode.c1).toBeUndefined();
    expect(store.getState().revealPerson("c1")).toBe(true);
    expect(store.getState().focusId).toBe("c1");
    expect(store.getState().viewRootId).toBeNull();
  });
});

describe("read-only views", () => {
  test.each(["fan", "timeline"] as const)(
    "%s refuses edits and undo but lets a rename through",
    async (mode) => {
      const store = await open();
      store.getState().dispatch({ type: "renameTree", name: "Before" }, "Rename");
      store.getState().setViewMode(mode);
      const person = Object.keys(store.getState().doc!.persons)[0]!;
      expect(
        store
          .getState()
          .dispatch(
            { type: "updatePerson", personId: person, patch: { firstName: "Zed" } },
            "Edit",
          ),
      ).toBeNull();
      expect(store.getState().doc?.persons[person]?.firstName).not.toBe("Zed");
      store.getState().undo();
      expect(store.getState().doc?.name).toBe("Before");
      expect(
        store.getState().dispatch({ type: "renameTree", name: "After" }, "Rename"),
      ).not.toBeNull();
      store.getState().setViewMode("family");
      store.getState().undo();
      expect(store.getState().doc?.name).toBe("Before");
    },
  );

  test("the tree-shaped views stay editable", async () => {
    const store = await open();
    store.getState().setViewMode("pedigree");
    expect(
      store
        .getState()
        .dispatch({ type: "updatePerson", personId: "c1", patch: { firstName: "Zed" } }, "Edit"),
    ).not.toBeNull();
  });
});

describe("relation", () => {
  test("opens with a pair, keeps only people who exist, and closes", async () => {
    const store = await open();
    store.getState().openRelation("c1", "ghost");
    expect(store.getState().relation).toEqual({ aId: "c1", bId: null });
    store.getState().setRelation({ bId: "c2" });
    expect(store.getState().relation).toEqual({ aId: "c1", bId: "c2" });
    store.getState().setRelation({ aId: null });
    expect(store.getState().relation).toEqual({ aId: null, bId: "c2" });
    store.getState().closeRelation();
    expect(store.getState().relation).toBeNull();
  });

  test("a person who is deleted leaves the pair", async () => {
    const store = await open();
    store.getState().openRelation("c1", "c3");
    store.getState().dispatch({ type: "deletePerson", personId: "c3", mode: "person" }, "Delete");
    expect(store.getState().relation).toEqual({ aId: "c1", bId: null });
  });
});
