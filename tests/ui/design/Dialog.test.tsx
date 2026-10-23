import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Dialog } from "@/ui/app/Dialog";

import { withI18n } from "../i18n";

afterEach(cleanup);

describe("Dialog shell", () => {
  test("named by its title, with a visible close button in the header", async () => {
    let closed = 0;
    render(
      withI18n(
        <Dialog title="Settings" onClose={() => closed++}>
          <p>Theme</p>
        </Dialog>,
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close.closest(".dialog-header")).toBeTruthy();
    await userEvent.click(close);
    expect(closed).toBe(1);
  });

  test("the content sits in its own scrolling region, under the header", () => {
    render(
      withI18n(
        <Dialog title="Export" onClose={() => {}}>
          <p>Body</p>
        </Dialog>,
      ),
    );
    const content = screen.getByText("Body").closest(".dialog-content");
    expect(content).toBeTruthy();
    expect(content?.previousElementSibling?.classList.contains("dialog-header")).toBe(true);
  });

  test("the first field takes the focus, not the close button", () => {
    render(
      withI18n(
        <Dialog title="New tree" onClose={() => {}}>
          <input aria-label="Tree name" />
        </Dialog>,
      ),
    );
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Tree name" }));
  });

  test("with nothing else to focus, the close button takes it", () => {
    render(
      withI18n(
        <Dialog title="Done" onClose={() => {}}>
          <p>Saved.</p>
        </Dialog>,
      ),
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  test("closeButton={false} leaves it out, for dialogs that end with their own Close", () => {
    render(
      withI18n(
        <Dialog title="Import report" onClose={() => {}} closeButton={false}>
          <button type="button">Close</button>
        </Dialog>,
      ),
    );
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(document.querySelector(".dialog-close")).toBeNull();
  });

  test("Esc closes", async () => {
    let closed = 0;
    render(
      withI18n(
        <Dialog title="Settings" onClose={() => closed++}>
          <p>x</p>
        </Dialog>,
      ),
    );
    await userEvent.keyboard("{Escape}");
    expect(closed).toBe(1);
  });
});
