import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, screen } from "@testing-library/react";

import en from "@/i18n/locales/en.json";
import { shortcutLabel } from "@/ui/app/Tip";
import { Toolbar } from "@/ui/app/Toolbar";
import { createEditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";

let env: Awaited<ReturnType<typeof makeEditorEnv>>;

afterEach(cleanup);
beforeEach(async () => {
  env = await makeEditorEnv();
});

const noop = () => {};

async function mount() {
  const doc = famSimple();
  await env.repo.saveTree(doc);
  const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
  await store.getState().load(doc.id);
  renderApp(
    <EditorContext.Provider value={store}>
      <Toolbar
        autosaver={env.autosaver}
        onZoomIn={noop}
        onZoomOut={noop}
        onFit={noop}
        onOpenSearch={noop}
        onOpenUnconnected={noop}
        onToggleRelation={noop}
        onShowPerson={noop}
        onOpenExport={noop}
      />
    </EditorContext.Provider>,
    { repo: env.repo },
  );
}

const hints = (en.toolbar as Record<string, unknown>).hint as Record<string, string>;

function tipOf(name: RegExp | string) {
  const button = screen.getByRole("button", { name });
  const id = button.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  const tip = document.getElementById(id!);
  expect(tip?.getAttribute("role")).toBe("tooltip");
  expect(button.hasAttribute("title")).toBe(false);
  return tip!.textContent ?? "";
}

describe("toolbar hints", () => {
  test("every icon button has a description tooltip and no native title", async () => {
    await mount();
    expect(tipOf("Undo")).toContain(hints.undo!);
    expect(tipOf("Redo")).toContain(hints.redo!);
    expect(tipOf("Zoom out")).toContain(hints.zoomOut!);
    expect(tipOf("Zoom in")).toContain(hints.zoomIn!);
    expect(tipOf("Fit tree to screen")).toContain(hints.fit!);
    expect(tipOf("Search people")).toContain(hints.search!);
    expect(tipOf("Focus mode")).toContain(hints.focusMode!);
    expect(tipOf("How are we related?")).toContain(hints.relate!);
    expect(tipOf(/Birthdays/)).toContain(hints.birthdays!);
    expect(tipOf("Menu")).toContain(hints.menu!);
  });

  test("shortcuts are shown where they exist", async () => {
    await mount();
    expect(tipOf("Undo")).toContain(shortcutLabel("Z"));
    expect(tipOf("Search people")).toContain(shortcutLabel("F"));
  });

  test("shortcutLabel uses ⌘ on Mac and Ctrl elsewhere", () => {
    expect(shortcutLabel("Z", { shift: true }, true)).toBe("⇧⌘Z");
    expect(shortcutLabel("Z", { shift: true }, false)).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("F", {}, false)).toBe("Ctrl+F");
  });
});
