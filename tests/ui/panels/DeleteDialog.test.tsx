import { afterEach, describe, expect, mock, test } from "bun:test";

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeleteDialog } from "@/ui/panels/DeleteDialog";

import { famSimple } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(cleanup);

async function open(personId: string) {
  const onClose = mock(() => {});
  const view = await renderWithStore(<DeleteDialog personId={personId} onClose={onClose} />);
  return { ...view, onClose, user: userEvent.setup() };
}

describe("DeleteDialog", () => {
  test("offers 'only' and 'and N descendants', with the count from descendantsOf", async () => {
    await open("dad");
    expect(screen.getByRole("heading", { name: /^Delete Ahmed Khan\s*\?$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Ahmed Khan only" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Delete Ahmed Khan and 3 descendants" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  test("a single descendant reads in the singular", async () => {
    const view = await renderWithStore(<DeleteDialog personId="dad" onClose={() => {}} />);
    view.store.getState().dispatch({ type: "deletePerson", personId: "c1", mode: "person" }, "x");
    view.store.getState().dispatch({ type: "deletePerson", personId: "c2", mode: "person" }, "x");
    expect(
      await screen.findByRole("button", { name: "Delete Ahmed Khan and 1 descendant" }),
    ).toBeTruthy();
  });

  test("without descendants there is only the one delete", async () => {
    await open("c1");
    expect(screen.getByRole("button", { name: "Delete Ali Khan only" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /descendant/ })).toBeNull();
  });

  test("'only' removes just that person and can be undone", async () => {
    const { user, store, commands, onClose } = await open("dad");
    await user.click(screen.getByRole("button", { name: "Delete Ahmed Khan only" }));
    expect(commands).toEqual([{ type: "deletePerson", personId: "dad", mode: "person" }]);
    const after = store.getState().doc!;
    expect(after.persons.dad).toBeUndefined();
    expect(after.persons.c1).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
    store.getState().undo();
    expect(store.getState().doc!.persons.dad).toBeTruthy();
  });

  test("'and descendants' removes the whole branch and can be undone", async () => {
    const { user, store, commands } = await open("dad");
    await user.click(screen.getByRole("button", { name: "Delete Ahmed Khan and 3 descendants" }));
    expect(commands).toEqual([{ type: "deletePerson", personId: "dad", mode: "withDescendants" }]);
    expect(Object.keys(store.getState().doc!.persons)).toEqual(["mom"]);
    store.getState().undo();
    expect(Object.keys(store.getState().doc!.persons)).toHaveLength(5);
  });

  test("Cancel and Esc delete nothing", async () => {
    const { user, commands, onClose } = await open("dad");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(commands).toEqual([]);
  });

  test("Cancel has the initial focus, so Enter never deletes", async () => {
    await open("dad");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  test("names the person with bdi", async () => {
    await open("dad");
    expect(
      screen.getByRole("button", { name: "Delete Ahmed Khan only" }).querySelector("bdi"),
    ).toBeTruthy();
  });

  test("closes itself when the person is already gone", async () => {
    const onClose = mock(() => {});
    await renderWithStore(<DeleteDialog personId="ghost" onClose={onClose} />, famSimple());
    expect(onClose).toHaveBeenCalled();
  });
});
