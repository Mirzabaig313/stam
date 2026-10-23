import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Chip } from "@/ui/design/Chip";

afterEach(cleanup);

describe("Chip", () => {
  test("static: a tag, not a control", () => {
    const { container } = render(<Chip>b. 1952</Chip>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".chip")?.textContent).toBe("b. 1952");
  });

  test("a filter chip is a toggle button with aria-pressed", async () => {
    let clicks = 0;
    render(
      <>
        <Chip selected onClick={() => clicks++}>
          Living
        </Chip>
        <Chip selected={false}>Deceased</Chip>
      </>,
    );
    const on = screen.getByRole("button", { name: "Living" });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Deceased" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    await userEvent.click(on);
    expect(clicks).toBe(1);
  });

  test("a hue chip carries data-hue and a decorative dot", () => {
    const { container } = render(<Chip hue={3}>Khan branch</Chip>);
    const chip = container.querySelector(".chip")!;
    expect(chip.getAttribute("data-hue")).toBe("3");
    expect(chip.querySelector(".chip__dot")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("a removable chip has a named remove button", async () => {
    let removed = 0;
    render(
      <Chip onRemove={() => removed++} removeLabel="Remove Lahore">
        Lahore
      </Chip>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Lahore" }));
    expect(removed).toBe(1);
  });
});
