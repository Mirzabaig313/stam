import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TreeDocument } from "@/core/model/types";
import { Toolbar } from "@/ui/app/Toolbar";
import { createEditorStore, type EditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { docOf, famRemarriage, famSimple, person, union } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

let env: Awaited<ReturnType<typeof makeEditorEnv>>;
const noop = () => {};

afterEach(cleanup);
beforeEach(async () => {
  env = await makeEditorEnv();
});

async function mount(doc: TreeDocument = famSimple()): Promise<EditorStore> {
  await env.repo.saveTree(doc);
  const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
  await store.getState().load(doc.id);
  renderApp(
    <EditorContext.Provider value={store}>
      <Toolbar
        autosaver={env.autosaver}
        onZoomIn={noop}
        onZoomOut={noop}
        onFit={noop}
        onOpenSearch={noop}
        onOpenUnconnected={noop}
      />
    </EditorContext.Provider>,
    { repo: env.repo },
  );
  return store;
}

const addButton = () => screen.getByRole("button", { name: "Add person" });
const itemNames = () =>
  [...screen.getByRole("menu").querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);

describe("+ Add person", () => {
  test("an empty tree starts its first person at once, with no chooser", async () => {
    const store = await mount(docOf([], [], undefined));
    expect(addButton().getAttribute("aria-haspopup")).toBeNull();
    await userEvent.setup().click(addButton());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(Object.keys(store.getState().doc!.persons)).toHaveLength(1);
    expect(store.getState().editing?.role).toBe("first");
  });

  test("with somebody selected it offers parent, spouse, child and sibling, in that order", async () => {
    const store = await mount();
    act(() => store.getState().select("c1"));
    const user = userEvent.setup();
    await user.click(addButton());
    expect(addButton().getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Add to Ali Khan" });
    expect(within(menu).getByText("Ali Khan").tagName).toBe("BDI");
    expect(itemNames()).toEqual(["Parent", "Spouse", "Child", "Sibling"]);
    await user.click(screen.getByRole("menuitem", { name: "Child" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(store.getState().editing).toMatchObject({ role: "child", fromId: "c1" });
  });

  test("a spouse is added through the same command as the card's handle", async () => {
    const store = await mount();
    act(() => store.getState().select("c2"));
    const user = userEvent.setup();
    await user.click(addButton());
    await user.click(screen.getByRole("menuitem", { name: "Spouse" }));
    const editing = store.getState().editing!;
    expect(editing).toMatchObject({ role: "spouse", fromId: "c2" });
    // One undo removes the new spouse: it was one history entry.
    act(() => store.getState().stopEditing());
    act(() => store.getState().undo());
    expect(store.getState().doc!.persons[editing.personId]).toBeUndefined();
  });

  test("only adds the view can draw: the pedigree offers parents", async () => {
    const store = await mount();
    act(() => {
      store.getState().select("dad");
      store.getState().setViewMode("pedigree");
    });
    await userEvent.setup().click(addButton());
    expect(itemNames()).toEqual(["Parent"]);
  });

  test("Parent adds a person above: between a person and the parent they have", async () => {
    const doc = docOf(
      [person("ismail", "Ismail", "Khan", "male"), person("haider", "Haider", "Khan", "male")],
      [union("u", ["ismail"], ["haider"], "partner")],
      "ismail",
    );
    const store = await mount(doc);
    act(() => store.getState().select("haider"));
    const user = userEvent.setup();
    await user.click(addButton());
    await user.click(screen.getByRole("menuitem", { name: "Parent" }));
    expect(store.getState().editing).toMatchObject({ role: "between", fromId: "haider" });
    const editing = store.getState().editing!;
    expect(store.getState().doc!.unions["u"]!.children[0]!.personId).toBe(editing.personId);
  });

  test("a person with several families gets one child item per family", async () => {
    const doc = famRemarriage();
    const store = await mount(doc);
    const [personId] = Object.entries(doc.unionOrder).find(([, ids]) => ids.length >= 2)!;
    act(() => store.getState().select(personId));
    const user = userEvent.setup();
    await user.click(addButton());
    const children = itemNames().filter((name) => name?.startsWith("Child with"));
    expect(children).toHaveLength(doc.unionOrder[personId]!.length);
    await user.click(screen.getByRole("menuitem", { name: children[1]! }));
    expect(store.getState().editing).toMatchObject({ role: "child", fromId: personId });
  });

  test("with nobody selected it says so, and offers a person not connected yet", async () => {
    const store = await mount();
    const user = userEvent.setup();
    await user.click(addButton());
    const menu = screen.getByRole("menu", { name: "Select someone first" });
    expect(within(menu).getByText("Select someone first")).toBeTruthy();
    expect(itemNames()).toEqual(["Add someone not connected yet"]);
    const before = Object.keys(store.getState().doc!.persons).length;
    await user.click(screen.getByRole("menuitem", { name: "Add someone not connected yet" }));
    expect(Object.keys(store.getState().doc!.persons)).toHaveLength(before + 1);
    expect(store.getState().editing?.role).toBe("first");
  });

  test("a refused add says why", async () => {
    const store = await mount();
    act(() => store.getState().select("c1"));
    // The model refuses (as it would a cycle): the store keeps the reason.
    store.setState({
      dispatch: () => {
        store.setState({ error: "PARENTS_FULL" });
        return null;
      },
    });
    const user = userEvent.setup();
    await user.click(addButton());
    await user.click(screen.getByRole("menuitem", { name: "Sibling" }));
    expect(screen.getByRole("alert").textContent).toBe("This person already has two parents.");
    expect(store.getState().editing).toBeNull();
  });

  test("the fan and timeline are read-only: the button is off", async () => {
    const store = await mount();
    act(() => store.getState().setViewMode("fan"));
    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
    act(() => store.getState().setViewMode("family"));
    expect((addButton() as HTMLButtonElement).disabled).toBe(false);
  });

  test("a second press on the button closes the chooser", async () => {
    const store = await mount();
    act(() => store.getState().select("c1"));
    const user = userEvent.setup();
    await user.click(addButton());
    await user.click(addButton());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("Escape closes the chooser and gives the focus back", async () => {
    const store = await mount();
    act(() => store.getState().select("c1"));
    const user = userEvent.setup();
    await user.click(addButton());
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(addButton());
  });
});
