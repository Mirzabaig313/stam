import { afterEach, describe, expect, mock, test } from "bun:test";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { offerUpdate, resetUpdate, UpdateToast } from "@/ui/app/UpdateToast";

import { withI18n } from "../i18n";

afterEach(() => {
  cleanup();
  resetUpdate();
});

describe("UpdateToast", () => {
  test("shows nothing until a new version is ready", () => {
    const { container } = render(withI18n(<UpdateToast />));
    expect(container.textContent).toBe("");
  });

  test("a new version shows a polite status with a reload button that applies it", () => {
    const apply = mock(() => {});
    render(withI18n(<UpdateToast />));
    act(() => offerUpdate(apply));
    expect(screen.getByRole("status").textContent).toContain("New version available");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test("it can be dismissed for now", () => {
    render(withI18n(<UpdateToast />));
    act(() => offerUpdate(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
