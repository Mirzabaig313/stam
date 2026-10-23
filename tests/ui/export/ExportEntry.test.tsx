import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";

import { EditorPage } from "@/ui/app/EditorPage";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";
import { reduceMotion } from "../i18n";

let env: Awaited<ReturnType<typeof makeEditorEnv>>;

beforeEach(async () => {
  env = await makeEditorEnv();
  Object.defineProperty(navigator, "storage", { value: {}, configurable: true });
  reduceMotion(true);
  await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
});

afterEach(() => {
  cleanup();
  reduceMotion(false);
});

async function openEditor() {
  renderApp(
    <Routes>
      <Route path="/app/t/:treeId" element={<EditorPage />} />
    </Routes>,
    { repo: env.repo, route: "/app/t/t1" },
  );
  await screen.findByRole("button", { name: "More" });
  return userEvent.setup();
}

const dialog = () => screen.queryByRole("dialog", { name: "Export" });

describe("opening the export dialog", () => {
  test("the toolbar's More menu has an Export… entry", async () => {
    const user = await openEditor();
    expect(dialog()).toBeNull();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Export…" }));
    await waitFor(() => expect(dialog()).not.toBeNull());
    // The menu closed behind it.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("Ctrl+E and Cmd+E open it; Esc closes it", async () => {
    const user = await openEditor();
    await user.keyboard("{Control>}e{/Control}");
    await waitFor(() => expect(dialog()).not.toBeNull());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog()).toBeNull());
    await user.keyboard("{Meta>}e{/Meta}");
    await waitFor(() => expect(dialog()).not.toBeNull());
  });

  test("a plain E does nothing", async () => {
    const user = await openEditor();
    await user.keyboard("e");
    expect(dialog()).toBeNull();
  });
});
