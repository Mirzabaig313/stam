import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "@/ui/design/Button";
import { Sheet } from "@/ui/design/Sheet";

afterEach(cleanup);

function renderExpandable() {
  let closed = 0;
  const view = render(
    <Sheet
      title="Ali"
      expandable
      expandLabel="Expand panel"
      collapseLabel="Collapse panel"
      onClose={() => closed++}
      closeLabel="Close"
    >
      body
    </Sheet>,
  );
  const sheet = view.container.querySelector(".sheet")!;
  return { ...view, sheet, closed: () => closed };
}
const drag = (el: Element, from: number, to: number) => {
  fireEvent.pointerDown(el, { clientY: from, pointerId: 1, button: 0 });
  fireEvent.pointerMove(el, { clientY: to, pointerId: 1 });
  fireEvent.pointerUp(el, { clientY: to, pointerId: 1 });
};

describe("Sheet", () => {
  test("a complementary landmark named by its title, with a named close button", async () => {
    let closed = 0;
    render(
      <Sheet title="Ali Khan" onClose={() => closed++} closeLabel="Close panel">
        <p>Born 1952</p>
      </Sheet>,
    );
    const sheet = screen.getByRole("complementary", { name: "Ali Khan" });
    expect(screen.getByRole("heading", { level: 2, name: "Ali Khan" })).toBeTruthy();
    expect(sheet.textContent).toContain("Born 1952");
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(closed).toBe(1);
  });

  test("no onClose, no close button; the footer is pinned outside the scrolling body", () => {
    const { container } = render(
      <Sheet title="Related" footer={<Button>Swap</Button>}>
        body
      </Sheet>,
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Swap"]);
    const footer = container.querySelector(".sheet__footer")!;
    expect(footer.closest(".sheet__body")).toBeNull();
    // The grabber (bottom sheets) is decorative.
    expect(container.querySelector(".sheet__grabber")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("label names the landmark instead of the title; subtitle sits under the title", () => {
    const { container } = render(
      <Sheet title="Ali Khan" label="Person details" subtitle={<p>1950 – 2001</p>}>
        body
      </Sheet>,
    );
    expect(screen.getByRole("complementary", { name: "Person details" })).toBeTruthy();
    const header = container.querySelector(".sheet__header")!;
    expect(header.textContent).toContain("1950 – 2001");
    expect(container.querySelector(".sheet__body")!.textContent).toBe("body");
  });

  describe("expandable (a bottom sheet's drag handle)", () => {
    test("the handle is a button that toggles the expanded sheet", async () => {
      const { sheet } = renderExpandable();
      const handle = screen.getByRole("button", { name: "Expand panel" });
      expect(handle.getAttribute("aria-expanded")).toBe("false");
      expect(sheet.classList.contains("sheet--expanded")).toBe(false);
      await userEvent.click(handle);
      expect(sheet.classList.contains("sheet--expanded")).toBe(true);
      const collapse = screen.getByRole("button", { name: "Collapse panel" });
      expect(collapse.getAttribute("aria-expanded")).toBe("true");
      await userEvent.click(collapse);
      expect(sheet.classList.contains("sheet--expanded")).toBe(false);
    });

    test("dragging up expands, down collapses, and down again closes", () => {
      const { sheet, closed } = renderExpandable();
      const handle = sheet.querySelector(".sheet__grabber")!;
      drag(handle, 400, 300);
      expect(sheet.classList.contains("sheet--expanded")).toBe(true);
      drag(handle, 300, 420);
      expect(sheet.classList.contains("sheet--expanded")).toBe(false);
      expect(closed()).toBe(0);
      drag(handle, 400, 500);
      expect(closed()).toBe(1);
    });

    test("a small wobble is a tap, not a drag", () => {
      const { sheet, closed } = renderExpandable();
      const handle = sheet.querySelector(".sheet__grabber")!;
      drag(handle, 400, 395);
      expect(sheet.classList.contains("sheet--expanded")).toBe(false);
      expect(closed()).toBe(0);
    });
  });
});
