import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Command } from "@/core/commands/types";
import { PersonPanel } from "@/ui/panels/PersonPanel";
import { useEditor } from "@/ui/store/useEditor";

import {
  docOf,
  famHalfSiblings,
  famRemarriage,
  famSimple,
  person,
  union,
} from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(cleanup);

const onlyOf = (commands: Command[], type: Command["type"]) =>
  commands.filter((c) => c.type === type);

async function open(personId: string, doc = famSimple(), readOnly = false, withShow = false) {
  const onRequestDelete = mock((_id: string) => {});
  const onShowPerson = mock((_id: string) => {});
  const view = await renderWithStore(
    <PersonPanel
      personId={personId}
      onRequestDelete={onRequestDelete}
      readOnly={readOnly}
      {...(withShow ? { onShowPerson } : {})}
    />,
    doc,
  );
  return { ...view, onRequestDelete, onShowPerson, user: userEvent.setup() };
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const group = (name: string) => screen.getByRole("group", { name });

/** A button's accessible name: its aria-label, else its text without decorative parts. */
function nameOf(el: HTMLElement): string {
  const label = el.getAttribute("aria-label");
  if (label) return label;
  const copy = el.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent!.replace(/\s+/g, " ").trim();
}
const buttonsIn = (el: HTMLElement) => within(el).getAllByRole("button").map(nameOf);

const personIn = (store: Awaited<ReturnType<typeof open>>["store"], id: string) =>
  store.getState().doc!.persons[id]!;

describe("PersonPanel profile header", () => {
  test("a landmark named Person details, headed by the name in bdi", async () => {
    await open("dad");
    expect(screen.getByRole("complementary", { name: "Person details" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ahmed Khan" }).querySelector("bdi")).toBeTruthy();
  });

  test("an unnamed person gets a translated label", async () => {
    const doc = famSimple();
    doc.persons.mom = { ...doc.persons.mom!, firstName: "", lastName: "" };
    await open("mom", doc);
    expect(screen.getByRole("heading", { name: "Unnamed person" })).toBeTruthy();
  });

  test("the lifespan, the place, and chips for living and gender", async () => {
    const doc = famSimple();
    doc.persons.c1!.birth = { date: { year: 1980 }, place: "Lahore" };
    const { container } = await open("c1", doc);
    const header = container.querySelector(".sheet__header")!;
    // The cards' own life line: "b." and the age.
    expect(header.textContent).toMatch(/b\. 1980 · \d+ yrs/);
    expect(header.textContent).toContain("Lahore");
    expect(within(header as HTMLElement).getByText("Living")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Male")).toBeTruthy();
  });

  test("a deceased person without dates: a Deceased chip and no lone dagger", async () => {
    const doc = famSimple();
    doc.persons.dad = { ...doc.persons.dad!, isLiving: false };
    const { container } = await open("dad", doc);
    const header = container.querySelector(".sheet__header")!;
    expect(within(header as HTMLElement).getByText("Deceased")).toBeTruthy();
    expect(header.textContent).not.toContain("†");
  });

  test("another person in the same sheet: the sheet stays, every field starts afresh", async () => {
    function Selected() {
      const id = useEditor((st) => st.selectedId) ?? "dad";
      return <PersonPanel personId={id} onRequestDelete={() => {}} />;
    }
    const { store, container } = await renderWithStore(<Selected />);
    const user = userEvent.setup();
    const sheet = container.querySelector(".person-panel");
    await user.click(button("Add birth date"));
    act(() => store.getState().select("mom"));
    expect(container.querySelector(".person-panel")).toBe(sheet);
    expect(screen.getByRole("heading", { name: "Sara Khan" })).toBeTruthy();
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Sara");
    expect(screen.queryByLabelText("Birth date")).toBeNull();
  });

  test("close deselects", async () => {
    const { user, store } = await open("dad");
    store.getState().select("dad");
    await user.click(button("Close panel"));
    expect(store.getState().selectedId).toBeNull();
  });
});

describe("PersonPanel family", () => {
  test("a child sees both parents and the siblings; a parent their spouse and children", async () => {
    await open("c2");
    expect(buttonsIn(group("Parents"))).toEqual(["Ahmed Khan", "Sara Khan", "Add a person above"]);
    expect(buttonsIn(group("Siblings"))).toEqual(["Ali Khan", "Omar Khan", "Add sibling"]);
    cleanup();

    await open("dad");
    const spouses = group("Spouses");
    expect(within(spouses).getByRole("button", { name: "Sara Khan" })).toBeTruthy();
    expect(spouses.textContent).toContain("Married");
    expect(buttonsIn(group("Children"))).toEqual([
      "Ali Khan",
      "Zainab Khan",
      "Omar Khan",
      "Add child",
    ]);
  });

  test("a person with only a single-parent union shows no spouse row and lists the children", async () => {
    const doc = docOf(
      [person("mum", "Hina", "Raza", "female"), person("kid", "Noor", "Raza", "female")],
      [union("solo", ["mum"], ["kid"])],
      "mum",
    );
    await open("mum", doc);
    expect(buttonsIn(group("Spouses"))).toEqual(["Add spouse"]);
    expect(group("Spouses").textContent).not.toContain("No partner");
    expect(screen.queryByRole("button", { name: /^Edit partnership/ })).toBeNull();
    expect(buttonsIn(group("Children"))).toEqual(["Noor Raza", "Add child"]);
  });

  test("Details come before Family in the panel", async () => {
    await open("dad");
    const details = screen.getByRole("region", { name: "Details" });
    const family = screen.getByRole("region", { name: "Family" });
    expect(details.compareDocumentPosition(family) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a spouse line gives the status and the years", async () => {
    await open("ali", famRemarriage());
    const spouses = group("Spouses");
    expect(spouses.textContent).toContain("Divorced, 1975");
    expect(spouses.textContent).toContain("Married, 1990");
  });

  test("a half sibling is marked", async () => {
    await open("k1", famHalfSiblings());
    const kashif = within(group("Siblings")).getByRole("button", { name: /Kashif Shah/ });
    expect(kashif.textContent).toContain("half");
  });

  test("a relative's chip shows them: onShowPerson, or just the selection", async () => {
    const shown = await open("dad", famSimple(), false, true);
    await shown.user.click(button("Omar Khan"));
    expect(shown.onShowPerson).toHaveBeenCalledWith("c3");
    cleanup();

    const { user, store } = await open("dad");
    await user.click(button("Sara Khan"));
    expect(store.getState().selectedId).toBe("mom");
  });

  test("Add child adds a child of the only union and opens the inline editor on them", async () => {
    const { user, commands, store } = await open("dad");
    await user.click(button("Add child"));
    expect(commands).toEqual([
      { type: "addChild", parentId: "dad", unionId: undefined, child: { gender: "male" } },
    ]);
    const editing = store.getState().editing!;
    expect(editing.role).toBe("child");
    expect(editing.fromId).toBe("dad");
    expect(store.getState().doc!.unions.u1!.children.map((c) => c.personId)).toContain(
      editing.personId,
    );
  });

  test("Add child with two unions asks which one first", async () => {
    const { user, store } = await open("ali", famRemarriage());
    await user.click(button("Add child"));
    expect(store.getState().editing).toBeNull();
    const chooser = document.querySelector<HTMLElement>(".union-chooser")!;
    await user.click(within(chooser).getByRole("button", { name: /Mehr Raza/ }));
    const editing = store.getState().editing!;
    expect(store.getState().doc!.unions.m2!.children.map((c) => c.personId)).toContain(
      editing.personId,
    );
  });

  test("Add parent, Add spouse and Add sibling reuse the quick-add commands", async () => {
    const { user, commands } = await open("c1");
    await user.click(button("Add spouse"));
    await user.click(button("Add sibling"));
    expect(commands.map((c) => c.type)).toEqual(["addSpouse", "addSibling"]);
    cleanup();

    const doc = famSimple();
    const top = await open("dad", doc);
    await top.user.click(button("Add parent"));
    expect(top.commands.map((c) => c.type)).toEqual(["addParent"]);
  });

  test("someone with parents gets Add a person above, which goes between (insertParent)", async () => {
    const { user, commands } = await open("c1");
    expect(screen.queryByRole("button", { name: "Add parent" })).toBeNull();
    await user.click(button("Add a person above"));
    expect(commands.map((c) => c.type)).toEqual(["insertParent"]);
  });

  test("the pedigree view only offers Add parent", async () => {
    const { store } = await open("dad");
    act(() => store.getState().setViewMode("pedigree"));
    expect(screen.queryByRole("button", { name: "Add child" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add spouse" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add sibling" })).toBeNull();
    expect(button("Add parent")).toBeTruthy();
  });

  test("a person with no family shows each group with its Add only", async () => {
    const doc = docOf([person("solo", "Sami", "Ali", "male")], [], "solo");
    await open("solo", doc);
    for (const [title, add] of [
      ["Parents", "Add parent"],
      ["Spouses", "Add spouse"],
      ["Children", "Add child"],
      ["Siblings", "Add sibling"],
    ] as const) {
      expect(buttonsIn(group(title))).toEqual([add]);
    }
  });

  test("an add the model refuses says why, and opens no editor", async () => {
    const { user, store } = await open("dad");
    store.setState({ dispatch: () => null, error: "CYCLE" });
    await user.click(button("Add spouse"));
    expect(store.getState().editing).toBeNull();
    expect(screen.getByRole("alert").textContent!.length).toBeGreaterThan(0);
  });
});

describe("PersonPanel partnership details", () => {
  test("each partnership opens to its status, dates and children's link types", async () => {
    const { user } = await open("ali", famRemarriage());
    const toggle = button("Edit partnership with Hina Raza");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Status")).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const editor = group("Partnership with Hina Raza");
    expect((within(editor).getByLabelText("Status") as HTMLSelectElement).value).toBe("divorced");
    expect((within(editor).getByLabelText("Start date") as HTMLInputElement).value).toBe("1975");
    const kids = within(editor).getByRole("list", { name: "Children" });
    expect(within(kids).getAllByRole("listitem")).toHaveLength(2);
  });

  test("changing the status is one updateUnion", async () => {
    const { user, commands, store } = await open("dad");
    await user.click(button("Edit partnership with Sara Khan"));
    await user.selectOptions(screen.getByLabelText("Status"), "separated");
    expect(commands).toEqual([
      { type: "updateUnion", unionId: "u1", patch: { status: "separated" } },
    ]);
    expect(store.getState().doc!.unions.u1!.status).toBe("separated");
  });

  test("union dates commit on blur as one updateUnion, and clearing removes them", async () => {
    const { user, commands, store } = await open("dad");
    await user.click(button("Edit partnership with Sara Khan"));
    await user.type(screen.getByLabelText("Start date"), "1978-06");
    await user.tab();
    expect(commands).toEqual([
      { type: "updateUnion", unionId: "u1", patch: { start: { year: 1978, month: 6 } } },
    ]);
    await user.clear(screen.getByLabelText("Start date"));
    await user.tab();
    expect(store.getState().doc!.unions.u1!.start).toBeUndefined();
  });

  test("changes a child's link type", async () => {
    const { user, commands, store } = await open("dad");
    await user.click(button("Edit partnership with Sara Khan"));
    await user.selectOptions(screen.getByLabelText("Zainab Khan: child type"), "adopted");
    expect(commands).toEqual([
      { type: "setChildType", unionId: "u1", personId: "c2", childType: "adopted" },
    ]);
    expect(store.getState().doc!.unions.u1!.children[1]!.type).toBe("adopted");
  });

  test("an adopted child's chip says so", async () => {
    const doc = famSimple();
    doc.unions.u1!.children[1]!.type = "adopted";
    await open("dad", doc);
    expect(
      within(group("Children")).getByRole("button", { name: /Zainab Khan/ }).textContent,
    ).toContain("Adopted");
  });
});

describe("PersonPanel details: progressive fields", () => {
  test("first and last name are always there, and edit with one updatePerson each", async () => {
    const { user, commands, store } = await open("dad");
    const input = screen.getByLabelText("First name");
    expect((input as HTMLInputElement).value).toBe("Ahmed");
    await user.clear(input);
    await user.type(input, "Ahmad");
    await user.tab();
    expect(commands).toEqual([
      { type: "updatePerson", personId: "dad", patch: { firstName: "Ahmad" } },
    ]);
    expect(personIn(store, "dad").firstName).toBe("Ahmad");
    store.getState().undo();
    expect(personIn(store, "dad").firstName).toBe("Ahmed");
  });

  test("Enter commits once; Esc puts the old value back", async () => {
    const { user, commands } = await open("dad");
    await user.type(screen.getByLabelText("Last name"), "i{Enter}");
    expect(onlyOf(commands, "updatePerson")).toHaveLength(1);
    const first = screen.getByLabelText("First name") as HTMLInputElement;
    await user.type(first, "zzz{Escape}");
    expect(first.value).toBe("Ahmed");
    expect(onlyOf(commands, "updatePerson")).toHaveLength(1);
  });

  test("only filled fields show; the rest are Add buttons", async () => {
    await open("dad");
    for (const label of ["Birth date", "Birth place", "Death date", "Nickname", "Native name"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    expect(screen.queryByLabelText("Notes")).toBeNull();
    for (const name of [
      "Add birth date",
      "Add birth place",
      "Add death",
      "Add nickname",
      "Add native name",
      "Add notes",
    ]) {
      expect(button(name)).toBeTruthy();
    }
    cleanup();
    await open("c1");
    expect((screen.getByLabelText("Birth date") as HTMLInputElement).value).toBe("1980");
    expect(screen.queryByRole("button", { name: "Add birth date" })).toBeNull();
  });

  test("an Add button reveals its field with the focus in it", async () => {
    const { user, store } = await open("dad");
    await user.click(button("Add birth date"));
    const date = screen.getByLabelText("Birth date");
    expect(document.activeElement).toBe(date);
    expect(screen.queryByRole("button", { name: "Add birth date" })).toBeNull();
    await user.type(date, "1950-03");
    await user.tab();
    await user.click(button("Add birth place"));
    await user.type(screen.getByLabelText("Birth place"), "Lahore");
    await user.tab();
    expect(personIn(store, "dad").birth).toEqual({
      date: { year: 1950, month: 3 },
      place: "Lahore",
    });
  });

  test("Add death reveals the death date and place; a death year unchecks Living in one step", async () => {
    const { user, commands, store } = await open("dad");
    await user.click(button("Add death"));
    expect(document.activeElement).toBe(screen.getByLabelText("Death date"));
    expect(screen.getByLabelText("Death place")).toBeTruthy();
    await user.type(screen.getByLabelText("Death date"), "1990");
    await user.tab();
    const box = screen.getByRole("checkbox", { name: "Living" }) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(false));
    expect(commands).toEqual([
      {
        type: "updatePerson",
        personId: "dad",
        patch: { death: { date: { year: 1990 } }, isLiving: false },
      },
    ]);
    store.getState().undo();
    expect(personIn(store, "dad").isLiving).toBe(true);
  });

  test("clearing the only birth field drops birth altogether", async () => {
    const { user, store } = await open("c1");
    await user.clear(screen.getByLabelText("Birth date"));
    await user.tab();
    expect(personIn(store, "c1").birth).toBeUndefined();
  });

  test("an invalid date commits nothing", async () => {
    const { user, commands } = await open("c1");
    const date = screen.getByLabelText("Birth date");
    await user.clear(date);
    await user.type(date, "1950-13");
    await user.tab();
    expect(commands).toEqual([]);
  });

  test("a blanked nickname is removed; the native name follows its own direction", async () => {
    const doc = famSimple();
    doc.persons.dad = { ...doc.persons.dad!, nickname: "Abu" };
    const { user, commands, store } = await open("dad", doc);
    await user.clear(screen.getByLabelText("Nickname"));
    await user.tab();
    expect(commands).toEqual([
      { type: "updatePerson", personId: "dad", patch: { nickname: undefined } },
    ]);
    expect(personIn(store, "dad").nickname).toBeUndefined();
    await user.click(button("Add native name"));
    expect(screen.getByLabelText("Native name").getAttribute("dir")).toBe("auto");
  });

  test("gender is a two-way choice that ignores the current one", async () => {
    const { user, commands, store } = await open("dad");
    const male = screen.getByRole("radio", { name: "Male" });
    expect(male.getAttribute("aria-checked")).toBe("true");
    await user.click(male);
    expect(commands).toEqual([]);
    await user.click(screen.getByRole("radio", { name: "Female" }));
    expect(commands).toEqual([
      { type: "updatePerson", personId: "dad", patch: { gender: "female" } },
    ]);
    expect(personIn(store, "dad").gender).toBe("female");
  });

  test("the living checkbox toggles", async () => {
    const { user, store } = await open("dad");
    const box = screen.getByRole("checkbox", { name: "Living" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await user.click(box);
    expect(personIn(store, "dad").isLiving).toBe(false);
  });

  test("notes: added as plain text, then folded behind Show notes", async () => {
    const { user, store } = await open("dad");
    await user.click(button("Add notes"));
    const notes = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    expect(notes.tagName).toBe("TEXTAREA");
    await user.type(notes, "<b>bold</b>{Enter}second line");
    await user.tab();
    expect(personIn(store, "dad").notes).toBe("<b>bold</b>\nsecond line");
    expect(document.querySelector("b")).toBeNull();
  });

  test("existing notes start folded, with a preview, and open to edit", async () => {
    const doc = famSimple();
    doc.persons.dad = { ...doc.persons.dad!, notes: "Kept the family bookshop." };
    const { user } = await open("dad", doc);
    expect(screen.queryByLabelText("Notes")).toBeNull();
    const toggle = button("Show notes");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Kept the family bookshop.")).toBeTruthy();
    await user.click(toggle);
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(
      "Kept the family bookshop.",
    );
    expect(button("Hide notes").getAttribute("aria-expanded")).toBe("true");
  });

  test("editing a placeholder's name makes it a real person", async () => {
    const doc = famSimple();
    doc.persons.mom = { ...doc.persons.mom!, firstName: "", lastName: "", isPlaceholder: true };
    const { user, store } = await open("mom", doc);
    await user.type(screen.getByLabelText("First name"), "Sara");
    await user.tab();
    expect(personIn(store, "mom").isPlaceholder).toBeUndefined();
  });
});

describe("PersonPanel header life line", () => {
  test("shows the cards' life line under the name: b. and the age", async () => {
    await open("c1"); // born 1980, living
    const age = new Date().getFullYear() - 1980;
    expect(document.querySelector(".profile-summary__years")?.textContent).toMatch(
      new RegExp(`^b\\. 1980 · (${age}|${age - 1}) yrs$`),
    );
  });

  test("no line when nothing is known", async () => {
    await open("dad");
    expect(document.querySelector(".profile-summary__years")).toBeNull();
  });
});

describe("PersonPanel footer", () => {
  test("Set as root roots the tree on this person and clears the view root", async () => {
    const { user, store } = await open("c1");
    store.getState().setViewRoot("c2");
    await user.click(button("Set as root"));
    expect(store.getState().doc!.rootPersonId).toBe("c1");
    expect(store.getState().viewRootId).toBeNull();
  });

  test("Set as root is unavailable for the root", async () => {
    await open("dad");
    expect(button("Set as root").disabled).toBe(true);
  });

  test("Delete… asks for the delete dialog", async () => {
    const { user, onRequestDelete } = await open("c1");
    await user.click(button("Delete…"));
    expect(onRequestDelete).toHaveBeenCalledWith("c1");
  });

  test("View family appears for a spouse who has parents, and sets the view root", async () => {
    const doc = docOf(
      [
        person("dad", "Ahmed", "Khan", "male"),
        person("c1", "Ali", "Khan", "male"),
        person("w", "Hina", "Shah", "female"),
        person("wp1", "Zaki", "Shah", "male"),
        person("wp2", "Bano", "Shah", "female"),
      ],
      [union("u1", ["dad"], ["c1"]), union("u2", ["c1", "w"]), union("uw", ["wp1", "wp2"], ["w"])],
      "dad",
    );
    const { user, store } = await open("w", doc);
    await user.click(button("View family"));
    expect(store.getState().viewRootId).toBe("wp1");
  });

  test("no View family for a blood relative or a spouse without parents", async () => {
    await open("c1");
    expect(screen.queryByRole("button", { name: "View family" })).toBeNull();
    cleanup();
    await open("mom");
    expect(screen.queryByRole("button", { name: "View family" })).toBeNull();
  });
});

describe("PersonPanel read-only", () => {
  test("the same profile, with no fields, adds, root or delete", async () => {
    const doc = famSimple();
    doc.persons.c1!.birth = { date: { year: 1980 }, place: "Lahore" };
    const { onRequestDelete, commands } = await open("c1", doc, true);
    expect(screen.getByRole("heading", { name: "Ali Khan" })).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit partnership/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set as root" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
    expect(screen.queryByLabelText("Upload photo")).toBeNull();
    // The filled details still read, as text.
    const details = screen.getByRole("region", { name: "Details" });
    expect(details.textContent).toContain("Birth place");
    expect(details.textContent).toContain("Lahore");
    expect(details.textContent).toContain("Ali");
    expect(onRequestDelete).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
  });

  test("family chips still show the relative", async () => {
    const { user, onShowPerson } = await open("c1", famSimple(), true, true);
    await user.click(button("Ahmed Khan"));
    expect(onShowPerson).toHaveBeenCalledWith("dad");
  });
});

describe("PersonPanel photo", () => {
  const realBitmap = globalThis.createImageBitmap;
  const realOffscreen = globalThis.OffscreenCanvas;

  beforeEach(() => {
    globalThis.createImageBitmap = (async () => ({
      width: 1000,
      height: 500,
      close() {},
    })) as unknown as typeof createImageBitmap;
    globalThis.OffscreenCanvas = class {
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob(options: { type: string }) {
        return new Blob(["resized"], { type: options.type });
      }
    } as unknown as typeof OffscreenCanvas;
  });

  afterEach(() => {
    globalThis.createImageBitmap = realBitmap;
    globalThis.OffscreenCanvas = realOffscreen;
  });

  test("tapping the portrait uploads: resized, stored, recorded in one updatePerson", async () => {
    const { user, env, commands, store } = await open("dad");
    const stored: { id: string; blob: Blob }[] = [];
    const putPhoto = env.repo.putPhoto;
    env.repo.putPhoto = async (id, blob) => {
      stored.push({ id, blob });
      await putPhoto(id, blob);
    };
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();

    const file = new File(["raw"], "face.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Upload photo"), file);

    await waitFor(() => expect(personIn(store, "dad").photoId).toBeTruthy());
    expect(stored).toHaveLength(1);
    expect(stored[0]!.blob.type).toBe("image/webp");
    expect(commands).toEqual([
      { type: "updatePerson", personId: "dad", patch: { photoId: stored[0]!.id } },
    ]);
  });

  test("a photo that can't be read shows an error and changes nothing", async () => {
    globalThis.createImageBitmap = (async () => {
      throw new Error("bad image");
    }) as unknown as typeof createImageBitmap;
    const { user, commands } = await open("dad");
    await user.upload(
      screen.getByLabelText("Upload photo"),
      new File(["raw"], "face.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(commands).toEqual([]);
  });

  test("with a photo, the portrait changes it and Remove photo clears it", async () => {
    const doc = famSimple();
    doc.persons.dad = { ...doc.persons.dad!, photoId: "ph1" };
    const { user, commands, store } = await open("dad", doc);
    expect(screen.getByLabelText("Change photo")).toBeTruthy();
    await user.click(button("Remove photo"));
    expect(commands).toEqual([
      { type: "updatePerson", personId: "dad", patch: { photoId: undefined } },
    ]);
    expect(personIn(store, "dad").photoId).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });
});
