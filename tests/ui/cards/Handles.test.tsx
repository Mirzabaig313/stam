import { afterEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, screen, waitFor, within } from "@testing-library/react";

import { parentsOf } from "@/core/model/tree";

import { docOf, famSimple, person, union } from "../../fixtures/families";
import { remarried } from "./fixtures";
import { cardOf, hover, nameInput, renderEditorCanvas, withFakeCanvasSize } from "./quickAddEnv";

withFakeCanvasSize();
afterEach(cleanup);

const handlesOf = (personId: string) =>
  document.querySelector<HTMLElement>(`[data-handles-for="${personId}"]`);

const handleNames = (personId: string) =>
  within(handlesOf(personId)!)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

describe("quick-add handles", () => {
  test("show on the hovered card and on the selected card, not on the others", async () => {
    const { store } = await renderEditorCanvas(famSimple());
    expect(handlesOf("dad")).toBeNull();
    hover("dad");
    expect(handleNames("dad")).toEqual([
      "Add a person above Ahmed Khan",
      "Add spouse or sibling on the left of Ahmed Khan",
      "Add spouse or sibling on the right of Ahmed Khan",
      "Add child of Ahmed Khan",
    ]);
    // One card shows handles at a time: the hovered one, not the one just selected elsewhere.
    act(() => store.getState().select("c2"));
    expect(handlesOf("dad")).not.toBeNull();
    expect(handlesOf("c2")).toBeNull();
    expect(handlesOf("c3")).toBeNull();
  });

  test("the selected card shows its handles when nothing else is hovered or focused", async () => {
    const { store } = await renderEditorCanvas(famSimple());
    act(() => store.getState().select("c2"));
    expect(handlesOf("c2")).not.toBeNull();
    expect(handlesOf("c3")).toBeNull();
    expect(handlesOf("dad")).toBeNull();
  });

  test("show on the card that has keyboard focus, so Tab reaches them next", async () => {
    await renderEditorCanvas(famSimple());
    act(() => cardOf("c3").focus());
    expect(handlesOf("c3")).not.toBeNull();
  });

  test("Tab goes from a card to its handles, Shift+Tab from the first handle back to the card", async () => {
    const { user } = await renderEditorCanvas(famSimple());
    act(() => cardOf("c2").focus());
    await user.tab();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Add a person between Ahmed Khan and Sara Khan and Zainab Khan",
    );
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cardOf("c2"));
  });

  test("with two parents the top handle puts a person between them and the child", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    hover("c1");
    const top = screen.getByRole("button", {
      name: "Add a person between Ahmed Khan and Sara Khan and Ali Khan",
    });
    expect(top.getAttribute("aria-haspopup")).toBeNull();
    expect(top.getAttribute("title")).toBe(top.getAttribute("aria-label"));
    await user.click(top);
    expect(screen.queryByRole("menu")).toBeNull();
    const editing = store.getState().editing!;
    expect(editing).toMatchObject({ role: "between", fromId: "c1" });
    const doc = store.getState().doc!;
    expect(doc.unions["u1"]!.children.map((c) => c.personId)).toEqual(
      ["c1", "c2", "c3"].map((id) => (id === "c1" ? editing.personId : id)),
    );
    expect(parentsOf(doc, "c1")).toEqual([editing.personId]);
  });

  test("with no parents the top handle adds a parent, as it always has", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    hover("dad");
    const top = screen.getByRole("button", { name: "Add a person above Ahmed Khan" });
    await user.click(top);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(store.getState().editing).toMatchObject({ role: "parent", fromId: "dad" });
  });

  test("the bottom handle adds a child with an empty name and opens the editor over it", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    hover("c1");
    await user.click(screen.getByRole("button", { name: "Add child of Ali Khan" }));
    const editing = store.getState().editing!;
    expect(editing).toMatchObject({ role: "child", fromId: "c1" });
    expect(store.getState().doc!.persons[editing.personId]!.firstName).toBe("");
    expect(document.activeElement).toBe(nameInput());
    // No handles while an add is being named.
    expect(document.querySelector("[data-handles-for]")).toBeNull();

    await user.type(nameInput(), "Bilal");
    await user.click(screen.getByRole("button", { name: "Male" }));
    await user.keyboard("{Enter}");
    expect(store.getState().doc!.persons[editing.personId]).toMatchObject({
      firstName: "Bilal",
      lastName: "Khan",
    });
    // The new card takes the focus, ready for the next add.
    expect(document.activeElement).toBe(cardOf(editing.personId));
  });

  test("a side handle offers Spouse and Sibling; Spouse opens the editor with the opposite gender", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    hover("c1");
    await user.click(
      screen.getByRole("button", { name: "Add spouse or sibling on the left of Ali Khan" }),
    );
    const options = within(handlesOf("c1")!).getAllByRole("menuitem");
    expect(options.map((o) => o.textContent)).toEqual(["Spouse", "Sibling"]);
    expect(document.activeElement).toBe(options[0]!);
    await user.click(options[0]!);
    expect(store.getState().editing).toMatchObject({ role: "spouse", fromId: "c1" });
    expect(screen.getByRole("button", { name: "Female" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  test("Sibling adds a sibling under the same parents", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    hover("c3");
    await user.click(
      screen.getByRole("button", { name: "Add spouse or sibling on the right of Omar Khan" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Sibling" }));
    const id = store.getState().editing!.personId;
    expect(store.getState().doc!.unions.u1!.children.map((c) => c.personId)).toContain(id);
  });

  test("Esc on the side chooser closes it and puts the focus back on its handle", async () => {
    const { user } = await renderEditorCanvas(famSimple());
    hover("c1");
    const handle = screen.getByRole("button", {
      name: "Add spouse or sibling on the left of Ali Khan",
    });
    await user.click(handle);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(document.activeElement).toBe(handle);
  });

  test("a child of a person with two or more unions: the union chooser comes first", async () => {
    const { store, user } = await renderEditorCanvas(remarried());
    hover("dad");
    await user.click(screen.getByRole("button", { name: "Add child of Ahmed Khan" }));
    expect(store.getState().editing).toBeNull();
    const chooser = screen.getByRole("group", {
      name: "Choose the family of the new child of Ahmed Khan",
    });
    expect(document.activeElement).toBe(
      within(chooser).getByRole("button", { name: "Sara Malik" }),
    );
    await user.click(within(chooser).getByRole("button", { name: "Hina Raza" }));
    const id = store.getState().editing!.personId;
    expect(store.getState().doc!.unions.u2!.children.map((c) => c.personId)).toEqual([id]);
  });

  test("Esc during an add leaves nothing behind", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    const before = store.getState().doc;
    hover("dad");
    await user.click(screen.getByRole("button", { name: "Add a person above Ahmed Khan" }));
    await user.type(nameInput(), "Yusuf{Escape}");
    expect(Object.keys(store.getState().doc!.persons)).toEqual(Object.keys(before!.persons));
    expect(store.getState().doc!.rootPersonId).toBe("dad");
    expect(store.getState().canRedo).toBe(false);
    // The focus goes back to the card whose handle was used.
    expect(document.activeElement).toBe(cardOf("dad"));
  });

  test("adding a child to a collapsed person expands them, so the new card is on screen", async () => {
    const { store, user } = await renderEditorCanvas(famSimple());
    act(() => store.getState().toggleCollapse("dad"));
    hover("dad");
    await user.click(screen.getByRole("button", { name: "Add child of Ahmed Khan" }));
    expect(store.getState().collapsed.has("dad")).toBe(false);
    await waitFor(() => expect(nameInput()).toBeTruthy());
  });

  test("isOnScreen, when given, decides instead of the editor's current box (mid-glide)", async () => {
    const reveal = mock((_personId: string) => {});
    let onScreen = false;
    const { store, user } = await renderEditorCanvas(famSimple(), {
      quickAdd: { reveal, isOnScreen: () => onScreen },
    });
    hover("c1");
    await user.click(screen.getByRole("button", { name: "Add child of Ali Khan" }));
    const id = store.getState().editing!.personId;
    await waitFor(() => expect(reveal).toHaveBeenCalledWith(id));

    await user.keyboard("{Escape}");
    reveal.mockClear();
    onScreen = true;
    hover("c2");
    await user.click(screen.getByRole("button", { name: "Add child of Zainab Khan" }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(reveal).not.toHaveBeenCalled();
  });

  test("a new card under a bottom sheet is revealed, a new card in view is not", async () => {
    const reveal = mock((_personId: string) => {});
    // The editor box: wherever it is, the sheet covers all but the top 100 px of the canvas.
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains("inline-editor")) {
        return DOMRect.fromRect({ x: 600, y: 400, width: 220, height: 52 });
      }
      return original.call(this);
    };
    try {
      let covered = 900;
      const { store, user } = await renderEditorCanvas(famSimple(), {
        quickAdd: { reveal, coveredBottom: () => covered },
      });
      hover("c1");
      await user.click(screen.getByRole("button", { name: "Add child of Ali Khan" }));
      const id = store.getState().editing!.personId;
      await waitFor(() => expect(reveal).toHaveBeenCalledWith(id));

      await user.keyboard("{Escape}");
      reveal.mockClear();
      covered = 0;
      hover("c2");
      await user.click(screen.getByRole("button", { name: "Add child of Zainab Khan" }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(reveal).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });
});

describe("quick-add handles in the focus views", () => {
  test("the pedigree offers only Add parent", async () => {
    const { store } = await renderEditorCanvas(famSimple());
    act(() => {
      store.getState().select("dad");
      store.getState().setViewMode("pedigree");
      store.getState().select(null);
    });
    hover("dad");
    expect(handleNames("dad")).toEqual(["Add a person above Ahmed Khan"]);
  });

  test("the descendants view offers only Add child", async () => {
    const { store } = await renderEditorCanvas(famSimple());
    act(() => {
      store.getState().select("dad");
      store.getState().setViewMode("descendants");
      store.getState().select(null);
    });
    hover("c1");
    expect(handleNames("c1")).toEqual(["Add child of Ali Khan"]);
  });

  test("the hourglass: Add parent only above the focus row, every handle on it", async () => {
    const { store } = await renderEditorCanvas(famSimple());
    act(() => {
      store.getState().select("c1");
      store.getState().setViewMode("hourglass");
      store.getState().select(null);
    });
    hover("dad");
    expect(handleNames("dad")).toEqual(["Add a person above Ahmed Khan"]);
    hover("c1");
    expect(handleNames("c1")).toEqual([
      "Add a person between Ahmed Khan and Sara Khan and Ali Khan",
      "Add spouse or sibling on the left of Ali Khan",
      "Add spouse or sibling on the right of Ali Khan",
      "Add child of Ali Khan",
    ]);
  });
});

/** Ismail with his son Haider: Haider's real father is missing between them. */
const ismail = () =>
  docOf(
    [person("ismail", "Ismail", "Khan", "male"), person("haider", "Haider", "Khan", "male")],
    [union("u", ["ismail"], ["haider"], "partner")],
    "ismail",
  );

describe("a person above (the owner's case)", () => {
  test("the top handle says it goes between Ismail and Haider", async () => {
    await renderEditorCanvas(ismail());
    hover("haider");
    expect(handleNames("haider")[0]).toBe("Add a person between Ismail Khan and Haider Khan");
  });

  test("Ismail, then Ahmed, then Haider, in one undo step", async () => {
    const { store, user } = await renderEditorCanvas(ismail());
    hover("haider");
    await user.click(
      screen.getByRole("button", { name: "Add a person between Ismail Khan and Haider Khan" }),
    );
    expect(store.getState().editing).toMatchObject({ role: "between", fromId: "haider" });
    await user.type(nameInput(), "Ahmed");
    await user.click(screen.getByRole("button", { name: "Male" }));
    await user.keyboard("{Enter}");
    const doc = store.getState().doc!;
    const ahmed = Object.values(doc.persons).find((p) => p.firstName === "Ahmed")!;
    // One word: the last name comes from Haider.
    expect(ahmed.lastName).toBe("Khan");
    expect(parentsOf(doc, "haider")).toEqual([ahmed.id]);
    expect(parentsOf(doc, ahmed.id)).toEqual(["ismail"]);
    act(() => store.getState().undo());
    expect(parentsOf(store.getState().doc!, "haider")).toEqual(["ismail"]);
    expect(store.getState().doc!.persons[ahmed.id]).toBeUndefined();
  });
});
