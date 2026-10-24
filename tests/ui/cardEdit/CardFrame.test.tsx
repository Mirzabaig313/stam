import { afterEach, describe, expect, test } from "bun:test";

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

import { cardEdit } from "@/ui/cardEdit/actions";
import { CardFrame } from "@/ui/cardEdit/CardFrame";
import { useEditor } from "@/ui/store/useEditor";

import { famSimple } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(() => {
  cleanup();
  cardEdit.setState({ line: null, clipboard: null });
});

/** The frame for one person's card, as the canvas overlay draws it at 100 % zoom. */
function Harness({ personId }: { personId: string }) {
  const node = useEditor((s) => s.layout?.nodes.find((n) => n.personId === personId));
  const metrics = useEditor((s) => s.layout?.metrics);
  if (!node || !metrics) return null;
  const rect = {
    x: 200,
    y: 300,
    width: node.width ?? metrics.cardW,
    height: node.height ?? metrics.cardH,
  };
  return <CardFrame node={node} rect={rect} />;
}

async function open(personId = "c1") {
  const env = await renderWithStore(<Harness personId={personId} />, famSimple());
  act(() => env.store.getState().select(personId));
  return env;
}

describe("CardFrame", () => {
  test("has four corner handles and the card toolbar", async () => {
    await open();
    for (const corner of ["top left", "top right", "bottom left", "bottom right"]) {
      expect(
        screen.getByRole("button", { name: `Resize from the ${corner} corner` }),
      ).toBeDefined();
    }
    const bar = screen.getByRole("toolbar", { name: "Card style" });
    for (const name of ["Fill", "Border", "Corner radius", "Padding", "More card options"]) {
      expect(within(bar).getByRole("button", { name })).toBeDefined();
    }
  });

  test("Alt + Shift + arrows resize the card, one undo step a press", async () => {
    const { store } = await open();
    act(() => {
      fireEvent.keyDown(document, { key: "ArrowRight", altKey: true, shiftKey: true });
    });
    const size = store.getState().cardStyles.c1?.size;
    expect(size?.w).toBeGreaterThan(100);
    expect(size?.h).toBe(100);
    act(() => store.getState().undo());
    expect(store.getState().cardStyles.c1).toBeUndefined();
  });

  test("a double-click on a handle puts the card back to the template's size", async () => {
    const { store } = await open();
    act(() => store.getState().commitCardStyles({ c1: { size: { w: 180, h: 120 } } }, "Resize"));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Resize from the top left corner" }));
    expect(store.getState().cardStyles.c1).toBeUndefined();
  });

  test("a fill swatch styles the card as one undo step; 'the template's own' clears it", async () => {
    const { store } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    const panel = screen.getByRole("group", { name: "Fill" });
    const swatch = within(panel).getAllByRole("button")[2]!;
    fireEvent.click(swatch);
    expect(store.getState().cardStyles.c1?.fill).toBe(swatch.getAttribute("aria-label")!);
    fireEvent.click(within(panel).getByRole("button", { name: "The template's own" }));
    expect(store.getState().cardStyles.c1).toBeUndefined();
  });

  test("a radius slider previews as it moves and is one undo step when let go", async () => {
    const { store } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Corner radius" }));
    const slider = screen.getByRole("slider", { name: "Corner radius" });
    fireEvent.change(slider, { target: { value: "20" } });
    expect(store.getState().cardStyles.c1?.radius).toBe(20);
    expect(store.getState().canUndo).toBe(false);
    fireEvent.pointerUp(slider);
    expect(store.getState().canUndo).toBe(true);
  });

  test("⋯ applies the card's look to its branch, but not its size", async () => {
    const { store } = await open("dad");
    act(() =>
      store
        .getState()
        .commitCardStyles({ dad: { fill: "#123456", size: { w: 150, h: 100 } } }, "s"),
    );
    fireEvent.click(screen.getByRole("button", { name: "More card options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply to this branch" }));
    const styles = store.getState().cardStyles;
    for (const id of ["mom", "c1", "c2", "c3"]) expect(styles[id]).toEqual({ fill: "#123456" });
    expect(styles.dad?.size).toEqual({ w: 150, h: 100 });
  });

  test("copy and paste a style; reset to template", async () => {
    const { store } = await open();
    act(() => store.getState().commitCardStyles({ c1: { radius: 30 } }, "s"));
    fireEvent.click(screen.getByRole("button", { name: "More card options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy style" }));
    expect(cardEdit.getState().clipboard).toEqual({ radius: 30 });
    fireEvent.click(screen.getByRole("button", { name: "More card options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset to template" }));
    expect(store.getState().cardStyles.c1).toBeUndefined();
  });

  test("the text toolbar styles the selected line; Esc goes back to the card toolbar", async () => {
    const { store } = await open();
    act(() => cardEdit.setState({ line: { personId: "c1", key: "name" } }));
    const bar = screen.getByRole("toolbar", { name: "Text style" });
    fireEvent.click(within(bar).getByRole("button", { name: "Bold" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Underline" }));
    fireEvent.change(within(bar).getByRole("combobox", { name: "Text style" }), {
      target: { value: "h2" },
    });
    fireEvent.click(within(bar).getByRole("button", { name: /^Alignment/ }));
    expect(store.getState().cardStyles.c1?.lines?.name).toEqual({
      bold: true,
      underline: true,
      preset: "h2",
      align: "center",
    });
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.getByRole("toolbar", { name: "Card style" })).toBeDefined();
  });
});
