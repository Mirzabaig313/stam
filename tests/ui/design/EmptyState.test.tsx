import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";

import { Button } from "@/ui/design/Button";
import { EmptyState } from "@/ui/design/EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  test("a heading in the display voice, the body and the way forward", () => {
    const { container } = render(
      <EmptyState
        title="Start your family tree"
        actions={<Button variant="primary">New tree</Button>}
      >
        Everything stays on this device.
      </EmptyState>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Start your family tree" });
    expect(heading.classList.contains("display")).toBe(true);
    expect(screen.getByText("Everything stays on this device.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New tree" })).toBeTruthy();
    // The drawing is decorative.
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("level 3, no art, aligned to the start", () => {
    const { container } = render(
      <EmptyState title="No birthdays this month" level={3} art={false} align="start" />,
    );
    expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".empty-state--start")).toBeTruthy();
  });
});
