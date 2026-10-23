import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { createRef, type RefObject } from "react";

import { CARD_H, CARD_W, GAP } from "@/core/layout/constants";
import type { TreeDocument } from "@/core/model/types";
import { Canvas, type CanvasHandle } from "@/ui/canvas/Canvas";
import type { RenderUnionChoice } from "@/ui/dnd/DropMenu";
import { useDragAndDrop } from "@/ui/dnd/useDragAndDrop";
import { useEditor } from "@/ui/store/useEditor";

import { docOf, person, union } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";
import { reduceMotion } from "../i18n";

const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-canvas")) {
      return DOMRect.fromRect({ x: 0, y: 0, width: 1600, height: 900 });
    }
    return originalRect.call(this);
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});
beforeEach(() => reduceMotion(true));
afterEach(() => {
  cleanup();
  reduceMotion(false);
});

/** Gul + Gulnar have Pervez; Pervez + Wajiha have Kamal, Kiran and Kashif. Root is Gul. */
function grandFamily(): TreeDocument {
  return docOf(
    [
      person("gp", "Gul", "Khan", "male"),
      person("gm", "Gulnar", "Khan", "female"),
      person("p", "Pervez", "Khan", "male"),
      person("w", "Wajiha", "Khan", "female"),
      person("k1", "Kamal", "Khan", "male"),
      person("k2", "Kiran", "Khan", "female"),
      person("k3", "Kashif", "Khan", "male"),
    ],
    [union("ug", ["gp", "gm"], ["p"]), union("up", ["p", "w"], ["k1", "k2", "k3"])],
    "gp",
  );
}

const stubChoice: RenderUnionChoice = () => <div data-testid="union-choice" />;

function Harness({ handle }: { handle: RefObject<CanvasHandle | null> }) {
  const doc = useEditor((s) => s.doc);
  const layout = useEditor((s) => s.layout);
  const dnd = useDragAndDrop({ canvasRef: handle, renderUnionChoice: stubChoice });
  if (!doc || !layout) return null;
  return (
    <>
      <Canvas
        ref={handle}
        doc={doc}
        layout={layout}
        selectedId={null}
        focusMode={false}
        dir="ltr"
        onSelect={() => {}}
        onToggleCollapse={() => {}}
        onViewFamily={() => {}}
        photoUrl={() => undefined}
        {...dnd.canvasProps}
      />
      {dnd.layer}
    </>
  );
}

const card = (name: RegExp) => screen.getByRole("button", { name });
const pointer = (type: string, [clientX, clientY]: [number, number]) =>
  act(() => {
    window.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX, clientY }));
  });
/** Lets the turn that delivered a pointerup end, as a browser does before the next input. */
const nextTurn = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function setup(doc: TreeDocument = grandFamily()) {
  const handle = createRef<CanvasHandle>();
  const env = await renderWithStore(<Harness handle={handle} />, doc);

  const node = (personId: string) => {
    const layout = env.store.getState().layout!;
    return layout.nodes.find((n) => n.nodeId === layout.primaryNode[personId])!;
  };
  /** Client px of a world point (the canvas sits at the page's top-left). */
  const toClient = (world: [number, number]) => handle.current!.worldToScreen(world);
  const centre = (personId: string) => {
    const n = node(personId);
    return toClient([n.x + CARD_W / 2, n.y + CARD_H / 2]);
  };

  /** Presses on `from`'s card, moves to `to` and releases there. */
  const drag = async (from: RegExp, at: [number, number], to: [number, number], release = true) => {
    fireEvent.pointerDown(card(from), { pointerId: 1, button: 0, clientX: at[0], clientY: at[1] });
    pointer("pointermove", [at[0] + 10, at[1] + 10]);
    pointer("pointermove", to);
    if (!release) return;
    pointer("pointerup", to);
    await nextTurn();
  };
  const childOrder = () => env.store.getState().doc!.unions["up"]!.children.map((c) => c.personId);

  return { ...env, handle, node, toClient, centre, card, pointer, drag, nextTurn, childOrder };
}

describe("drag and drop on the canvas", () => {
  test("dragging the last sibling before the first reorders, and one undo restores", async () => {
    const t = await setup();
    const k1 = t.node("k1");
    const before = t.toClient([k1.x - GAP / 2, k1.y + CARD_H / 2]);
    await t.drag(/^Kashif Khan/, t.centre("k3"), before);
    expect(t.commands).toEqual([
      { type: "reorderChild", unionId: "up", personId: "k3", toIndex: 0 },
    ]);
    expect(t.childOrder()).toEqual(["k3", "k1", "k2"]);
    act(() => t.store.getState().undo());
    expect(t.childOrder()).toEqual(["k1", "k2", "k3"]);
    expect(t.store.getState().canUndo).toBe(false);
  });

  test("dropping a sibling back into its own slot changes nothing", async () => {
    const t = await setup();
    await t.drag(/^Kiran Khan/, t.centre("k2"), [t.centre("k2")[0] + 2, t.centre("k2")[1] + 2]);
    expect(t.commands).toEqual([]);
  });

  test("while dragging, the insertion line shows and the source card fades", async () => {
    const t = await setup();
    const k1 = t.node("k1");
    await t.drag(/^Kashif Khan/, t.centre("k3"), t.toClient([k1.x - GAP / 2, k1.y + 10]), false);
    expect(t.container.querySelector(".stam-drop-line")).not.toBeNull();
    expect(t.container.querySelector('[data-node-id="k3"]')!.classList).toContain(
      "stam-node--drag-source",
    );
    expect(document.querySelector(".dnd-ghost")).not.toBeNull();
  });

  test("dropping a grandchild on the grandparent offers only the allowed actions", async () => {
    const t = await setup();
    await t.drag(/^Kashif Khan/, t.centre("k3"), t.centre("gp"));
    expect(t.commands).toEqual([]);
    const menu = screen.getByRole("menu", { name: "Move Kashif Khan" });
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)).toEqual([
      "Make child of Gul Khan",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Make child of Gul Khan" }));
    expect(t.commands).toEqual([
      { type: "relinkAsChild", personId: "k3", parentId: "gp", unionId: "ug" },
    ]);
    act(() => t.store.getState().undo());
    expect(t.childOrder()).toEqual(["k1", "k2", "k3"]);
  });

  test("a target with nothing allowed marks the drop blocked and dropping there does nothing", async () => {
    const t = await setup();
    // Pervez is Kashif's father: no link is possible either way.
    await t.drag(/^Kashif Khan/, t.centre("k3"), t.centre("p"), false);
    expect(t.container.querySelector(".stam-canvas")!.getAttribute("data-drag")).toBe("blocked");
    t.pointer("pointerup", t.centre("p"));
    await t.nextTurn();
    expect(t.commands).toEqual([]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("Esc cancels a drag: no command, no menu, nothing faded", async () => {
    const t = await setup();
    await t.drag(/^Kashif Khan/, t.centre("k3"), t.centre("gp"), false);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    t.pointer("pointerup", t.centre("gp"));
    await t.nextTurn();
    expect(t.commands).toEqual([]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(t.container.querySelector(".stam-node--drag-source")).toBeNull();
    expect(document.querySelector(".dnd-ghost")).toBeNull();
  });

  test("dropping on empty space does nothing", async () => {
    const t = await setup();
    await t.drag(/^Kashif Khan/, t.centre("k3"), t.toClient([-5000, -5000]));
    expect(t.commands).toEqual([]);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Move to… (the keyboard path)", () => {
  test("right-click → Move to… → pick a person → the drop menu", async () => {
    const t = await setup();
    fireEvent.contextMenu(t.card(/^Kashif Khan/), { clientX: 50, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const search = screen.getByRole("searchbox", { name: "Choose a person" });
    fireEvent.change(search, { target: { value: "Gul Khan" } });
    // The person being moved and their descendants are never offered.
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("menu", { name: "Move Kashif Khan" })).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "Make child of Gul Khan" }));
    expect(t.commands).toEqual([
      { type: "relinkAsChild", personId: "k3", parentId: "gp", unionId: "ug" },
    ]);
  });

  test("Shift+F10 on a focused card opens the card menu", async () => {
    const t = await setup();
    fireEvent.keyDown(t.card(/^Kashif Khan/), { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem", { name: "Move to…" })).toBeDefined();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("the picker leaves out the person being moved and their descendants", async () => {
    const t = await setup();
    fireEvent.contextMenu(t.card(/^Pervez Khan/));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Khan" } });
    const offered = within(screen.getByRole("list", { name: "Matching people" }))
      .getAllByRole("button")
      .map((el) => el.textContent ?? "");
    expect(offered.some((text) => text.startsWith("Gul Khan"))).toBe(true);
    for (const name of ["Pervez Khan", "Kamal Khan", "Kiran Khan", "Kashif Khan"]) {
      expect(offered.some((text) => text.startsWith(name))).toBe(false);
    }
  });
});
