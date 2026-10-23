import { afterEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TreeDocument } from "@/core/model/types";
import { InlineEditor } from "@/ui/cards/InlineEditor";
import type { AddRole } from "@/ui/cards/nameEntry";
import { startAdd } from "@/ui/cards/quickAdd";
import { useEditor } from "@/ui/store/useEditor";

import { docOf, famSimple, person, union } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(cleanup);

const RECT = { x: 100, y: 200, width: 180, height: 72 };

/** Shows the inline editor for the add in progress, as the canvas overlay does. */
function Harness() {
  const editing = useEditor((s) => s.editing);
  if (!editing) return null;
  return (
    <InlineEditor
      personId={editing.personId}
      role={editing.role}
      fromId={editing.fromId}
      rect={RECT}
    />
  );
}

async function begin(role: AddRole, fromId: string, doc: TreeDocument = famSimple()) {
  const env = await renderWithStore(<Harness />, doc);
  const before = Object.keys(env.store.getState().doc!.persons).length;
  let newId: string | null = null;
  act(() => {
    newId = startAdd(env.store, role, fromId);
  });
  if (!newId) throw new Error("add refused");
  const added = () => env.store.getState().doc!.persons[newId!];
  const count = () => Object.keys(env.store.getState().doc!.persons).length;
  return { ...env, newId: newId as string, added, count, before, user: userEvent.setup() };
}

const input = () => screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
const male = () => screen.getByRole("button", { name: "Male" });
const female = () => screen.getByRole("button", { name: "Female" });

describe("InlineEditor", () => {
  test("opens over the new card with the name field focused", async () => {
    const { added } = await begin("child", "c1");
    expect(added()?.firstName).toBe("");
    expect(document.activeElement).toBe(input());
    const form = input().closest("form")!;
    // In the card's place: centred on the card, at its size (scale 1 at 100 %).
    expect(form.style.transform).toBe("translate(190px, 236px) translate(-50%, -50%) scale(1)");
  });

  test("the ✓ button confirms and the ✕ button cancels", async () => {
    const first = await begin("child", "c1");
    await first.user.type(input(), "Bilal");
    await first.user.click(male());
    await first.user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(first.added()?.firstName).toBe("Bilal");
    expect(first.store.getState().editing).toBeNull();
    cleanup();

    const second = await begin("child", "c1");
    await second.user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(second.store.getState().editing).toBeNull();
    expect(second.count()).toBe(second.before);
  });

  test("a missing gender is a small hint under the card, tied to the name field", async () => {
    const { user } = await begin("child", "c1");
    await user.type(input(), "Bilal{Enter}");
    const hint = screen.getByRole("alert");
    expect(hint.classList).toContain("inline-editor__hint");
    expect(input().getAttribute("aria-describedby")).toBe(hint.id);
  });

  test("Enter with no gender chosen for a child shows 'Choose ♂ or ♀' and does not commit", async () => {
    const { user, added, store } = await begin("child", "c1");
    expect(male().getAttribute("aria-pressed")).toBe("false");
    expect(female().getAttribute("aria-pressed")).toBe("false");
    await user.type(input(), "Bilal{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("Choose ♂ or ♀");
    expect(added()?.firstName).toBe("");
    expect(store.getState().editing).not.toBeNull();
    expect(input().value).toBe("Bilal");
  });

  test("choosing a gender returns to the name; Enter then commits with the inherited last name", async () => {
    const { user, added, store, newId } = await begin("child", "c1");
    await user.type(input(), "Bilal");
    await user.click(male());
    expect(male().getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(input());
    await user.keyboard("{Enter}");
    expect(added()).toMatchObject({ firstName: "Bilal", lastName: "Khan", gender: "male" });
    expect(store.getState().editing).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    // One undo takes the whole addition away.
    act(() => store.getState().undo());
    expect(store.getState().doc!.persons[newId]).toBeUndefined();
  });

  test("two or more words: the last word is the last name, nothing is inherited", async () => {
    const { user, added } = await begin("child", "c1");
    await user.click(female());
    await user.type(input(), "Noor Fatima Raza{Enter}");
    expect(added()).toMatchObject({ firstName: "Noor Fatima", lastName: "Raza", gender: "female" });
  });

  test("Esc calls cancelLastAdd: nothing is left behind and there is nothing to redo", async () => {
    const { user, store, count, before } = await begin("child", "c1");
    const cancel = mock(store.getState().cancelLastAdd);
    store.setState({ cancelLastAdd: cancel });
    await user.type(input(), "Bilal{Escape}");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(count()).toBe(before);
    expect(store.getState().editing).toBeNull();
    expect(store.getState().canRedo).toBe(false);
  });

  test("Enter on a blank name cancels the add", async () => {
    const { user, count, before, store } = await begin("child", "c1");
    await user.click(male());
    await user.type(input(), "   {Enter}");
    expect(count()).toBe(before);
    expect(store.getState().editing).toBeNull();
  });

  test("a spouse gets the opposite gender preselected and keeps their own last name", async () => {
    const { user, added } = await begin("spouse", "c1");
    expect(female().getAttribute("aria-pressed")).toBe("true");
    await user.type(input(), "Hina{Enter}");
    expect(added()).toMatchObject({ firstName: "Hina", lastName: "", gender: "female" });
  });

  test("a parent is preselected opposite to the existing parent", async () => {
    const doc = docOf(
      [person("mom", "Sara", "Khan", "female"), person("kid", "Ali", "Khan", "male")],
      [union("u1", ["mom"], ["kid"])],
      "mom",
    );
    const { user, added } = await begin("parent", "kid", doc);
    expect(male().getAttribute("aria-pressed")).toBe("true");
    await user.type(input(), "Ahmed Khan{Enter}");
    expect(added()).toMatchObject({ firstName: "Ahmed", lastName: "Khan", gender: "male" });
  });

  test("a first parent must be chosen", async () => {
    const { user, added } = await begin("parent", "dad");
    await user.type(input(), "Yusuf Khan{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("Choose ♂ or ♀");
    await user.click(male());
    await user.keyboard("{Enter}");
    expect(added()).toMatchObject({ firstName: "Yusuf", gender: "male" });
  });

  test("a sibling inherits the last name of the person whose handle was used", async () => {
    const { user, added } = await begin("sibling", "c2");
    await user.click(female());
    await user.type(input(), "Amna{Enter}");
    expect(added()).toMatchObject({ firstName: "Amna", lastName: "Khan" });
  });

  test("leaving the editor with a complete entry confirms it; with a blank name cancels", async () => {
    const first = await begin("spouse", "c1");
    await first.user.type(input(), "Hina Raza");
    act(() => input().blur());
    expect(first.added()).toMatchObject({ firstName: "Hina", lastName: "Raza" });
    cleanup();

    const second = await begin("spouse", "c1");
    act(() => input().blur());
    expect(second.count()).toBe(second.before);
  });

  test("leaving with a name but no gender keeps the editor open with the message", async () => {
    const { user, store } = await begin("child", "c1");
    await user.type(input(), "Bilal");
    act(() => input().blur());
    expect(store.getState().editing).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Choose ♂ or ♀");
  });
});
