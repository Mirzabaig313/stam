import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";

import { exportStamJson } from "@/io/json/stamJson";
import type { BackupState } from "@/storage/backupReminder";
import { createTabSync, type TreeChange } from "@/storage/multitab";
import { TreeListPage } from "@/ui/app/TreeListPage";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famHalfSiblings, famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;

afterEach(cleanup);

beforeEach(async () => {
  env = await makeEditorEnv();
  setStorage({});
});

function setStorage(storage: {
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<unknown>;
}) {
  Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
}

/** Stands in for the editor and shows what the import handed over in the navigation state. */
function EditorProbe() {
  const state = useLocation().state as { skippedPhotos?: number } | null;
  return (
    <p>
      editor opened
      <output data-testid="skipped">{state?.skippedPhotos ?? "none"}</output>
    </p>
  );
}

/** `doc` with its first person wearing `photoId`. */
function withPhoto(doc: ReturnType<typeof famSimple>, photoId: string) {
  const [id] = Object.keys(doc.persons);
  return { ...doc, persons: { ...doc.persons, [id!]: { ...doc.persons[id!]!, photoId } } };
}

function renderList() {
  return renderApp(
    <Routes>
      <Route path="/app" element={<TreeListPage />} />
      <Route path="/app/t/:treeId" element={<EditorProbe />} />
    </Routes>,
    { repo: env.repo },
  );
}

/** Opens a tree card's "⋯" menu and picks one of its actions. */
async function chooseAction(
  user: ReturnType<typeof userEvent.setup>,
  tree: string,
  action: string,
) {
  await user.click(await screen.findByRole("button", { name: `Actions for ${tree}` }));
  await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: action }));
}

async function createTree(name?: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New tree" }));
  const dialog = screen.getByRole("dialog");
  const input = within(dialog).getByLabelText("Tree name");
  if (name !== undefined) {
    await user.clear(input);
    await user.type(input, name);
  }
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  return user;
}

describe("TreeListPage", () => {
  test("an empty list invites you to create the first tree", async () => {
    renderList();
    expect(await screen.findByText("Start your family tree")).toBeTruthy();
  });

  test("creating a tree lists it with its people count", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    await createTree("Khan family");
    expect(await screen.findByText("Khan family")).toBeTruthy();
    expect(screen.getByText("0 people")).toBeTruthy();
    expect(screen.queryByText("Start your family tree")).toBeNull();
    expect((await env.repo.listTrees()).map((t) => t.name)).toEqual(["Khan family"]);
  });

  test("the Stam wordmark links back to the home page", async () => {
    renderList();
    const home = await screen.findByRole("link", { name: "Stam home" });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.textContent).toBe("Stam");
  });

  test("the name prompt starts with a default name", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    await createTree();
    expect(await screen.findByText("My family")).toBeTruthy();
  });

  test("the first tree asks the browser for persistent storage, later trees do not", async () => {
    let calls = 0;
    setStorage({
      persist: async () => {
        calls++;
        return true;
      },
    });
    renderList();
    await screen.findByText("Start your family tree");
    await createTree("One");
    await screen.findByText("One");
    await createTree("Two");
    await screen.findByText("Two");
    expect(calls).toBe(1);
  });

  test("a people count of one is singular", async () => {
    await env.repo.saveTree({
      ...famSimple(),
      id: "solo",
      name: "Solo",
      persons: { dad: famSimple().persons.dad! },
      unions: {},
      unionOrder: {},
    });
    renderList();
    expect(await screen.findByText("1 person")).toBeTruthy();
  });

  test("lists existing trees and links each to its editor", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const link = await screen.findByRole("link", { name: /Khans/ });
    expect(link.getAttribute("href")).toBe("/app/t/t1");
    expect(screen.getByText("5 people")).toBeTruthy();
    expect(screen.getByText(/edited/)).toBeTruthy();
  });

  test("importing a file adds a second tree, opens it and never changes the first", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    const before = await env.repo.getTree("t1");
    renderList();
    await screen.findByText("Khans");
    const json = await exportStamJson(famHalfSiblings(), {}, { includePhotos: false });
    const file = new File([json], "halves.stam.json", { type: "application/json" });
    await userEvent.setup().upload(screen.getByLabelText("Import"), file);
    expect(await screen.findByText("editor opened")).toBeTruthy();
    const trees = await env.repo.listTrees();
    expect(trees).toHaveLength(2);
    expect(await env.repo.getTree("t1")).toEqual(before);
  });

  test("an imported photo whose id collides keeps the existing photo untouched", async () => {
    const existing = new Blob(["existing"], { type: "image/png" });
    await env.repo.putPhoto("shared", existing);
    // Another tree uses it, so the clean-up after the import keeps it.
    const khans = famSimple();
    const [khanId] = Object.keys(khans.persons);
    await env.repo.saveTree({
      ...khans,
      id: "t1",
      name: "Khans",
      persons: { ...khans.persons, [khanId!]: { ...khans.persons[khanId!]!, photoId: "shared" } },
    });
    const imported = famHalfSiblings();
    const [personId] = Object.keys(imported.persons);
    const doc = {
      ...imported,
      persons: {
        ...imported.persons,
        [personId!]: { ...imported.persons[personId!]!, photoId: "shared" },
      },
    };
    const json = await exportStamJson(
      doc,
      { shared: new Blob(["imported"], { type: "image/jpeg" }) },
      { includePhotos: true },
    );
    renderList();
    await screen.findByText("Khans");
    await userEvent
      .setup()
      .upload(screen.getByLabelText("Import"), new File([json], "x.stam.json"));
    expect(await screen.findByText("editor opened")).toBeTruthy();

    // The stored blob is a structured clone, so its mime type tells the two photos apart.
    expect((await env.repo.getPhoto("shared"))!.type).toBe("image/png");
    const trees = await env.repo.listTrees();
    const importedTree = await env.repo.getTree(trees.find((t) => t.id !== "t1")!.id);
    const newPhotoId = importedTree!.doc.persons[personId!]!.photoId!;
    expect(newPhotoId).not.toBe("shared");
    expect((await env.repo.getPhoto(newPhotoId))!.type).toBe("image/jpeg");
  });

  test("an imported person never shows a photo that is not in the file", async () => {
    await env.repo.putPhoto("other-trees-photo", new Blob(["x"], { type: "image/png" }));
    const imported = famHalfSiblings();
    const [personId] = Object.keys(imported.persons);
    const doc = {
      ...imported,
      persons: {
        ...imported.persons,
        [personId!]: { ...imported.persons[personId!]!, photoId: "other-trees-photo" },
      },
    };
    const json = await exportStamJson(doc, {}, { includePhotos: false });
    renderList();
    await screen.findByText("Start your family tree");
    await userEvent.setup().upload(screen.getByLabelText("Import"), new File([json], "x.json"));
    expect(await screen.findByText("editor opened")).toBeTruthy();
    const [meta] = await env.repo.listTrees();
    const stored = await env.repo.getTree(meta!.id);
    expect(stored!.doc.persons[personId!]!.photoId).toBeUndefined();
  });

  test("the editor is told how many photos were skipped, counting only dropped photos", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    const file = JSON.parse(await exportStamJson(famHalfSiblings(), {}, { includePhotos: false }));
    file.photos = { bad1: "not a data url", bad2: "data:text/html;base64,AAAA" };
    await userEvent
      .setup()
      .upload(screen.getByLabelText("Import"), new File([JSON.stringify(file)], "p.json"));
    expect(await screen.findByText("editor opened")).toBeTruthy();
    expect(screen.getByTestId("skipped").textContent).toBe("2");
  });

  test("an import without skipped photos hands over a zero count", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    const json = await exportStamJson(famHalfSiblings(), {}, { includePhotos: false });
    await userEvent.setup().upload(screen.getByLabelText("Import"), new File([json], "ok.json"));
    await screen.findByText("editor opened");
    expect(screen.getByTestId("skipped").textContent).toBe("0");
  });

  test("a file that is not a Stam tree shows the reason and adds nothing", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    const file = new File(["{ nope"], "bad.json", { type: "application/json" });
    await userEvent.setup().upload(screen.getByLabelText("Import"), file);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This file isn't valid JSON, so it can't be a family tree.",
    );
    expect(await env.repo.listTrees()).toHaveLength(0);
  });

  test("a file over 50 MB is refused without being read", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    const file = new File(["{}"], "huge.json", { type: "application/json" });
    Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 + 1 });
    let read = false;
    file.text = async () => {
      read = true;
      return "{}";
    };
    await userEvent.setup().upload(screen.getByLabelText("Import"), file);
    expect((await screen.findByRole("alert")).textContent).toContain("too large");
    expect(read).toBe(false);
  });

  test("each import error code has its own translated message", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    const user = userEvent.setup();
    const notStam = new File([JSON.stringify({ format: "other" })], "x.json");
    await user.upload(screen.getByLabelText("Import"), notStam);
    expect((await screen.findByRole("alert")).textContent).toContain("isn't a family tree");
    const future = new File([JSON.stringify({ format: "stam", schemaVersion: 99 })], "y.json");
    await user.upload(screen.getByLabelText("Import"), future);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("newer version"));
  });

  test("delete asks for confirmation and cancel keeps the tree", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await chooseAction(user, "Khans", "Delete");
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Khans");
    // The name is user text: isolate it so a right-to-left name cannot reorder the sentence.
    expect(dialog.querySelector("bdi")?.textContent).toBe("Khans");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await env.repo.listTrees()).toHaveLength(1);
  });

  test("confirming delete removes the tree", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await chooseAction(user, "Khans", "Delete");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Start your family tree")).toBeTruthy();
    expect(await env.repo.listTrees()).toHaveLength(0);
  });

  test("deleting a tree deletes the photos only it used, and keeps the others", async () => {
    await env.repo.saveTree(withPhoto({ ...famSimple(), id: "t1", name: "Khans" }, "khan-photo"));
    await env.repo.saveTree(withPhoto({ ...famHalfSiblings(), id: "t2", name: "Shahs" }, "shah"));
    await env.repo.putPhoto("khan-photo", new Blob(["k"], { type: "image/png" }));
    await env.repo.putPhoto("shah", new Blob(["s"], { type: "image/png" }));
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await chooseAction(user, "Khans", "Delete");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect(await env.repo.getPhoto("khan-photo")).toBeUndefined());
    expect(await env.repo.getPhoto("shah")).toBeDefined();
  });

  test("an import also clears out photos nothing uses any more", async () => {
    await env.repo.putPhoto("left-over", new Blob(["x"], { type: "image/png" }));
    const json = await exportStamJson(famHalfSiblings(), {}, { includePhotos: false });
    renderList();
    await screen.findByText("Start your family tree");
    await userEvent.setup().upload(screen.getByLabelText("Import"), new File([json], "x.json"));
    expect(await screen.findByText("editor opened")).toBeTruthy();
    await waitFor(async () => expect(await env.repo.getPhoto("left-over")).toBeUndefined());
  });

  test("rename and delete tell an editor open on the tree in another tab", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    const heard: TreeChange[] = [];
    const editorTab = createTabSync("t1", (change) => heard.push(change), { tabId: "tab-e" });
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await chooseAction(user, "Khans", "Rename");
    const input = within(screen.getByRole("dialog")).getByLabelText("Tree name");
    await user.clear(input);
    await user.type(input, "Khan line");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(heard).toEqual(["renamed"]));
    await chooseAction(user, "Khan line", "Delete");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(heard).toEqual(["renamed", "deleted"]));
    editorTab.close();
  });

  test("a rename never overwrites a save that came in while the dialog was open", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    const realGet = env.repo.getTree;
    // Another tab saves right after the list read the tree.
    env.repo.getTree = async (id) => {
      const found = await realGet(id);
      await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Other tab" });
      return found;
    };
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await chooseAction(user, "Khans", "Rename");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That didn't work. Try again.")).toBeTruthy();
    expect((await realGet("t1"))!.doc.name).toBe("Other tab");
  });

  test("Escape closes a dialog without acting", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await chooseAction(user, "Khans", "Delete");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await env.repo.listTrees()).toHaveLength(1);
  });

  test("rename changes the tree name", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await chooseAction(user, "Khans", "Rename");
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("Tree name") as HTMLInputElement;
    expect(input.value).toBe("Khans");
    await user.clear(input);
    await user.type(input, "Khan line");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Khan line")).toBeTruthy();
    expect((await env.repo.getTree("t1"))!.doc.name).toBe("Khan line");
  });

  test("rename trims the name through renameTree and bumps the edit time", async () => {
    const stored = { ...famSimple(), id: "t1", name: "Khans" };
    await env.repo.saveTree(stored);
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await chooseAction(user, "Khans", "Rename");
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("Tree name");
    await user.clear(input);
    await user.type(input, "  Padded  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByText("Padded");
    const after = (await env.repo.getTree("t1"))!.doc;
    expect(after).toEqual({ ...stored, name: "Padded", updatedAt: after.updatedAt });
    expect(after.updatedAt > stored.updatedAt).toBe(true);
  });

  test("a failing backup shows a notice instead of an unhandled rejection", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    await screen.findByText("Khans");
    spyOn(env.repo, "getTree").mockRejectedValue(new Error("disk"));
    await chooseAction(userEvent.setup(), "Khans", "Download backup");
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
  });

  test("a backup of a tree that vanished shows the same notice", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    await screen.findByText("Khans");
    await env.repo.deleteTree("t1");
    await chooseAction(userEvent.setup(), "Khans", "Download backup");
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
  });

  test("duplicate adds a copy and leaves the original", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    await screen.findByText("Khans");
    await chooseAction(userEvent.setup(), "Khans", "Duplicate");
    expect(await screen.findByText("Khans (copy)")).toBeTruthy();
    expect(await env.repo.listTrees()).toHaveLength(2);
  });

  test("shows the backup reminder when it is due, and it can be dismissed", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    const state: BackupState = {
      editDays: [
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
      ],
    };
    await env.repo.setSetting("backup", state);
    renderList();
    const banner = await screen.findByText(/last backup/i);
    expect(banner).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/last backup/i)).toBeNull();
  });

  test("no backup reminder when none is due", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    await screen.findByText("Khans");
    expect(screen.queryByText(/last backup/i)).toBeNull();
  });

  test("warns when storage is almost full", async () => {
    setStorage({ estimate: async () => ({ usage: 85, quota: 100 }) });
    renderList();
    expect(await screen.findByText("Storage is almost full. Download a backup.")).toBeTruthy();
  });

  test("no storage warning below the threshold", async () => {
    const estimate = spyOn({ estimate: async () => ({ usage: 50, quota: 100 }) }, "estimate");
    setStorage({ estimate });
    renderList();
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(screen.queryByText(/almost full/)).toBeNull();
  });
});

describe("TreeListPage: the first run", () => {
  test("invites you to start, with New tree, Import and the privacy promise", async () => {
    renderList();
    const title = await screen.findByRole("heading", { name: "Start your family tree" });
    const invite = title.closest("section")!;
    expect(invite.textContent).toContain("Everything stays on this device. Nothing is uploaded.");
    expect(within(invite).getByRole("button", { name: "New tree" })).toBeTruthy();
    expect(within(invite).getByLabelText("Import")).toBeTruthy();
    // The header keeps only what the invitation does not offer: one New tree, one Import.
    expect(screen.getAllByRole("button", { name: "New tree" })).toHaveLength(1);
    expect(screen.getAllByLabelText("Import")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  test("once there is a tree, New tree and Import move to the header", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    await screen.findByText("Khans");
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("button", { name: "New tree" })).toBeTruthy();
    expect(within(header).getByLabelText("Import")).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByText("Start your family tree")).toBeNull();
  });
});

describe("TreeListPage: tree cards", () => {
  test("a card shows a preview, the name, people, generations and the edit time", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const link = await screen.findByRole("link", { name: "Khans" });
    const card = link.closest("li")!;
    expect(within(card).getByText("5 people")).toBeTruthy();
    expect(await within(card).findByText("2 generations")).toBeTruthy();
    expect(within(card).getByText(/^edited /)).toBeTruthy();
    // The thumbnail: one box per person, decorative (the text says what it shows).
    const svg = card.querySelector("svg.tree-preview")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll(".tree-preview__card")).toHaveLength(5);
  });

  test("an empty tree shows a placeholder drawing and no generations", async () => {
    await env.repo.saveTree({
      ...famSimple(),
      id: "t0",
      name: "Blank",
      persons: {},
      unions: {},
      unionOrder: {},
      rootPersonId: undefined,
    });
    renderList();
    const card = (await screen.findByRole("link", { name: "Blank" })).closest("li")!;
    expect(await within(card).findByText("0 people")).toBeTruthy();
    await waitFor(() => expect(card.querySelector(".tree-preview--empty")).toBeTruthy());
    expect(within(card).queryByText(/generation/)).toBeNull();
  });

  test("one person is one generation", async () => {
    await env.repo.saveTree({
      ...famSimple(),
      id: "solo",
      name: "Solo",
      persons: { dad: famSimple().persons.dad! },
      unions: {},
      unionOrder: {},
    });
    renderList();
    expect(await screen.findByText("1 generation")).toBeTruthy();
  });

  test("the ⋯ menu lists Rename, Duplicate, Download backup and a destructive Delete", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const user = userEvent.setup();
    const more = await screen.findByRole("button", { name: "Actions for Khans" });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
    const menu = screen.getByRole("menu", { name: "Khans" });
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Rename",
      "Duplicate",
      "Download backup",
      "Delete",
    ]);
    expect(items[3]!.className).toContain("menu-item--danger");
    // The first item takes the focus; Escape closes and gives the focus back to the button.
    expect(document.activeElement).toBe(items[0]!);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  test("the keyboard reaches the card link, then its menu", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const link = await screen.findByRole("link", { name: "Khans" });
    link.focus();
    await userEvent.setup().tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for Khans" }));
  });

  test("Delete from the menu still asks first", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const user = userEvent.setup();
    await chooseAction(user, "Khans", "Delete");
    const dialog = screen.getByRole("dialog", { name: "Delete this tree?" });
    expect(within(dialog).getByRole("button", { name: "Delete" }).className).toContain(
      "button-danger",
    );
    expect(await env.repo.listTrees()).toHaveLength(1);
  });
});

describe("TreeListPage: GEDCOM import", () => {
  const FULL = `${import.meta.dir}/../../fixtures/gedcom/full-551.ged`;

  test("the file picker accepts .ged files", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    expect((screen.getByLabelText("Import") as HTMLInputElement).accept).toContain(".ged");
  });

  test("a .ged file is saved as a tree, its report shown, and Open tree opens it", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText("Import"),
      new File([await Bun.file(FULL).text()], "Khan family.ged"),
    );
    const dialog = await screen.findByRole("dialog", { name: "Import report" });
    expect(dialog.textContent).toContain("Imported 9 people and 3 families.");
    expect(dialog.textContent).toContain("3 lines were not imported");
    expect(dialog.textContent).toContain("Line 80");
    expect(dialog.textContent).toContain("OCCU");
    expect(dialog.textContent).toContain("not used by this app");
    expect(dialog.textContent).toContain("Mystery Person");
    expect(dialog.querySelector("details")).toBeTruthy();
    // The skipped lines scroll inside the dialog, so keyboard users can focus the list to scroll
    // it; it is named by its summary.
    const list = within(dialog).getByRole("list", { name: "3 lines were not imported" });
    expect(list.tabIndex).toBe(0);
    const trees = await env.repo.listTrees();
    expect(trees.map((t) => [t.name, t.peopleCount])).toEqual([["Khan family", 9]]);
    await user.click(within(dialog).getByRole("button", { name: "Open tree" }));
    expect(await screen.findByText("editor opened")).toBeTruthy();
  });

  test("closing the report stays on the list, which now shows the tree", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText("Import"),
      new File(["0 HEAD\n0 @I1@ INDI\n1 NAME Solo /One/\n1 SEX F\n0 TRLR\n"], "solo.ged"),
    );
    const dialog = await screen.findByRole("dialog", { name: "Import report" });
    expect(dialog.textContent).toContain("Imported 1 person and 0 families.");
    expect(dialog.textContent).toContain("Everything in the file was imported.");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(await screen.findByText("solo")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("GEDCOM with another extension is still recognised", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    // As if picked with "All files": the picker's filter is only a suggestion.
    await userEvent
      .setup({ applyAccept: false })
      .upload(
        screen.getByLabelText("Import"),
        new File(["﻿0 HEAD\r\n0 @I1@ INDI\r\n1 NAME Ann\r\n0 TRLR\r\n"], "export.txt"),
      );
    expect(await screen.findByRole("dialog", { name: "Import report" })).toBeTruthy();
    expect(await env.repo.listTrees()).toHaveLength(1);
  });

  test("a .ged file that is not GEDCOM shows the reason and adds nothing", async () => {
    renderList();
    await screen.findByText("Start your family tree");
    await userEvent
      .setup()
      .upload(screen.getByLabelText("Import"), new File(["just some notes"], "notes.ged"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This file isn't a GEDCOM family tree.",
    );
    expect(await env.repo.listTrees()).toHaveLength(0);
  });
});

describe("TreeListPage: after a GEDCOM import", () => {
  test("calls the injected afterImport hook once the tree is saved", async () => {
    const seen: number[] = [];
    renderApp(
      <Routes>
        <Route
          path="/app"
          element={
            <TreeListPage
              afterImport={async () => {
                seen.push((await env.repo.listTrees()).length);
              }}
            />
          }
        />
      </Routes>,
      { repo: env.repo },
    );
    await screen.findByText("Start your family tree");
    await userEvent
      .setup()
      .upload(
        screen.getByLabelText("Import"),
        new File(["0 HEAD\n0 @I1@ INDI\n1 NAME Ann\n0 TRLR\n"], "a.ged"),
      );
    await screen.findByRole("dialog", { name: "Import report" });
    expect(seen).toEqual([1]);
  });

  test("by default it clears out photos nothing uses any more", async () => {
    await env.repo.putPhoto("left-over", new Blob(["x"], { type: "image/png" }));
    renderApp(
      <Routes>
        <Route path="/app" element={<TreeListPage />} />
      </Routes>,
      { repo: env.repo },
    );
    await screen.findByText("Start your family tree");
    await userEvent
      .setup()
      .upload(
        screen.getByLabelText("Import"),
        new File(["0 HEAD\n0 @I1@ INDI\n1 NAME Ann\n0 TRLR\n"], "a.ged"),
      );
    await screen.findByRole("dialog", { name: "Import report" });
    await waitFor(async () => expect(await env.repo.getPhoto("left-over")).toBeUndefined());
  });

  test("a failing hook does not fail the import", async () => {
    renderApp(
      <Routes>
        <Route
          path="/app"
          element={<TreeListPage afterImport={() => Promise.reject(new Error("boom"))} />}
        />
      </Routes>,
      { repo: env.repo },
    );
    await screen.findByText("Start your family tree");
    await userEvent
      .setup()
      .upload(
        screen.getByLabelText("Import"),
        new File(["0 HEAD\n0 @I1@ INDI\n1 NAME Ann\n0 TRLR\n"], "a.ged"),
      );
    expect(await screen.findByRole("dialog", { name: "Import report" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

const bigGedcom = (people: number) =>
  new File(
    [
      "0 HEAD\n" +
        Array.from({ length: people }, (_, i) => `0 @I${i}@ INDI\n1 NAME P${i} /X/\n`).join("") +
        "0 TRLR\n",
    ],
    "big.ged",
  );

function renderLargePage() {
  renderApp(
    <Routes>
      <Route path="/app" element={<TreeListPage afterImport={async () => {}} />} />
    </Routes>,
    { repo: env.repo },
  );
}

describe("TreeListPage: a GEDCOM file larger than the app is tuned for", () => {
  test("over 5,000 people asks first; Cancel imports nothing", async () => {
    renderLargePage();
    await screen.findByText("Start your family tree");
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Import"), bigGedcom(5001));
    const ask = await screen.findByRole("dialog", { name: "Large family tree" });
    expect(ask.textContent).toContain(
      "This file has 5,001 people; Stam is tuned for up to 5,000. Continue?",
    );
    await user.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await env.repo.listTrees()).toEqual([]);
  });

  test("Continue imports it and shows the report", async () => {
    renderLargePage();
    await screen.findByText("Start your family tree");
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Import"), bigGedcom(5001));
    const ask = await screen.findByRole("dialog", { name: "Large family tree" });
    await user.click(within(ask).getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("dialog", { name: "Import report" })).toBeTruthy();
    expect(await env.repo.listTrees()).toHaveLength(1);
  });

  test("5,000 people imports without asking", async () => {
    renderLargePage();
    await screen.findByText("Start your family tree");
    await userEvent.setup().upload(screen.getByLabelText("Import"), bigGedcom(5000));
    expect(await screen.findByRole("dialog", { name: "Import report" })).toBeTruthy();
  });
});
