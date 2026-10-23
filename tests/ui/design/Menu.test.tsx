import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Menu, MenuItem, MenuSeparator } from "@/ui/design/Menu";

afterEach(cleanup);

function Open({
  onClose = () => {},
  onPick,
}: {
  onClose?: () => void;
  onPick?: (pick: string) => void;
}) {
  return (
    <Menu at={[100, 100]} label="Ali Khan" onClose={onClose}>
      <MenuItem icon="person" onClick={() => onPick?.("edit")}>
        Edit details
      </MenuItem>
      <MenuItem icon="plus" onClick={() => onPick?.("child")}>
        Add child
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="trash" danger onClick={() => onPick?.("delete")}>
        Delete…
      </MenuItem>
    </Menu>
  );
}

describe("Menu", () => {
  test("a named menu of menuitems; the first takes the focus", () => {
    render(<Open />);
    expect(screen.getByRole("menu", { name: "Ali Khan" })).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Edit details", "Add child", "Delete…"]);
    expect(document.activeElement).toBe(items[0]!);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  test("a destructive item is marked for the danger style", () => {
    render(<Open />);
    expect(screen.getByRole("menuitem", { name: "Delete…" }).className).toBe(
      "menu-item menu-item--danger",
    );
  });

  test("arrows move between items, Enter picks, Esc closes", async () => {
    const picks: string[] = [];
    let closed = 0;
    render(<Open onPick={(p) => picks.push(p)} onClose={() => closed++} />);
    const user = userEvent.setup();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Add child");
    await user.keyboard("{End}");
    expect(document.activeElement?.textContent).toBe("Delete…");
    await user.keyboard("{Enter}");
    expect(picks).toEqual(["delete"]);
    await user.keyboard("{Escape}");
    expect(closed).toBe(1);
  });
});
