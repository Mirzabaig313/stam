import { afterEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup } from "@testing-library/react";

import { useEditorKeys } from "@/ui/app/useEditorKeys";

import { famSimple } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";
import { cardOf, renderEditorCanvas, withFakeCanvasSize } from "../cards/quickAddEnv";

withFakeCanvasSize();
afterEach(cleanup);

const childOrder = (doc: { unions: Record<string, { children: { personId: string }[] }> }) =>
  doc.unions.u1!.children.map((c) => c.personId);

/** One edit to undo: Ali gets a nickname. */
function edit(store: Awaited<ReturnType<typeof renderEditorCanvas>>["store"]) {
  act(() => {
    store
      .getState()
      .dispatch({ type: "updatePerson", personId: "c1", patch: { nickname: "Al" } }, "e");
  });
}

describe("editor shortcuts", () => {
  test("Ctrl+Z and Cmd+Z undo; Shift+Ctrl+Z, Shift+Cmd+Z and Ctrl+Y redo", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    const nick = () => store.getState().doc!.persons.c1!.nickname;
    edit(store);
    await user.keyboard("{Control>}z{/Control}");
    expect(nick()).toBeUndefined();
    await user.keyboard("{Shift>}{Control>}z{/Control}{/Shift}");
    expect(nick()).toBe("Al");
    await user.keyboard("{Meta>}z{/Meta}");
    expect(nick()).toBeUndefined();
    await user.keyboard("{Control>}y{/Control}");
    expect(nick()).toBe("Al");
    await user.keyboard("{Meta>}z{/Meta}");
    await user.keyboard("{Shift>}{Meta>}z{/Meta}{/Shift}");
    expect(nick()).toBe("Al");
  });

  test("shortcuts are ignored while a text field has the focus", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    edit(store);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    await user.keyboard("{Control>}z{/Control}");
    expect(store.getState().doc!.persons.c1!.nickname).toBe("Al");
    act(() => store.getState().select("c1"));
    await user.keyboard("{Escape}");
    expect(store.getState().selectedId).toBe("c1");
    field.remove();
  });

  test("arrow keys move the focus between cards with nextFocus", async () => {
    const { user } = await renderEditorCanvas(famSimple());
    act(() => cardOf("c1").focus());
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cardOf("c2"));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(cardOf("c1"));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(cardOf("dad"));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(cardOf("c1"));
  });

  test("with nothing focused, arrows start from the selected person", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    act(() => store.getState().select("c2"));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cardOf("c3"));
  });

  test("in RTL, Left and Right follow what the user sees", async () => {
    const { user } = await renderEditorCanvas(famSimple(), { dir: "rtl" });
    act(() => cardOf("c2").focus());
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cardOf("c1"));
  });

  test("Enter selects the focused card (which opens the panel); Esc clears the selection", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    act(() => cardOf("c2").focus());
    await user.keyboard("{Enter}");
    expect(store.getState().selectedId).toBe("c2");
    await user.keyboard("{Escape}");
    expect(store.getState().selectedId).toBeNull();
  });

  test("Alt+Right moves the focused child one place later, as one undo step", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    act(() => cardOf("c1").focus());
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(childOrder(store.getState().doc!)).toEqual(["c2", "c1", "c3"]);
    expect(document.activeElement).toBe(cardOf("c1"));
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(childOrder(store.getState().doc!)).toEqual(["c1", "c2", "c3"]);
    // Already first: nothing to do, nothing recorded.
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    act(() => store.getState().undo());
    expect(childOrder(store.getState().doc!)).toEqual(["c2", "c1", "c3"]);
  });

  test("in RTL, Alt+Left moves the child later", async () => {
    const { store, user } = await renderEditorCanvas(famSimple(), { dir: "rtl" });
    act(() => cardOf("c1").focus());
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(childOrder(store.getState().doc!)).toEqual(["c2", "c1", "c3"]);
  });
});

/** A key press as an Arabic keyboard layout reports it: an Arabic `key`, the physical `code`. */
function press(code: string, key: string, mods: KeyboardEventInit = {}) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...mods }),
    );
  });
}

function Keys(props: { onOpenSearch: () => void; onOpenExport: () => void }) {
  useEditorKeys({ ...props, onRequestDelete: () => {} });
  return null;
}

describe("shortcuts on non-Latin keyboard layouts", () => {
  test("undo and redo follow the physical Z and Y keys (Arabic layout)", async () => {
    const { store } = await renderEditorCanvas(famSimple());
    const nick = () => store.getState().doc!.persons.c1!.nickname;
    edit(store);
    press("KeyZ", "ئ", { ctrlKey: true });
    expect(nick()).toBeUndefined();
    press("KeyY", "غ", { ctrlKey: true });
    expect(nick()).toBe("Al");
    press("KeyZ", "ئ", { metaKey: true });
    expect(nick()).toBeUndefined();
    press("KeyZ", "ئ", { metaKey: true, shiftKey: true });
    expect(nick()).toBe("Al");
  });

  test("search and export follow the physical F and E keys (Urdu layout)", async () => {
    const search = mock(() => {});
    const exp = mock(() => {});
    await renderWithStore(<Keys onOpenSearch={search} onOpenExport={exp} />, famSimple());
    press("KeyF", "ف", { ctrlKey: true });
    press("KeyE", "ع", { metaKey: true });
    expect(search).toHaveBeenCalledTimes(1);
    expect(exp).toHaveBeenCalledTimes(1);
  });

  test("a Latin layout's letters still win over the physical key (AZERTY Ctrl+Z)", async () => {
    const { store } = await renderEditorCanvas(famSimple());
    const nick = () => store.getState().doc!.persons.c1!.nickname;
    edit(store);
    // On AZERTY the key labelled Z is where QWERTY has W.
    press("KeyW", "z", { ctrlKey: true });
    expect(nick()).toBeUndefined();
    // …and the key in QWERTY's Z place types "w": not undo.
    edit(store);
    press("KeyZ", "w", { ctrlKey: true });
    expect(nick()).toBe("Al");
  });
});
