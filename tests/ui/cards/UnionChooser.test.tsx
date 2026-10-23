import { afterEach, describe, expect, mock, test } from "bun:test";

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UnionChooser } from "@/ui/cards/UnionChooser";

import { renderWithStore } from "../../fixtures/panelEnv";
import { remarried } from "./fixtures";

afterEach(cleanup);

function setup(unionIds?: string[]) {
  const onChoose = mock((_unionId: string) => {});
  const onCancel = mock(() => {});
  const view = renderWithStore(
    <UnionChooser personId="dad" unionIds={unionIds} onChoose={onChoose} onCancel={onCancel} />,
    remarried(),
  );
  return { view, onChoose, onCancel, user: userEvent.setup() };
}

describe("UnionChooser", () => {
  test("lists the partners in union order, and 'No partner' for a solo union", async () => {
    await setup().view;
    const options = screen.getAllByRole("button").map((b) => b.textContent);
    expect(options).toEqual(["Sara Malik", "Hina Raza", "No partner", "Cancel"]);
    // Names are isolated for mixed-direction text.
    expect(screen.getByText("Sara Malik").tagName).toBe("BDI");
  });

  test("the first option has the focus, so the keyboard can choose at once", async () => {
    await setup().view;
    expect(document.activeElement?.textContent).toBe("Sara Malik");
  });

  test("choosing a partner reports that union", async () => {
    const { view, onChoose, user } = setup();
    await view;
    await user.click(screen.getByRole("button", { name: "Hina Raza" }));
    expect(onChoose).toHaveBeenCalledWith("u2");
  });

  test("unionIds limits the list", async () => {
    await setup(["u3", "u1"]).view;
    const options = screen.getAllByRole("button").map((b) => b.textContent);
    expect(options).toEqual(["No partner", "Sara Malik", "Cancel"]);
  });

  test("Esc and Cancel cancel", async () => {
    const { view, onCancel, onChoose, user } = setup();
    await view;
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onChoose).not.toHaveBeenCalled();
  });

  test("ArrowDown and ArrowUp move between the options", async () => {
    const { view, user } = setup();
    await view;
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Hina Raza");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement?.textContent).toBe("Sara Malik");
  });
});
