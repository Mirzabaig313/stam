import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, fireEvent, screen } from "@testing-library/react";

import { ViewPicker } from "@/ui/app/ViewSwitcher";

import { renderWithStore } from "../../fixtures/panelEnv";

afterEach(cleanup);

describe("ViewPicker", () => {
  test("names the current view; its menu lists the six with what each shows", async () => {
    const { store } = await renderWithStore(<ViewPicker />);
    const button = screen.getByRole("button", { name: "View: Family" });
    fireEvent.click(button);
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(6);
    expect(items[0]!.getAttribute("aria-checked")).toBe("true");
    expect(items[1]!.textContent).toContain("grandparents");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Pedigree/ }));
    expect(store.getState().viewMode).toBe("pedigree");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "View: Pedigree" })).toBeDefined();
  });
});
