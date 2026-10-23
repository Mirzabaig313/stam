import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";

import { i18n, languageReady } from "@/i18n";
import { EditorPage } from "@/ui/app/EditorPage";
import { resolveTreeDir } from "@/ui/canvas/treeDirection";
import { DEFAULT_SETTINGS, setCurrentSettings, type TreeDirection } from "@/ui/settings/settings";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";
import { reduceMotion } from "../i18n";

describe("resolveTreeDir", () => {
  test('"auto" follows the interface language; "ltr" and "rtl" override it', () => {
    expect(resolveTreeDir("auto", "ltr")).toBe("ltr");
    expect(resolveTreeDir("auto", "rtl")).toBe("rtl");
    expect(resolveTreeDir("ltr", "rtl")).toBe("ltr");
    expect(resolveTreeDir("rtl", "ltr")).toBe("rtl");
  });
});

const originalRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-canvas")) {
      return DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 600 });
    }
    return originalRect.call(this);
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});

let env: Awaited<ReturnType<typeof makeEditorEnv>>;
beforeEach(async () => {
  reduceMotion(true);
  env = await makeEditorEnv();
  Object.defineProperty(navigator, "storage", { value: {}, configurable: true });
});
afterEach(() => {
  cleanup();
  reduceMotion(false);
  act(() => setCurrentSettings(DEFAULT_SETTINGS));
});

async function renderEditor(language: "en" | "ar", treeDirection: TreeDirection) {
  act(() => setCurrentSettings({ ...DEFAULT_SETTINGS, language, treeDirection }));
  // The real Arabic strings load on demand.
  await act(() => languageReady());
  await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
  renderApp(
    <Routes>
      <Route path="/app/t/:treeId" element={<EditorPage />} />
    </Routes>,
    { repo: env.repo, route: "/app/t/t1" },
  );
  return screen.findByRole("region", { name: i18n.t("canvas.region") });
}

/** A card's x on the drawing (mirrored in RTL), from its group's transform. */
function cardX(personId: string): number {
  const g = document.querySelector(`[data-node-id="${personId}"]`);
  return Number(/translate\(([-\d.e]+)/.exec(g?.getAttribute("transform") ?? "")?.[1]);
}

describe("the canvas's direction comes from settings", () => {
  test("auto in English: left to right, the first child on the left", async () => {
    const canvas = await renderEditor("en", "auto");
    expect(canvas.getAttribute("dir")).toBe("ltr");
    expect(cardX("c1")).toBeLessThan(cardX("c2"));
  });

  test("auto in Arabic: right to left, the first child on the right", async () => {
    const canvas = await renderEditor("ar", "auto");
    expect(i18n.dir()).toBe("rtl");
    expect(canvas.getAttribute("dir")).toBe("rtl");
    expect(cardX("c1")).toBeGreaterThan(cardX("c2"));
  });

  test('"rtl" mirrors the tree in an English interface', async () => {
    const canvas = await renderEditor("en", "rtl");
    expect(document.documentElement.dir).toBe("ltr");
    expect(canvas.getAttribute("dir")).toBe("rtl");
    expect(cardX("c1")).toBeGreaterThan(cardX("c2"));
  });

  test('"ltr" keeps the tree left to right in an Arabic interface', async () => {
    const canvas = await renderEditor("ar", "ltr");
    expect(document.documentElement.dir).toBe("rtl");
    expect(canvas.getAttribute("dir")).toBe("ltr");
    expect(cardX("c1")).toBeLessThan(cardX("c2"));
  });

  test("auto follows <html dir> as it changes, whoever sets it", async () => {
    const canvas = await renderEditor("en", "auto");
    await act(async () => {
      document.documentElement.dir = "rtl";
      await Promise.resolve();
    });
    await waitFor(() => expect(canvas.getAttribute("dir")).toBe("rtl"));
    expect(cardX("c1")).toBeGreaterThan(cardX("c2"));
  });
});
