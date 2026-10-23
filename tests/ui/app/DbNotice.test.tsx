import { afterEach, describe, expect, test } from "bun:test";

import { act, cleanup, render, screen } from "@testing-library/react";

import { DbNotice, resetDbNotice, showDbNotice } from "@/ui/app/DbNotice";

import { withI18n } from "../i18n";

afterEach(() => {
  cleanup();
  resetDbNotice();
});

describe("DbNotice (M8)", () => {
  test("says nothing until the database reports something", () => {
    const { container } = render(withI18n(<DbNotice />));
    expect(container.textContent).toBe("");
  });

  test("an update in another tab closed our connection: reload", () => {
    render(withI18n(<DbNotice />));
    act(() => showDbNotice("blocking"));
    expect(screen.getByRole("alert").textContent).toContain(
      "Stam was updated in another tab. Reload.",
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  test("an update waiting for other tabs asks to close them", () => {
    render(withI18n(<DbNotice />));
    act(() => showDbNotice("blocked"));
    expect(screen.getByRole("alert").textContent).toBe("Close other Stam tabs to finish updating.");
  });

  test("a lost connection is not hidden by a later, milder notice", () => {
    render(withI18n(<DbNotice />));
    act(() => showDbNotice("terminated"));
    act(() => showDbNotice("blocked"));
    expect(screen.getByRole("alert").textContent).toContain(
      "Stam lost access to this browser's storage. Reload.",
    );
  });
});
