import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";

import { announceTreeChange, createTabSync } from "@/storage/multitab";
import { AppRoutes } from "@/ui/app/AppRoutes";
import { EditorPage } from "@/ui/app/EditorPage";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";
import { reduceMotion } from "../i18n";

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;

beforeEach(async () => {
  env = await makeEditorEnv();
  Object.defineProperty(navigator, "storage", { value: {}, configurable: true });
  reduceMotion(true);
});

afterEach(() => {
  cleanup();
  reduceMotion(false);
});

/** Shows the router's location state, so a test can see whether the page cleared it. */
function LocationState() {
  return <output data-testid="location-state">{JSON.stringify(useLocation().state)}</output>;
}

const renderWithSkipped = () =>
  renderApp(
    <>
      <LocationState />
      <Routes>
        <Route path="/app/t/:treeId" element={<EditorPage />} />
      </Routes>
    </>,
    { repo: env.repo, route: "/app/t/t1", state: { skippedPhotos: 2 } },
  );

/** `fakeTimers` stops the autosave debounce from firing by itself, so only a flush can save. */
function renderEditor(treeId = "t1", opts: { fakeTimers?: boolean } = {}) {
  const autosaverOptions = opts.fakeTimers ? { timers: env.clock.timers } : undefined;
  return renderApp(
    <>
      <LocationState />
      <Routes>
        <Route path="/app" element={<p>tree list</p>} />
        <Route path="/app/t/:treeId" element={<EditorPage autosaverOptions={autosaverOptions} />} />
      </Routes>
    </>,
    { repo: env.repo, route: `/app/t/${treeId}` },
  );
}

const storedName = async () => (await env.repo.getTree("t1"))!.doc.name;

async function renameInToolbar(name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^Rename tree/ }));
  const input = screen.getByRole("textbox", { name: "Tree name" });
  await user.clear(input);
  await user.type(input, `${name}{Enter}`);
}

const save = (extra: Partial<ReturnType<typeof famSimple>> = {}) =>
  env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans", ...extra });

describe("EditorPage", () => {
  test("shows a loading state, then the toolbar and the canvas slot", async () => {
    await save();
    const { container } = renderEditor();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /^Rename tree/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Rename tree/ }).textContent).toBe("Khans");
    expect(container.querySelector('[data-slot="canvas"]')).not.toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  test("a tree that does not exist can't be opened", async () => {
    renderEditor("ghost");
    expect(await screen.findByText("This tree couldn't be opened")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to your trees" }).getAttribute("href")).toBe(
      "/app",
    );
  });

  test("a repo failure also can't be opened", async () => {
    env.repo.getTree = () => Promise.reject(new Error("disk"));
    renderEditor();
    expect(await screen.findByText("This tree couldn't be opened")).toBeTruthy();
  });

  test("says so when the tree was recovered from a backup snapshot", async () => {
    const doc = { ...famSimple(), id: "t1", name: "Khans" };
    await env.repo.saveTree(doc);
    await env.repo.takeSnapshot(doc);
    await env.db.put("trees", { ...doc, unions: null });
    renderEditor();
    expect(await screen.findByText(/Recovered from a backup snapshot/)).toBeTruthy();
  });

  test("no recovery notice for a healthy tree", async () => {
    await save();
    renderEditor();
    await screen.findByRole("button", { name: /^Rename tree/ });
    expect(screen.queryByText(/Recovered/)).toBeNull();
  });

  test("another tab's save makes this tab read-only, but not for other trees", async () => {
    await save();
    renderEditor("t1", { fakeTimers: true });
    await screen.findByRole("button", { name: /^Rename tree/ });
    // A different tab: the module's own tab id would be filtered out as "this tab".
    const other = createTabSync("some-other-tree", () => {}, { tabId: "tab-b" });
    other.announceSave();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(screen.queryByText(/changed in another tab/)).toBeNull();

    const sameTree = createTabSync("t1", () => {}, { tabId: "tab-b" });
    sameTree.announceSave();
    expect(
      await screen.findByText("This tree changed in another tab. Reload to keep editing."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    other.close();
    sameTree.close();

    // Read-only: an edit is refused, and nothing is saved, not even on pagehide.
    await renameInToolbar("Stale tab");
    expect(screen.getByRole("button", { name: /^Rename tree/ }).textContent).toBe("Khans");
    window.dispatchEvent(new Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await storedName()).toBe("Khans");
  });

  test("a rename from the tree list in another tab also makes it read-only", async () => {
    await save();
    renderEditor();
    await screen.findByRole("button", { name: /^Rename tree/ });
    announceTreeChange("t1", "renamed", { tabId: "tab-list" });
    expect(await screen.findByText(/changed in another tab/)).toBeTruthy();
  });

  test("a delete in another tab is final and offers the way back to My trees", async () => {
    await save();
    renderEditor();
    await screen.findByRole("button", { name: /^Rename tree/ });
    announceTreeChange("t1", "deleted", { tabId: "tab-list" });
    expect(await screen.findByText("This tree was deleted in another tab.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to My trees" }).getAttribute("href")).toBe(
      "/app",
    );
    // A later "changed" does not hide that the tree is gone.
    announceTreeChange("t1", "renamed", { tabId: "tab-list" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(screen.getByText("This tree was deleted in another tab.")).toBeTruthy();
    expect(screen.queryByText(/changed in another tab/)).toBeNull();
  });

  test("a save that another tab beat (no message heard) is refused and goes read-only", async () => {
    await save();
    renderEditor("t1", { fakeTimers: true });
    await renameInToolbar("Stale tab");
    // Another tab saved meanwhile, and its message never arrived.
    await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Other tab" });
    window.dispatchEvent(new Event("pagehide"));
    expect(await screen.findByText(/changed in another tab/)).toBeTruthy();
    expect(await storedName()).toBe("Other tab");
    expect(screen.queryByText("Couldn't save")).toBeNull();
  });

  test("a save after the tree was deleted elsewhere never brings it back", async () => {
    await save();
    renderEditor("t1", { fakeTimers: true });
    await renameInToolbar("Ghost");
    await env.repo.deleteTree("t1");
    window.dispatchEvent(new Event("pagehide"));
    expect(await screen.findByText("This tree was deleted in another tab.")).toBeTruthy();
    expect(await env.repo.getTree("t1")).toBeNull();
  });

  describe("skipped photos notice", () => {
    test("shows how many photos an import skipped", async () => {
      await save();
      renderWithSkipped();
      expect(
        await screen.findByText("2 photos were skipped because they couldn't be read."),
      ).toBeTruthy();
    });

    test("is read once: the history entry loses its state so a reload does not repeat it", async () => {
      await save();
      renderWithSkipped();
      await screen.findByText(/2 photos were skipped/);
      await waitFor(() => expect(screen.getByTestId("location-state").textContent).toBe("null"));
      // The notice stays until dismissed.
      expect(screen.getByText(/2 photos were skipped/)).toBeTruthy();
    });

    test("can be dismissed", async () => {
      await save();
      renderWithSkipped();
      await screen.findByText(/2 photos were skipped/);
      const banner = screen.getByText(/2 photos were skipped/).closest(".banner") as HTMLElement;
      await userEvent.setup().click(within(banner).getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText(/photos were skipped/)).toBeNull();
    });
  });

  test("announces its own saves to other tabs", async () => {
    await save();
    let told = 0;
    const listener = createTabSync("t1", () => told++, { tabId: "tab-b" });
    renderEditor();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Rename tree/ }));
    await user.type(screen.getByRole("textbox", { name: "Tree name" }), " line{Enter}");
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => expect(told).toBe(1));
    listener.close();
  });

  test("warns when storage is almost full", async () => {
    Object.defineProperty(navigator, "storage", {
      value: { estimate: async () => ({ usage: 9, quota: 10 }) },
      configurable: true,
    });
    await save();
    renderEditor();
    expect(await screen.findByText("Storage is almost full. Download a backup.")).toBeTruthy();
  });

  // These run on a fake clock: the 500 ms debounce can never fire, so a save can only come from
  // the flush on pagehide, tab hide or unmount.
  test("a pending edit is not saved by itself (the fake clock holds the debounce)", async () => {
    await save();
    renderEditor("t1", { fakeTimers: true });
    await renameInToolbar("Khan line");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await storedName()).toBe("Khans");
  });

  test("pagehide saves a pending edit at once", async () => {
    await save();
    renderEditor("t1", { fakeTimers: true });
    await renameInToolbar("Khan line");
    expect(await storedName()).toBe("Khans");
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(async () => expect(await storedName()).toBe("Khan line"));
  });

  test("hiding the tab saves a pending edit at once", async () => {
    await save();
    renderEditor("t1", { fakeTimers: true });
    await renameInToolbar("Hidden");
    expect(await storedName()).toBe("Khans");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(async () => expect(await storedName()).toBe("Hidden"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  test("becoming visible again does not flush", async () => {
    await save();
    renderEditor("t1", { fakeTimers: true });
    await renameInToolbar("Still pending");
    document.dispatchEvent(new Event("visibilitychange")); // visibilityState is "visible"
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await storedName()).toBe("Khans");
  });

  test("leaving the page saves too", async () => {
    await save();
    const view = renderEditor("t1", { fakeTimers: true });
    await renameInToolbar("Left");
    expect(await storedName()).toBe("Khans");
    view.unmount();
    await waitFor(async () => expect(await storedName()).toBe("Left"));
  });
});

describe("AppRoutes", () => {
  test("/app is the tree list, unknown paths are not found with a link back", async () => {
    renderApp(<AppRoutes />, { repo: env.repo, route: "/app" });
    expect(await screen.findByText("Start your family tree")).toBeTruthy();
    cleanup();
    renderApp(<AppRoutes />, { repo: env.repo, route: "/nowhere" });
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to your trees" }).getAttribute("href")).toBe(
      "/app",
    );
  });

  test("/app/t/:id opens the editor", async () => {
    await save();
    renderApp(<AppRoutes />, { repo: env.repo, route: "/app/t/t1" });
    expect(await screen.findByRole("button", { name: /^Rename tree/ })).toBeTruthy();
  });
});
