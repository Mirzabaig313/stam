import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "@/ui/design/Button";
import { IconButton } from "@/ui/design/IconButton";

afterEach(cleanup);

describe("Button", () => {
  test("is a button named by its text, type=button by default (never submits by accident)", () => {
    render(<Button>Save changes</Button>);
    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toBe("button");
  });

  test("variants map to the app's long-standing classes", () => {
    render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="quiet">B</Button>
        <Button variant="danger">C</Button>
        <Button variant="danger" solid size="sm" block>
          D
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "A" }).className).toBe("button button-primary");
    expect(screen.getByRole("button", { name: "B" }).className).toBe("button button-quiet");
    expect(screen.getByRole("button", { name: "C" }).className).toBe("button button-danger");
    expect(screen.getByRole("button", { name: "D" }).className).toBe(
      "button button-danger button-sm button-solid button-block",
    );
  });

  test("a leading icon is decorative: the name stays the text", () => {
    render(<Button icon="plus">Add person</Button>);
    const button = screen.getByRole("button", { name: "Add person" });
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("disabled: not clickable", async () => {
    let clicks = 0;
    render(
      <Button disabled onClick={() => clicks++}>
        Export
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(clicks).toBe(0);
  });

  test("submit when asked", () => {
    render(<Button type="submit">Create</Button>);
    expect(screen.getByRole("button", { name: "Create" }).getAttribute("type")).toBe("submit");
  });
});

describe("IconButton", () => {
  test("icon only: named by aria-label, no visible text", () => {
    render(<IconButton icon="undo" label="Undo" />);
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button.getAttribute("aria-label")).toBe("Undo");
    expect(button.textContent).toBe("");
    expect(button.className).toBe("icon-button");
  });

  test("with its label shown: the visible text names it, and there is no aria-label", () => {
    render(<IconButton icon="plus" label="Add person" showLabel />);
    const button = screen.getByRole("button", { name: "Add person" });
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.textContent).toBe("Add person");
    expect(button.classList.contains("icon-button--labelled")).toBe(true);
  });

  test("a toggle reports aria-pressed; a plain button has none", () => {
    render(
      <>
        <IconButton icon="focus" label="Focus" pressed />
        <IconButton icon="search" label="Search" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Focus" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Search" }).hasAttribute("aria-pressed")).toBe(false);
  });

  test("clicks reach the handler", async () => {
    let clicks = 0;
    render(<IconButton icon="close" label="Close" onClick={() => clicks++} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(clicks).toBe(1);
  });
});
