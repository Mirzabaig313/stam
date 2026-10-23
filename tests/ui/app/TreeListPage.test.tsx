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

function renderList() {
  return renderApp(
    <Routes>
      <Route path="/app" element={<TreeListPage />} />
      <Route path="/app/t/:treeId" element={<EditorProbe />} />
    </Routes>,
    { repo: env.repo },
  );
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
    expect(await screen.findByText("Create your first tree")).toBeTruthy();
  });

  test("creating a tree lists it with its people count", async () => {
    renderList();
    await screen.findByText("Create your first tree");
    await createTree("Khan family");
    expect(await screen.findByText("Khan family")).toBeTruthy();
    expect(screen.getByText("0 people")).toBeTruthy();
    expect(screen.queryByText("Create your first tree")).toBeNull();
    expect((await env.repo.listTrees()).map((t) => t.name)).toEqual(["Khan family"]);
  });

  test("the name prompt starts with a default name", async () => {
    renderList();
    await screen.findByText("Create your first tree");
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
    await screen.findByText("Create your first tree");
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
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
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
    await screen.findByText("Create your first tree");
    await userEvent.setup().upload(screen.getByLabelText("Import"), new File([json], "x.json"));
    expect(await screen.findByText("editor opened")).toBeTruthy();
    const [meta] = await env.repo.listTrees();
    const stored = await env.repo.getTree(meta!.id);
    expect(stored!.doc.persons[personId!]!.photoId).toBeUndefined();
  });

  test("the editor is told how many photos were skipped, counting only dropped photos", async () => {
    renderList();
    await screen.findByText("Create your first tree");
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
    await screen.findByText("Create your first tree");
    const json = await exportStamJson(famHalfSiblings(), {}, { includePhotos: false });
    await userEvent.setup().upload(screen.getByLabelText("Import"), new File([json], "ok.json"));
    await screen.findByText("editor opened");
    expect(screen.getByTestId("skipped").textContent).toBe("0");
  });

  test("a file that is not a Stam tree shows the reason and adds nothing", async () => {
    renderList();
    await screen.findByText("Create your first tree");
    const file = new File(["{ nope"], "bad.json", { type: "application/json" });
    await userEvent.setup().upload(screen.getByLabelText("Import"), file);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This file isn't valid JSON, so it can't be a family tree.",
    );
    expect(await env.repo.listTrees()).toHaveLength(0);
  });

  test("a file over 50 MB is refused without being read", async () => {
    renderList();
    await screen.findByText("Create your first tree");
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
    await screen.findByText("Create your first tree");
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
    await user.click(screen.getByRole("button", { name: "Delete Khans" }));
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
    await user.click(screen.getByRole("button", { name: "Delete Khans" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Create your first tree")).toBeTruthy();
    expect(await env.repo.listTrees()).toHaveLength(0);
  });

  test("rename and delete tell an editor open on the tree in another tab", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    const heard: TreeChange[] = [];
    const editorTab = createTabSync("t1", (change) => heard.push(change), { tabId: "tab-e" });
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await user.click(screen.getByRole("button", { name: "Rename Khans" }));
    const input = within(screen.getByRole("dialog")).getByLabelText("Tree name");
    await user.clear(input);
    await user.type(input, "Khan line");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(heard).toEqual(["renamed"]));
    await user.click(await screen.findByRole("button", { name: "Delete Khan line" }));
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
    await user.click(screen.getByRole("button", { name: "Rename Khans" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That didn't work. Try again.")).toBeTruthy();
    expect((await realGet("t1"))!.doc.name).toBe("Other tab");
  });

  test("Escape closes a dialog without acting", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await user.click(screen.getByRole("button", { name: "Delete Khans" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await env.repo.listTrees()).toHaveLength(1);
  });

  test("rename changes the tree name", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    const user = userEvent.setup();
    await screen.findByText("Khans");
    await user.click(screen.getByRole("button", { name: "Rename Khans" }));
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
    await user.click(screen.getByRole("button", { name: "Rename Khans" }));
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
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup of Khans" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
  });

  test("a backup of a tree that vanished shows the same notice", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    await screen.findByText("Khans");
    await env.repo.deleteTree("t1");
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup of Khans" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
  });

  test("duplicate adds a copy and leaves the original", async () => {
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
    renderList();
    await screen.findByText("Khans");
    await userEvent.setup().click(screen.getByRole("button", { name: "Duplicate Khans" }));
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
