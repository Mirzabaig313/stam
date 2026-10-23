import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { Route, Routes } from "react-router";

import { CARD_H, CARD_W } from "@/core/layout/constants";
import type { TreeDocument } from "@/core/model/types";
import { EditorPage } from "@/ui/app/EditorPage";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { docOf, famSimple, person, union } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";
import { reduceMotion } from "../i18n";

const SCREEN = { width: 800, height: 600 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  // happy-dom has no layout: give the canvas a fixed size.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-canvas")) {
      return DOMRect.fromRect({ x: 0, y: 0, ...SCREEN });
    }
    return originalRect.call(this);
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;

beforeEach(async () => {
  reduceMotion(true);
  env = await makeEditorEnv();
  Object.defineProperty(navigator, "storage", { value: {}, configurable: true });
});
afterEach(() => {
  cleanup();
  reduceMotion(false);
});

async function renderEditor(doc: TreeDocument = famSimple()) {
  await env.repo.saveTree({ ...doc, id: "t1", name: "Khans" });
  const centerOnRef = createRef<(personId: string) => void>() as {
    current: ((personId: string) => void) | null;
  };
  const view = renderApp(
    <Routes>
      <Route path="/app/t/:treeId" element={<EditorPage centerOnRef={centerOnRef} />} />
    </Routes>,
    { repo: env.repo, route: "/app/t/t1" },
  );
  await screen.findByRole("region", { name: "Family tree" });
  return { ...view, centerOnRef, user: userEvent.setup() };
}

/** The camera, read from the transform of the canvas's world group. */
function camera(container: HTMLElement) {
  const g = container.querySelector(".stam-canvas__svg > g");
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(
    g?.getAttribute("transform") ?? "",
  );
  if (!m) throw new Error("no camera transform");
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
}

const card = (name: RegExp) => screen.getByRole("button", { name });

/** Where the centre of a person's card is on screen (LTR). */
function screenCentreOf(container: HTMLElement, name: RegExp): [number, number] {
  const node = card(name).closest("[data-node-id]")!;
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(node.getAttribute("transform") ?? "")!;
  const cam = camera(container);
  return [cam.x + cam.k * (Number(m[1]) + CARD_W / 2), cam.y + cam.k * (Number(m[2]) + CARD_H / 2)];
}

async function pick(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.click(screen.getByRole("button", { name: "Search people" }));
  await user.type(screen.getByRole("searchbox"), `${query}{Enter}`);
}

const panel = () => screen.queryByRole("complementary", { name: "Person details" });

describe("EditorPage canvas", () => {
  test("draws every person of the tree as a card", async () => {
    const { container } = await renderEditor();
    expect(container.querySelectorAll("[data-node-id]").length).toBe(5);
    for (const name of [/^Ahmed Khan/, /^Sara Khan/, /^Ali Khan/, /^Zainab Khan/, /^Omar Khan/]) {
      expect(card(name)).toBeTruthy();
    }
  });

  test("fits the tree to the screen when it first opens", async () => {
    const { container } = await renderEditor();
    const cam = camera(container);
    expect(cam.k).toBeGreaterThan(0);
    const [cx] = screenCentreOf(container, /^Zainab Khan/);
    // The middle child of a symmetric tree sits in the middle of the screen.
    expect(Math.abs(cx - SCREEN.width / 2)).toBeLessThan(2);
  });

  test("an empty tree shows no canvas and does not crash", async () => {
    await env.repo.saveTree({ ...docOf([], [], undefined), id: "t1", name: "Empty" });
    renderApp(
      <Routes>
        <Route path="/app/t/:treeId" element={<EditorPage />} />
      </Routes>,
      { repo: env.repo, route: "/app/t/t1" },
    );
    await screen.findByRole("button", { name: /^Rename tree/ });
    expect(screen.queryByRole("region", { name: "Family tree" })).toBeNull();
  });

  test("clicking a card selects the person and opens the panel; the background deselects", async () => {
    const { container, user } = await renderEditor();
    expect(panel()).toBeNull();
    await user.click(card(/^Omar Khan/));
    expect(within(panel()!).getByRole("heading", { name: "Omar Khan" })).toBeTruthy();
    expect(card(/^Omar Khan/).getAttribute("aria-current")).toBe("true");

    // A click that is not a drag, on the empty canvas.
    const svg = container.querySelector(".stam-canvas__svg")!;
    await user.pointer([
      { keys: "[MouseLeft>]", target: svg, coords: { clientX: 5, clientY: 5 } },
      { keys: "[/MouseLeft]" },
    ]);
    await waitFor(() => expect(panel()).toBeNull());
  });

  test("the zoom buttons zoom in and out around the centre, and fit brings the tree back", async () => {
    const { container, user } = await renderEditor();
    const fitted = camera(container);

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomedIn = camera(container);
    expect(zoomedIn.k).toBeCloseTo(fitted.k * 1.2, 5);

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(camera(container).k).toBeCloseTo((fitted.k * 1) / 1.2, 5);

    await user.click(screen.getByRole("button", { name: "Fit tree to screen" }));
    const refit = camera(container);
    expect(refit.k).toBeCloseTo(fitted.k, 5);
    expect(refit.x).toBeCloseTo(fitted.x, 3);
    expect(refit.y).toBeCloseTo(fitted.y, 3);
  });

  test("focus mode dims everyone but the selected person's line", async () => {
    const { container, user } = await renderEditor();
    await user.click(card(/^Ali Khan/));
    expect(container.querySelectorAll(".stam-node--dimmed").length).toBe(0);

    await user.click(screen.getByRole("button", { name: "Focus mode" }));
    // Ali, his parents stay; his brother and sister are dimmed.
    const dimmed = [...container.querySelectorAll(".stam-node--dimmed")].map(
      (n) => n.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "",
    );
    expect(dimmed.map((l) => l.split(",")[0]).toSorted()).toEqual(["Omar Khan", "Zainab Khan"]);

    await user.click(screen.getByRole("button", { name: "Focus mode" }));
    expect(container.querySelectorAll(".stam-node--dimmed").length).toBe(0);
  });

  test("collapsing a person hides their descendants and the chevron brings them back", async () => {
    const { container, user } = await renderEditor();
    await user.click(screen.getByRole("button", { name: /^Collapse the branch of Ahmed Khan/ }));
    await waitFor(() => expect(container.querySelectorAll("[data-node-id]").length).toBe(2));
    await user.click(screen.getByRole("button", { name: /^Expand the branch of Ahmed Khan/ }));
    await waitFor(() => expect(container.querySelectorAll("[data-node-id]").length).toBe(5));
  });

  test("a stored photo is drawn on the person's card", async () => {
    // fake-indexeddb hands back a plain object for a stored Blob, which the real
    // createObjectURL refuses, so the URL factory is stubbed here.
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = () => "blob:stam-test/ph1";
    try {
      await env.repo.putPhoto("ph1", new Blob(["x"], { type: "image/webp" }));
      const doc = famSimple();
      const withPhoto = {
        ...doc,
        persons: { ...doc.persons, dad: { ...doc.persons.dad!, photoId: "ph1" } },
      };
      const { container } = await renderEditor(withPhoto);
      await waitFor(() => {
        // The photo is drawn in the decorative group beside the card's button group.
        expect(
          card(/^Ahmed Khan/)
            .closest("[data-node-id]")
            ?.querySelector("image")
            ?.getAttribute("href"),
        ).toBe("blob:stam-test/ph1");
      });
      expect(container.querySelectorAll("image").length).toBe(1);
    } finally {
      URL.createObjectURL = realCreate;
    }
  });

  test("centerOnRef is filled by the editor and centres a person once the layout is drawn", async () => {
    const { container, centerOnRef } = await renderEditor();
    expect(centerOnRef.current).toBeTypeOf("function");
    act(() => centerOnRef.current!("c1"));
    await waitFor(() => {
      const [cx, cy] = screenCentreOf(container, /^Ali Khan/);
      expect(cx).toBeCloseTo(SCREEN.width / 2, 0);
      expect(cy).toBeCloseTo(SCREEN.height / 2, 0);
    });
  });

  describe("search centring", () => {
    test("a person in view is selected and centred on screen", async () => {
      const { container, user } = await renderEditor();
      const before = screenCentreOf(container, /^Omar Khan/);
      expect(Math.abs(before[0] - SCREEN.width / 2)).toBeGreaterThan(20);

      await pick(user, "omar");

      await waitFor(() => {
        const [cx, cy] = screenCentreOf(container, /^Omar Khan/);
        expect(cx).toBeCloseTo(SCREEN.width / 2, 0);
        expect(cy).toBeCloseTo(SCREEN.height / 2, 0);
      });
      expect(within(panel()!).getByRole("heading", { name: "Omar Khan" })).toBeTruthy();
    });

    test("a person outside the view: the view changes first, then the new card is centred", async () => {
      const khans = famSimple();
      const doc = docOf(
        [
          ...Object.values(khans.persons),
          person("old", "Yusuf", "Lone", "male"),
          person("mid", "Idris", "Lone", "male"),
          person("kid", "Bashir", "Lone", "male"),
        ],
        [
          ...Object.values(khans.unions),
          union("ul", ["old"], ["mid"]),
          union("um", ["mid"], ["kid"]),
        ],
        "dad",
      );
      const { container, user } = await renderEditor(doc);
      expect(screen.queryByRole("button", { name: /^Bashir Lone/ })).toBeNull();

      await pick(user, "bashir");

      expect(screen.getByRole("button", { name: /Back to/ })).toBeTruthy();
      await waitFor(() => {
        const [cx, cy] = screenCentreOf(container, /^Bashir Lone/);
        expect(cx).toBeCloseTo(SCREEN.width / 2, 0);
        expect(cy).toBeCloseTo(SCREEN.height / 2, 0);
      });
    });
  });
});
