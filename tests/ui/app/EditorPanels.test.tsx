import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";

import type { TreeDocument } from "@/core/model/types";
import { EditorPage } from "@/ui/app/EditorPage";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { docOf, famSimple, person, union } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;

beforeEach(async () => {
  env = await makeEditorEnv();
  Object.defineProperty(navigator, "storage", { value: {}, configurable: true });
});

afterEach(cleanup);

/** The Khans, plus an old man and his son who are not connected to them. */
function khansAndStrangers(): TreeDocument {
  const khans = famSimple();
  return docOf(
    [
      ...Object.values(khans.persons),
      person("old", "Yusuf", "Lone", "male"),
      person("young", "Idris", "Lone", "male"),
    ],
    [...Object.values(khans.unions), union("ul", ["old"], ["young"])],
    "dad",
  );
}

async function renderEditor(doc: TreeDocument = famSimple()) {
  await env.repo.saveTree({ ...doc, id: "t1", name: "Khans" });
  const view = renderApp(
    <Routes>
      <Route path="/app/t/:treeId" element={<EditorPage />} />
    </Routes>,
    { repo: env.repo, route: "/app/t/t1" },
  );
  await screen.findByRole("button", { name: /^Rename tree/ });
  return { ...view, user: userEvent.setup() };
}

async function selectViaSearch(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.click(screen.getByRole("button", { name: "Search people" }));
  await user.type(screen.getByRole("searchbox"), `${query}{Enter}`);
}

const panel = () => screen.queryByRole("complementary", { name: "Person details" });

describe("EditorPage search", () => {
  test("the toolbar button opens search; picking selects the person and opens the panel", async () => {
    const { user } = await renderEditor();
    expect(panel()).toBeNull();
    await selectViaSearch(user, "zainab");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(within(panel()!).getByRole("heading", { name: "Zainab Khan" })).toBeTruthy();
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Zainab");
  });

  test("Ctrl+F and Cmd+F open search instead of the browser's find", async () => {
    const { user } = await renderEditor();
    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getByRole("searchbox")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("searchbox")).toBeNull();
    await user.keyboard("{Meta>}f{/Meta}");
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });

  // Where the camera ends up is checked against the real canvas in EditorCanvas.test.tsx.
  test("a person in the current view is picked without changing the view root", async () => {
    const { user } = await renderEditor(khansAndStrangers());
    await selectViaSearch(user, "zainab");
    expect(within(panel()!).getByRole("heading", { name: "Zainab Khan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });

  test("a person in a collapsed branch is shown by expanding it, not by re-rooting (I2)", async () => {
    const { user, container } = await renderEditor(khansAndStrangers());
    await user.click(screen.getByRole("button", { name: "Collapse the branch of Ahmed Khan" }));
    expect(container.querySelector('[data-node-id="c2"]')).toBeNull();
    // Collapsed children are still connected (I1).
    expect(screen.getByRole("button", { name: "2 not connected. Show them." })).toBeTruthy();

    await selectViaSearch(user, "zainab");

    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
    expect(container.querySelector('[data-node-id="c2"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Collapse the branch of Ahmed Khan" })).toBeTruthy();
    expect(within(panel()!).getByRole("heading", { name: "Zainab Khan" })).toBeTruthy();
  });

  test("a person outside the view first moves the view root to their topmost ancestor", async () => {
    const { user } = await renderEditor(khansAndStrangers());
    expect(screen.getByRole("button", { name: "2 not connected. Show them." })).toBeTruthy();

    await selectViaSearch(user, "idris");

    expect(screen.getByRole("button", { name: /Back to/ }).textContent).toContain("Ahmed Khan");
    expect(screen.getByRole("button", { name: "5 not connected. Show them." })).toBeTruthy();
    expect(within(panel()!).getByRole("heading", { name: "Idris Lone" })).toBeTruthy();
  });
});

describe("EditorPage unconnected list", () => {
  test("the badge opens the list; clicking a person sets the view root", async () => {
    const { user } = await renderEditor(khansAndStrangers());
    await user.click(screen.getByRole("button", { name: "2 not connected. Show them." }));
    const list = screen.getByRole("region", { name: "Not connected" });
    await user.click(within(list).getByRole("button", { name: "Idris Lone" }));
    expect(screen.queryByRole("region", { name: "Not connected" })).toBeNull();
    expect(screen.getByRole("button", { name: /Back to/ })).toBeTruthy();
    // Idris is the view root now, so his father and the five Khans are out of reach.
    expect(screen.getByRole("button", { name: "6 not connected. Show them." })).toBeTruthy();
  });

  test("a focus view counts from the family view; a pick switches to the family view", async () => {
    const { user } = await renderEditor(khansAndStrangers());
    await user.click(screen.getByRole("button", { name: /^Pedigree/ }));
    // The pedigree of Ahmed draws only him, but the badge is about the family view.
    await user.click(screen.getByRole("button", { name: "2 not connected. Show them." }));
    const list = screen.getByRole("region", { name: "Not connected" });
    await user.click(within(list).getByRole("button", { name: "Idris Lone" }));
    const family = screen.getByRole("button", { name: /^Family/ });
    expect(family.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Back to/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "6 not connected. Show them." })).toBeTruthy();
  });

  test("clicking the badge again closes the list", async () => {
    const { user } = await renderEditor(khansAndStrangers());
    const badge = screen.getByRole("button", { name: "2 not connected. Show them." });
    await user.click(badge);
    expect(screen.getByRole("region", { name: "Not connected" })).toBeTruthy();
    await user.click(badge);
    expect(screen.queryByRole("region", { name: "Not connected" })).toBeNull();
  });
});

describe("EditorPage delete", () => {
  test("the panel's Delete… button opens the dialog, and deleting removes the person", async () => {
    const { user } = await renderEditor();
    await selectViaSearch(user, "omar");
    await user.click(screen.getByRole("button", { name: "Delete…" }));
    await user.click(screen.getByRole("button", { name: "Delete Omar Khan only" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The person is gone, so the panel closes with them.
    await waitFor(() => expect(panel()).toBeNull());
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await selectViaSearch(user, "omar");
    expect(panel()).toBeTruthy();
  });

  test("the Delete key asks to delete the selected person", async () => {
    const { user } = await renderEditor();
    await selectViaSearch(user, "ahmed");
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Delete}");
    expect(
      screen.getByRole("button", { name: "Delete Ahmed Khan and 3 descendants" }),
    ).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Backspace asks too, but not while typing in a field", async () => {
    const { user } = await renderEditor();
    await selectViaSearch(user, "omar");
    await user.click(screen.getByLabelText("First name"));
    await user.keyboard("{Backspace}{Delete}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Oma");

    await user.tab();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Backspace}");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("the Delete key does nothing without a selection", async () => {
    const { user } = await renderEditor();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("EditorPage panel", () => {
  test("closing the panel deselects", async () => {
    const { user } = await renderEditor();
    await selectViaSearch(user, "omar");
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(panel()).toBeNull();
  });

  test("editing in the panel is undoable from the toolbar", async () => {
    const { user } = await renderEditor();
    await selectViaSearch(user, "omar");
    const input = screen.getByLabelText("First name");
    await user.clear(input);
    await user.type(input, "Umar");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Omar");
  });
});
