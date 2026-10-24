import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { backupFileName } from "@/io/json/stamJson";
import { createAutosaver } from "@/storage/autosave";
import type { BackupState } from "@/storage/backupReminder";
import { Toolbar } from "@/ui/app/Toolbar";
import { createEditorStore, type EditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { docOf, famSimple, person } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;
const noop = () => {};

afterEach(cleanup);

beforeEach(async () => {
  env = await makeEditorEnv();
});

function callbacks() {
  const calls = { zoomIn: 0, zoomOut: 0, fit: 0, search: 0, unconnected: 0 };
  return {
    calls,
    props: {
      onZoomIn: () => calls.zoomIn++,
      onZoomOut: () => calls.zoomOut++,
      onFit: () => calls.fit++,
      onOpenSearch: () => calls.search++,
      onOpenUnconnected: () => calls.unconnected++,
    },
  };
}

async function mountToolbar(
  doc = famSimple(),
  autosaver: Env["autosaver"] = env.autosaver,
): Promise<{ store: EditorStore; calls: ReturnType<typeof callbacks>["calls"] }> {
  await env.repo.saveTree(doc);
  const store = createEditorStore({ repo: env.repo, autosaver, now: env.now });
  await store.getState().load(doc.id);
  const { calls, props } = callbacks();
  renderApp(
    <EditorContext.Provider value={store}>
      <Toolbar autosaver={autosaver} {...props} />
    </EditorContext.Provider>,
    { repo: env.repo },
  );
  return { store, calls };
}

describe("tree name", () => {
  test("shows the name and links back to the tree list", async () => {
    await mountToolbar();
    expect(screen.getByRole("button", { name: /^Rename tree/ }).textContent).toBe("Fixture");
    expect(screen.getByRole("link", { name: "My trees" }).getAttribute("href")).toBe("/app");
  });

  test("renaming is one undoable command", async () => {
    const { store } = await mountToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    const input = screen.getByRole("textbox", { name: "Tree name" });
    await user.clear(input);
    await user.type(input, "Khan line{Enter}");
    expect(store.getState().doc!.name).toBe("Khan line");
    expect(screen.getByRole("button", { name: /^Rename tree/ }).textContent).toBe("Khan line");
    store.getState().undo();
    expect(store.getState().doc!.name).toBe("Fixture");
    expect(store.getState().canUndo).toBe(false);
  });

  test("Escape and an empty name leave the name alone", async () => {
    const { store } = await mountToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    await user.type(screen.getByRole("textbox", { name: "Tree name" }), "zzz{Escape}");
    expect(store.getState().doc!.name).toBe("Fixture");
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    await user.clear(screen.getByRole("textbox", { name: "Tree name" }));
    await user.keyboard("{Enter}");
    expect(store.getState().doc!.name).toBe("Fixture");
    expect(store.getState().canUndo).toBe(false);
  });
});

describe("tree name editing edge cases", () => {
  test("a rename after an Escape still commits, exactly once", async () => {
    const { store } = await mountToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    await user.type(screen.getByRole("textbox", { name: "Tree name" }), "zzz{Escape}");
    expect(store.getState().doc!.name).toBe("Fixture");
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    const input = screen.getByRole("textbox", { name: "Tree name" });
    await user.clear(input);
    await user.type(input, "New name{Enter}");
    expect(store.getState().doc!.name).toBe("New name");
    store.getState().undo();
    expect(store.getState().doc!.name).toBe("Fixture");
    expect(store.getState().canUndo).toBe(false);
  });

  test("a blur that follows Enter does not rename twice", async () => {
    const { store } = await mountToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    const input = screen.getByRole("textbox", { name: "Tree name" });
    await user.clear(input);
    await user.type(input, "Once");
    await user.keyboard("{Enter}");
    // Browsers that blur on removal call the handler again; simulate it on the old input.
    fireEvent.blur(input);
    store.getState().undo();
    expect(store.getState().doc!.name).toBe("Fixture");
    expect(store.getState().canUndo).toBe(false);
  });

  test("clicking away commits the new name", async () => {
    const { store } = await mountToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    const input = screen.getByRole("textbox", { name: "Tree name" });
    await user.clear(input);
    await user.type(input, "Away");
    await user.click(document.body);
    expect(store.getState().doc!.name).toBe("Away");
  });
});

describe("accessibility", () => {
  test("the toolbar is a plain header, not an ARIA toolbar", async () => {
    await mountToolbar();
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  test("the More button says it opens a menu and whether it is open", async () => {
    await mountToolbar();
    const button = screen.getByRole("button", { name: "More" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await userEvent.setup().click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
  });

  test("a second press on More closes the menu instead of reopening it", async () => {
    await mountToolbar();
    const user = await openMenu();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  test("Escape closes the menu and puts focus back on its button", async () => {
    await mountToolbar();
    const user = await openMenu();
    const button = screen.getByRole("button", { name: "More" });
    // The first item has the focus.
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemcheckbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  test("every More item has an icon and a label", async () => {
    await mountToolbar();
    await openMenu();
    const items = [...screen.getByRole("menu").querySelectorAll('[role^="menuitem"]')];
    const names = items.map((item) => item.textContent?.replace(/⌘E|Ctrl\+E/, "").trim());
    expect(names).toEqual([
      "Focus mode",
      "Save to my account",
      "Download backup (.json)",
      "Download backup with photos",
      "Settings",
    ]);
    for (const item of items) expect(item.querySelector("svg.icon")).toBeTruthy();
  });

  test("the zoom buttons are one labelled group, in the order − fit +", async () => {
    await mountToolbar();
    const group = screen.getByRole("group", { name: "Zoom" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Zoom out", "Fit tree to screen", "Zoom in"]);
  });
});

describe("undo, redo and view buttons", () => {
  test("undo and redo follow the history", async () => {
    const { store } = await mountToolbar();
    const user = userEvent.setup();
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    const redo = screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    act(() => void store.getState().dispatch({ type: "renameTree", name: "B" }, "Rename"));
    expect(undo.disabled).toBe(false);
    await user.click(undo);
    expect(store.getState().doc!.name).toBe("Fixture");
    expect(redo.disabled).toBe(false);
    await user.click(redo);
    expect(store.getState().doc!.name).toBe("B");
  });

  test("zoom, fit and search call the props", async () => {
    const { calls } = await mountToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Fit tree to screen" }));
    await user.click(screen.getByRole("button", { name: "Search people" }));
    expect(calls).toMatchObject({ zoomIn: 1, zoomOut: 1, fit: 1, search: 1 });
  });

  test("the focus mode item in More reflects and sets the store", async () => {
    const { store } = await mountToolbar();
    let user = await openMenu();
    const toggle = screen.getByRole("menuitemcheckbox", { name: "Focus mode" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    expect(store.getState().focusMode).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    user = await openMenu();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Focus mode" }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});

describe("unconnected badge", () => {
  test("is absent when everyone is connected", async () => {
    await mountToolbar();
    expect(screen.queryByText(/not connected/)).toBeNull();
  });

  test("counts people the tree does not reach and opens the list", async () => {
    const base = famSimple();
    const doc = docOf(
      [
        ...Object.values(base.persons),
        person("l1", "Lost", "One", "male"),
        person("l2", "Lost", "Two", "female"),
      ],
      Object.values(base.unions),
      "dad",
    );
    const { calls } = await mountToolbar(doc);
    await userEvent.setup().click(screen.getByRole("button", { name: /2 not connected. Show/ }));
    expect(screen.getByText("2 not connected")).toBeTruthy();
    expect(calls.unconnected).toBe(1);
  });
});

describe("breadcrumb", () => {
  test("appears under a view root and returns to the tree root", async () => {
    const { store } = await mountToolbar();
    expect(screen.queryByText(/Back to/)).toBeNull();
    act(() => store.getState().setViewRoot("c1"));
    const back = screen.getByRole("button", { name: /Back to/ });
    expect(back.textContent).toBe("← Back to Ahmed Khan");
    expect(back.querySelector("bdi")?.textContent).toBe("Ahmed Khan");
    await userEvent.setup().click(back);
    expect(store.getState().viewRootId).toBeNull();
    expect(screen.queryByText(/Back to/)).toBeNull();
  });

  test("a view root that is the tree root itself shows no breadcrumb (M2)", async () => {
    const { store } = await mountToolbar();
    act(() => store.getState().setViewRoot("dad"));
    expect(screen.queryByText(/Back to/)).toBeNull();
  });
});

const status = () => screen.getByText(/^(Saved|Saving…|Couldn't save)$/);
const noStatus = () => screen.queryByText(/^(Saved|Saving…|Couldn't save)$/);

describe("save status", () => {
  test("says nothing before any edit", async () => {
    await mountToolbar();
    expect(noStatus()).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("says Saving… from the first change, through the debounce, then Saved", async () => {
    const { store } = await mountToolbar();
    act(() => void store.getState().dispatch({ type: "renameTree", name: "B" }, "Rename"));
    // The save is still waiting on its 500 ms debounce: never "Saved" while a change is unsaved.
    expect(status().textContent).toBe("Saving…");
    await act(() => env.clock.advance(400));
    expect(status().textContent).toBe("Saving…");
    await act(() => env.clock.advance(200));
    await waitFor(() => expect(status().textContent).toBe("Saved"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a second edit during the save keeps it at Saving… until that one lands", async () => {
    const { store } = await mountToolbar();
    act(() => void store.getState().dispatch({ type: "renameTree", name: "B" }, "Rename"));
    await act(() => env.clock.advance(600));
    await waitFor(() => expect(status().textContent).toBe("Saved"));
    act(() => void store.getState().dispatch({ type: "renameTree", name: "C" }, "Rename"));
    expect(status().textContent).toBe("Saving…");
    await act(() => env.autosaver.flush());
    await waitFor(() => expect(status().textContent).toBe("Saved"));
  });

  test("shows Saving… while a save runs; only Couldn't save is announced", async () => {
    let release: () => void = noop;
    let fail = false;
    const autosaver = createAutosaver(
      () =>
        new Promise<void>((resolve, reject) => {
          release = fail ? () => reject(new Error("disk")) : resolve;
        }),
      { timers: env.clock.timers },
    );
    const { store } = await mountToolbar(famSimple(), autosaver);
    act(() => void store.getState().dispatch({ type: "renameTree", name: "B" }, "Rename"));
    const flushed = autosaver.flush().catch(noop);
    await waitFor(() => expect(status().textContent).toBe("Saving…"));
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      release();
      await flushed;
    });
    expect(status().textContent).toBe("Saved");

    fail = true;
    act(() => void store.getState().dispatch({ type: "renameTree", name: "C" }, "Rename"));
    const failed = autosaver.flush().catch(noop);
    await waitFor(() => expect(status().textContent).toBe("Saving…"));
    await act(async () => {
      release();
      await failed;
    });
    expect(screen.getByRole("status").textContent).toBe("Couldn't save");
  });
});

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More" }));
  return user;
}

describe("download backup", () => {
  let blobs: Blob[];
  let anchors: { download: string }[];

  beforeEach(() => {
    blobs = [];
    anchors = [];
    URL.createObjectURL = ((blob: Blob) => {
      blobs.push(blob);
      return "blob:fake";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => {};
    spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push({ download: this.download });
    });
  });

  test("downloads a named .stam.json file and records the backup", async () => {
    const { store } = await mountToolbar();
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Download backup (.json)" }));
    await waitFor(() => expect(anchors).toHaveLength(1));
    expect(anchors[0]!.download).toBe(backupFileName(store.getState().doc!));
    const file = JSON.parse(await blobs[0]!.text());
    expect(file.format).toBe("stam");
    expect(file.tree.id).toBe("doc");
    expect(file.photos).toBeUndefined();
    await waitFor(async () => {
      const state = await env.repo.getSetting<BackupState>("backup");
      expect(state?.lastBackupAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  test("includes photos only from the with-photos item", async () => {
    const base = famSimple();
    const doc = {
      ...base,
      persons: { ...base.persons, dad: { ...base.persons.dad!, photoId: "p1" } },
    };
    // fake-indexeddb under happy-dom drops a stored Blob's bytes, so serve a real one.
    spyOn(env.repo, "getPhoto").mockResolvedValue(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    );
    await mountToolbar(doc);
    let user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Download backup (.json)" }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(JSON.parse(await blobs[0]!.text()).photos).toBeUndefined();
    user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Download backup with photos" }));
    await waitFor(() => expect(blobs).toHaveLength(2));
    const file = JSON.parse(await blobs[1]!.text());
    expect(Object.keys(file.photos)).toEqual(["p1"]);
    expect(file.photos.p1).toStartWith("data:image/png;base64,");
  });

  test("the menu closes on Escape", async () => {
    await mountToolbar();
    const user = await openMenu();
    expect(screen.getByRole("menuitem", { name: "Download backup (.json)" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: "Download backup (.json)" })).toBeNull();
  });
});

describe("fan generations", () => {
  test("a 2–7 stepper shows in the fan view only, starting at 4", async () => {
    const { store } = await mountToolbar();
    expect(screen.queryByRole("group", { name: "Generations" })).toBeNull();
    act(() => store.getState().setViewMode("fan"));
    const group = screen.getByRole("group", { name: "Generations" });
    expect(within(group).getByText("4")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(within(group).getByRole("button", { name: "More generations" }));
    expect(store.getState().fanGenerations).toBe(5);
    await user.click(within(group).getByRole("button", { name: "Fewer generations" }));
    await user.click(within(group).getByRole("button", { name: "Fewer generations" }));
    await user.click(within(group).getByRole("button", { name: "Fewer generations" }));
    expect(store.getState().fanGenerations).toBe(2);
    const fewer = within(group).getByRole("button", { name: "Fewer generations" });
    expect((fewer as HTMLButtonElement).disabled).toBe(true);
    act(() => store.getState().setFanGenerations(7));
    const more = within(group).getByRole("button", { name: "More generations" });
    expect((more as HTMLButtonElement).disabled).toBe(true);
  });

  test("zoom and fit stay on in the fan and timeline views", async () => {
    const { store, calls } = await mountToolbar();
    act(() => store.getState().setViewMode("timeline"));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: /^Fit/ }));
    expect([calls.zoomIn, calls.zoomOut, calls.fit]).toEqual([1, 1, 1]);
  });
});
