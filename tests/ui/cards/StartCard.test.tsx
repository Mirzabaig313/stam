import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, screen, waitFor } from "@testing-library/react";

import { createTree } from "@/core/model/tree";

import { cardOf, nameInput, renderEditorCanvas, withFakeCanvasSize } from "./quickAddEnv";

withFakeCanvasSize();
afterEach(cleanup);

const start = () => screen.getByRole("button", { name: "Start with a person" });

describe("empty tree", () => {
  test("shows a single 'Start with a person' card", async () => {
    await renderEditorCanvas(createTree("Empty"));
    expect(start()).toBeTruthy();
  });

  test("the card opens the inline editor; Enter creates the root, its gender from the name", async () => {
    const { store, user } = await renderEditorCanvas(createTree("Empty"));
    await user.click(start());
    expect(document.activeElement).toBe(nameInput());
    expect(store.getState().editing?.role).toBe("first");

    await user.type(nameInput(), "Ahmed Khan{Enter}");

    const doc = store.getState().doc!;
    const [id] = Object.keys(doc.persons);
    expect(doc.persons[id!]).toMatchObject({
      firstName: "Ahmed",
      lastName: "Khan",
      gender: "male",
    });
    expect(doc.rootPersonId).toBe(id!);
    expect(document.activeElement).toBe(cardOf(id!));
  });

  test("Esc goes back to the start card with nothing created", async () => {
    const { store, user } = await renderEditorCanvas(createTree("Empty"));
    await user.click(start());
    await user.keyboard("{Escape}");
    expect(Object.keys(store.getState().doc!.persons)).toEqual([]);
    expect(store.getState().canUndo).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(start()));
  });
});
