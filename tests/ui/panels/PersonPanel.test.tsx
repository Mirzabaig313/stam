import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Command } from "@/core/commands/types";
import { PersonPanel } from "@/ui/panels/PersonPanel";

import { docOf, famRemarriage, famSimple, person, union } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(cleanup);

const onlyOf = (commands: Command[], type: Command["type"]) =>
  commands.filter((c) => c.type === type);

async function open(personId: string, doc = famSimple()) {
  const onRequestDelete = mock((_id: string) => {});
  const view = await renderWithStore(
    <PersonPanel personId={personId} onRequestDelete={onRequestDelete} />,
    doc,
  );
  return { ...view, onRequestDelete, user: userEvent.setup() };
}

const personIn = (store: Awaited<ReturnType<typeof open>>["store"], id: string) =>
  store.getState().doc!.persons[id]!;

describe("PersonPanel fields", () => {
  test("shows the person's details", async () => {
    await open("dad", famSimple());
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Ahmed");
    expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe("Khan");
    expect(screen.getByRole("complementary", { name: "Person details" })).toBeTruthy();
  });

  test("editing the first name and blurring dispatches exactly one updatePerson", async () => {
    const { user, commands, store } = await open("dad");
    const input = screen.getByLabelText("First name");
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

  test("Enter commits once, even though it also blurs", async () => {
    const { user, commands } = await open("dad");
    await user.type(screen.getByLabelText("Last name"), "i{Enter}");
    expect(onlyOf(commands, "updatePerson")).toHaveLength(1);
  });

  test("an unchanged field dispatches nothing", async () => {
    const { user, commands } = await open("dad");
    await user.click(screen.getByLabelText("First name"));
    await user.tab();
    await user.click(screen.getByLabelText("Notes"));
    await user.tab();
    expect(commands).toEqual([]);
  });

  test("Esc puts the old value back and dispatches nothing", async () => {
    const { user, commands } = await open("dad");
    const input = screen.getByLabelText("First name") as HTMLInputElement;
    await user.type(input, "zzz{Escape}");
    expect(input.value).toBe("Ahmed");
    expect(commands).toEqual([]);
  });

  test("a blanked optional field removes it", async () => {
    const doc = famSimple();
    doc.persons.dad = { ...doc.persons.dad!, nickname: "Abu" };
    const { user, commands, store } = await open("dad", doc);
    await user.clear(screen.getByLabelText("Nickname"));
    await user.tab();
    expect(commands).toEqual([
      { type: "updatePerson", personId: "dad", patch: { nickname: undefined } },
    ]);
    expect(personIn(store, "dad").nickname).toBeUndefined();
  });

  test("the native name is directed by its own text", async () => {
    await open("dad");
    expect(screen.getByLabelText("Native name").getAttribute("dir")).toBe("auto");
  });

  test("the gender toggle switches once and ignores the current choice", async () => {
    const { user, commands, store } = await open("dad");
    const male = screen.getByRole("button", { name: "Male" });
    expect(male.getAttribute("aria-pressed")).toBe("true");
    await user.click(male);
    expect(commands).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Female" }));
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

  test("entering a death year unchecks Living, in one history entry", async () => {
    const { user, commands, store } = await open("dad");
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
    expect(personIn(store, "dad").death).toBeUndefined();
  });

  test("a birth date and place are stored together under birth", async () => {
    const { user, store } = await open("dad");
    await user.type(screen.getByLabelText("Birth date"), "1950-03");
    await user.tab();
    await user.type(screen.getByLabelText("Birth place"), "Lahore");
    await user.tab();
    expect(personIn(store, "dad").birth).toEqual({
      date: { year: 1950, month: 3 },
      place: "Lahore",
    });
  });

  test("clearing the only birth field drops birth altogether", async () => {
    const { user, store } = await open("c1");
    await user.clear(screen.getByLabelText("Birth date"));
    await user.tab();
    expect(personIn(store, "c1").birth).toBeUndefined();
  });

  test("an invalid date commits nothing", async () => {
    const { user, commands } = await open("dad");
    await user.type(screen.getByLabelText("Birth date"), "1950-13");
    await user.tab();
    expect(commands).toEqual([]);
  });

  test("notes are plain text", async () => {
    const { user, store } = await open("dad");
    const notes = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    expect(notes.tagName).toBe("TEXTAREA");
    await user.type(notes, "<b>bold</b>{Enter}second line");
    await user.tab();
    expect(personIn(store, "dad").notes).toBe("<b>bold</b>\nsecond line");
    expect(document.querySelector("b")).toBeNull();
  });

  test("editing a placeholder's name makes it a real person", async () => {
    const doc = famSimple();
    doc.persons.mom = { ...doc.persons.mom!, firstName: "", lastName: "", isPlaceholder: true };
    const { user, store } = await open("mom", doc);
    await user.type(screen.getByLabelText("First name"), "Sara");
    await user.tab();
    expect(personIn(store, "mom").isPlaceholder).toBeUndefined();
  });

  test("names are wrapped in bdi in the header", async () => {
    await open("dad");
    expect(screen.getByRole("heading", { name: "Ahmed Khan" }).querySelector("bdi")).toBeTruthy();
  });

  test("an unnamed person gets a translated label", async () => {
    const doc = famSimple();
    doc.persons.mom = { ...doc.persons.mom!, firstName: "", lastName: "" };
    await open("mom", doc);
    expect(screen.getByRole("heading", { name: "Unnamed person" })).toBeTruthy();
  });

  test("close deselects", async () => {
    const { user, store } = await open("dad");
    store.getState().select("dad");
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(store.getState().selectedId).toBeNull();
  });
});

describe("PersonPanel buttons", () => {
  test("Set as root roots the tree on this person and clears the view root", async () => {
    const { user, store } = await open("c1");
    store.getState().setViewRoot("c2");
    await user.click(screen.getByRole("button", { name: "Set as root" }));
    expect(store.getState().doc!.rootPersonId).toBe("c1");
    expect(store.getState().viewRootId).toBeNull();
  });

  test("Set as root is unavailable for the root", async () => {
    await open("dad");
    expect(
      (screen.getByRole("button", { name: "Set as root" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("Delete… asks for the delete dialog", async () => {
    const { user, onRequestDelete } = await open("c1");
    await user.click(screen.getByRole("button", { name: "Delete…" }));
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
    await user.click(screen.getByRole("button", { name: "View family" }));
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

describe("PersonPanel unions and children", () => {
  test("lists each union with its partner, status and dates", async () => {
    await open("ali", famRemarriage());
    const unions = screen.getAllByRole("group", { name: /Partner/ });
    expect(unions).toHaveLength(2);
    expect(within(unions[0]!).getByText("Hina Raza")).toBeTruthy();
    expect((within(unions[0]!).getByLabelText("Status") as HTMLSelectElement).value).toBe(
      "divorced",
    );
    expect((within(unions[0]!).getByLabelText("Start date") as HTMLInputElement).value).toBe(
      "1975",
    );
    expect(within(unions[1]!).getByText("Mehr Raza")).toBeTruthy();
  });

  test("changing the status is one updateUnion", async () => {
    const { user, commands, store } = await open("dad");
    await user.selectOptions(screen.getByLabelText("Status"), "separated");
    expect(commands).toEqual([
      { type: "updateUnion", unionId: "u1", patch: { status: "separated" } },
    ]);
    expect(store.getState().doc!.unions.u1!.status).toBe("separated");
  });

  test("union dates commit on blur as one updateUnion, and clearing removes them", async () => {
    const { user, commands, store } = await open("dad");
    await user.type(screen.getByLabelText("Start date"), "1978-06");
    await user.tab();
    expect(commands).toEqual([
      { type: "updateUnion", unionId: "u1", patch: { start: { year: 1978, month: 6 } } },
    ]);
    await user.clear(screen.getByLabelText("Start date"));
    await user.tab();
    expect(store.getState().doc!.unions.u1!.start).toBeUndefined();
  });

  test("lists the children of each union and changes the child type", async () => {
    const { user, commands, store } = await open("dad");
    const kids = screen.getByRole("list", { name: "Children" });
    expect(within(kids).getAllByRole("listitem")).toHaveLength(3);
    expect(within(kids).getByText("Zainab Khan")).toBeTruthy();
    await user.selectOptions(within(kids).getByLabelText("Zainab Khan: child type"), "adopted");
    expect(commands).toEqual([
      { type: "setChildType", unionId: "u1", personId: "c2", childType: "adopted" },
    ]);
    expect(store.getState().doc!.unions.u1!.children[1]!.type).toBe("adopted");
  });

  test("clicking a partner or child selects them", async () => {
    const { user, store } = await open("dad");
    await user.click(screen.getByRole("button", { name: "Sara Khan" }));
    expect(store.getState().selectedId).toBe("mom");
    await user.click(screen.getByRole("button", { name: "Omar Khan" }));
    expect(store.getState().selectedId).toBe("c3");
  });

  test("a person with no unions shows no partner or children sections", async () => {
    await open("c1");
    expect(screen.queryByRole("group", { name: /Partner/ })).toBeNull();
    expect(screen.queryByRole("list", { name: "Children" })).toBeNull();
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

  test("upload resizes, stores the blob and records the photo id in one updatePerson", async () => {
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

  test("remove clears the photo id", async () => {
    const doc = famSimple();
    doc.persons.dad = { ...doc.persons.dad!, photoId: "ph1" };
    const { user, commands, store } = await open("dad", doc);
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(commands).toEqual([
      { type: "updatePerson", personId: "dad", patch: { photoId: undefined } },
    ]);
    expect(personIn(store, "dad").photoId).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });
});
