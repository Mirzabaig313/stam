import { afterEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { validDropActions } from "@/core/commands/validActions";
import type { TreeDocument } from "@/core/model/types";
import { DropMenu, type RenderUnionChoice } from "@/ui/dnd/DropMenu";

import { docOf, famRemarriage, famSimple, person, union } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(cleanup);

/** Grandfather Gul, his son Pervez, and Pervez's son Gohar. */
function threeGenerations(): TreeDocument {
  return docOf(
    [
      person("gp", "Gul", "Khan", "male"),
      person("p", "Pervez", "Khan", "male"),
      person("gc", "Gohar", "Khan", "male"),
    ],
    [union("u1", ["gp"], ["p"]), union("u2", ["p"], ["gc"])],
    "gp",
  );
}

/** famSimple plus an unrelated person `x` (Xara Malik). */
function withStranger(base: TreeDocument = famSimple()): TreeDocument {
  return {
    ...base,
    persons: { ...base.persons, x: person("x", "Xara", "Malik", "female") },
  };
}

const stubChoice: RenderUnionChoice = (parentId, unionIds, onChoose, onCancel) => (
  <div data-testid="union-choice" data-parent={parentId}>
    {unionIds.map((id) => (
      <button key={id} type="button" onClick={() => onChoose(id)}>
        {`union ${id}`}
      </button>
    ))}
    <button type="button" onClick={onCancel}>
      stub cancel
    </button>
  </div>
);

async function openMenu(doc: TreeDocument, draggedId: string, targetId: string) {
  const onClose = mock(() => {});
  const renderUnionChoice = mock(stubChoice);
  const env = await renderWithStore(
    <DropMenu
      draggedId={draggedId}
      targetId={targetId}
      at={[200, 150]}
      onClose={onClose}
      renderUnionChoice={renderUnionChoice}
    />,
    doc,
  );
  return { ...env, onClose, renderUnionChoice };
}

const items = () => screen.queryAllByRole("menuitem").map((el) => el.textContent);

describe("DropMenu", () => {
  test("lists only the allowed actions, named after the target", async () => {
    const doc = threeGenerations();
    expect(validDropActions(doc, "gc", "gp")).toEqual(["child"]);
    await openMenu(doc, "gc", "gp");
    expect(screen.getByRole("menu", { name: "Move Gohar Khan" })).toBeDefined();
    expect(items()).toEqual(["Make child of Gul Khan"]);
  });

  test("offers all three when all are allowed, in menu order", async () => {
    await openMenu(withStranger(), "c1", "x");
    expect(items()).toEqual([
      "Make child of Xara Malik",
      "Make spouse of Xara Malik",
      "Make parent of Xara Malik",
    ]);
  });

  test("the first item has the focus", async () => {
    await openMenu(withStranger(), "c1", "x");
    expect(document.activeElement?.textContent).toBe("Make child of Xara Malik");
  });

  test("'Make spouse' dispatches relinkAsSpouse as one undo step", async () => {
    const doc = withStranger();
    const { commands, store, onClose } = await openMenu(doc, "c1", "x");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make spouse of Xara Malik" }));
    expect(commands).toEqual([{ type: "relinkAsSpouse", personId: "c1", targetId: "x" }]);
    expect(onClose).toHaveBeenCalledTimes(1);
    const after = store.getState().doc!;
    expect(Object.values(after.unions).some((u) => u.partners.includes("x"))).toBe(true);
    act(() => store.getState().undo());
    expect(store.getState().doc!.unions).toEqual(doc.unions);
    expect(store.getState().canUndo).toBe(false);
  });

  test("'Make parent' dispatches relinkAsParent", async () => {
    const { commands } = await openMenu(withStranger(), "c1", "x");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make parent of Xara Malik" }));
    expect(commands).toEqual([{ type: "relinkAsParent", personId: "c1", childId: "x" }]);
  });

  test("'Make child' of someone without unions dispatches without a union id", async () => {
    const { commands } = await openMenu(withStranger(), "c1", "x");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make child of Xara Malik" }));
    expect(commands).toEqual([{ type: "relinkAsChild", personId: "c1", parentId: "x" }]);
  });

  test("'Make child' of someone with one usable union uses it directly", async () => {
    const { commands, renderUnionChoice } = await openMenu(threeGenerations(), "gc", "gp");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make child of Gul Khan" }));
    expect(renderUnionChoice).not.toHaveBeenCalled();
    expect(commands).toEqual([
      { type: "relinkAsChild", personId: "gc", parentId: "gp", unionId: "u1" },
    ]);
  });

  test("'Make child' of someone with two unions asks which one, with only usable unions", async () => {
    const doc = withStranger(famRemarriage());
    const { commands, renderUnionChoice, onClose } = await openMenu(doc, "x", "ali");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make child of Ali Raza" }));
    expect(commands).toEqual([]);
    expect(renderUnionChoice).toHaveBeenCalled();
    expect(renderUnionChoice.mock.calls.at(-1)!.slice(0, 2)).toEqual(["ali", ["m1", "m2"]]);
    fireEvent.click(screen.getByRole("button", { name: "union m2" }));
    expect(commands).toEqual([
      { type: "relinkAsChild", personId: "x", parentId: "ali", unionId: "m2" },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("cancelling the union choice closes without a command", async () => {
    const doc = withStranger(famRemarriage());
    const { commands, onClose } = await openMenu(doc, "x", "ali");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make child of Ali Raza" }));
    fireEvent.click(screen.getByRole("button", { name: "stub cancel" }));
    expect(commands).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Esc closes without a command", async () => {
    const { commands, onClose } = await openMenu(withStranger(), "c1", "x");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commands).toEqual([]);
  });

  test("arrow keys move between the items", async () => {
    await openMenu(withStranger(), "c1", "x");
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Make spouse of Xara Malik");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Make parent of Xara Malik");
  });

  test("a press outside closes it", async () => {
    const { onClose } = await openMenu(withStranger(), "c1", "x");
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a refused command shows the store's message and changes nothing", async () => {
    const doc = withStranger();
    const { commands, store, onClose } = await openMenu(doc, "c1", "x");
    // Meanwhile the link is made some other way, so the menu's choice is now refused.
    act(() => {
      store.getState().dispatch({ type: "relinkAsSpouse", personId: "c1", targetId: "x" }, "x");
    });
    const before = store.getState().doc;
    fireEvent.click(screen.getByRole("menuitem", { name: "Make spouse of Xara Malik" }));
    expect(commands.at(-1)).toEqual({ type: "relinkAsSpouse", personId: "c1", targetId: "x" });
    expect(store.getState().doc).toBe(before);
    expect(screen.getByRole("alert").textContent).toBe("They are already linked that way.");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("with nothing allowed it says so instead of offering actions", async () => {
    await openMenu(famSimple(), "c1", "dad");
    expect(items()).toEqual([]);
    expect(screen.getByText(/can't be linked to/).textContent).toBe(
      "Ali Khan can't be linked to Ahmed Khan.",
    );
  });
});
