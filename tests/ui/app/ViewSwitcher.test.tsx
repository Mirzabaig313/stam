import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, screen } from "@testing-library/react";

import en from "@/i18n/locales/en.json";
import { ViewSwitcher } from "@/ui/app/ViewSwitcher";
import { createEditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";
import { VIEW_MODES } from "@/ui/store/viewLayouts";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

let env: Awaited<ReturnType<typeof makeEditorEnv>>;

afterEach(cleanup);
beforeEach(async () => {
  env = await makeEditorEnv();
});

async function mount() {
  const doc = famSimple();
  await env.repo.saveTree(doc);
  const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
  await store.getState().load(doc.id);
  renderApp(
    <EditorContext.Provider value={store}>
      <ViewSwitcher />
    </EditorContext.Provider>,
    { repo: env.repo },
  );
}

describe("view switcher hints", () => {
  test("every view mode has a short description", () => {
    const hints = (en.views as Record<string, unknown>).hint as Record<string, string>;
    for (const mode of VIEW_MODES) {
      expect(typeof hints[mode]).toBe("string");
      expect(hints[mode]!.length).toBeGreaterThan(10);
    }
  });

  test("each button is described by a tooltip with its description and shortcut", async () => {
    await mount();
    const hints = (en.views as Record<string, unknown>).hint as Record<string, string>;
    VIEW_MODES.forEach((mode, index) => {
      const label = ((en.views as Record<string, unknown>).mode as Record<string, string>)[mode]!;
      const button = screen.getByRole("button", { name: label });
      const id = button.getAttribute("aria-describedby");
      expect(id).toBeTruthy();
      const tip = document.getElementById(id!);
      expect(tip?.getAttribute("role")).toBe("tooltip");
      expect(tip?.textContent).toContain(hints[mode]!);
      expect(tip?.textContent).toContain(`Alt+${index + 1}`);
      // One tooltip only: no native title competing with it.
      expect(button.hasAttribute("title")).toBe(false);
    });
  });
});
