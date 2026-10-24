import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";

import { DEFAULT_LOOK } from "@/templates/look";
import { metricsFor } from "@/templates/metrics";
import { EditorPage } from "@/ui/app/EditorPage";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { famSimple } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";
import { reduceMotion } from "../i18n";

/** The editor lays the tree out for its look: the default one in these tests. */
const CARD = metricsFor(DEFAULT_LOOK);

// A phone: the canvas fills the screen below the toolbar and the panel is a bottom sheet over it.
const CANVAS = { x: 0, y: 60, width: 390, height: 700 };
let panelBox = { x: 0, y: 410, width: 390, height: 350 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-canvas")) return DOMRect.fromRect(CANVAS);
    if (this.classList.contains("person-panel")) return DOMRect.fromRect(panelBox);
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
  Object.defineProperty(navigator, "storage", {
    value: {},
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  reduceMotion(false);
});

async function renderEditor() {
  await env.repo.saveTree({ ...famSimple(), id: "t1", name: "Khans" });
  const view = renderApp(
    <Routes>
      <Route path="/app/t/:treeId" element={<EditorPage />} />
    </Routes>,
    { repo: env.repo, route: "/app/t/t1" },
  );
  await screen.findByRole("region", { name: "Family tree" });
  return { ...view, user: userEvent.setup() };
}

/** Where the centre of a person's card is on the canvas, from the drawn transforms. */
function centreOf(container: HTMLElement, personId: string): [number, number] {
  const cam = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(
    container.querySelector(".stam-canvas__svg > g")!.getAttribute("transform")!,
  )!;
  const at = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(
    container.querySelector(`[data-node-id="${personId}"]`)!.getAttribute("transform")!,
  )!;
  const k = Number(cam[3]);
  return [
    Number(cam[1]) + k * (Number(at[1]) + CARD.cardW / 2),
    Number(cam[2]) + k * (Number(at[2]) + CARD.cardH / 2),
  ];
}

const cardOf = (container: HTMLElement, personId: string) =>
  container.querySelector<HTMLElement>(`[data-node-id="${personId}"] > .stam-card`)!;

describe("panel as a bottom sheet (R38)", () => {
  test("selecting a card centres it in the canvas area above the sheet", async () => {
    panelBox = { x: 0, y: 410, width: 390, height: 350 };
    const { container, user } = await renderEditor();
    await user.click(cardOf(container, "c3"));
    // The sheet covers the canvas from y 410 (canvas y 350) down: the visible area is 350 tall.
    const [x, y] = centreOf(container, "c3");
    expect(x).toBeCloseTo(195, 6);
    expect(y).toBeCloseTo(175, 6);
  });

  test("a side panel that does not cover the canvas leaves the camera alone", async () => {
    panelBox = { x: 390, y: 60, width: 360, height: 700 };
    const { container, user } = await renderEditor();
    const before = centreOf(container, "c3");
    await user.click(cardOf(container, "c3"));
    expect(centreOf(container, "c3")).toEqual(before);
  });

  test("below 768 px the sheet is at most half the screen high", () => {
    const css = readFileSync("src/ui/styles/panels.css", "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(mobile).toMatch(/\.person-panel\s*\{[^}]*max-block-size:\s*50vh;/);
  });
});

describe("quick-add handles and drag and drop", () => {
  test("pressing a handle adds a person and never starts a drag", async () => {
    panelBox = { x: 0, y: 0, width: 0, height: 0 };
    const { container, user } = await renderEditor();
    act(() => {
      cardOf(container, "c1").dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await user.click(screen.getByRole("button", { name: "Add child of Ali Khan" }));
    expect(container.querySelector(".stam-canvas")!.hasAttribute("data-drag")).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(document.activeElement).toBe(name);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  });

  test("toolbar Undo with a blank inline editor open removes only the pending add (I4)", async () => {
    panelBox = { x: 0, y: 0, width: 0, height: 0 };
    const { container, user } = await renderEditor();
    // An earlier edit that must survive the undo.
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    await user.type(screen.getByRole("textbox", { name: "Tree name" }), " line{Enter}");
    const cards = () => container.querySelectorAll(".stam-card").length;
    const before = cards();
    act(() => {
      cardOf(container, "c1").dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await user.click(screen.getByRole("button", { name: "Add child of Ali Khan" }));
    expect(cards()).toBe(before + 1);

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(cards()).toBe(before);
    expect(screen.getByRole("button", { name: /^Rename tree/ }).textContent).toBe("Khans line");
    // The add is gone for good: nothing to redo.
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("handles are hidden while a card is being dragged", () => {
    const css = readFileSync("src/ui/cards/handles.css", "utf8");
    expect(css).toMatch(/\.stam-canvas\[data-drag\] \.quick-add\s*\{\s*display:\s*none;/);
  });
});
