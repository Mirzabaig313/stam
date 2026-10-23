import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Select } from "@/ui/design/Select";
import { TextField } from "@/ui/design/TextField";

afterEach(cleanup);

function Controlled() {
  const [v, setV] = useState("");
  return <TextField label="Name" value={v} onChange={(e) => setV(e.currentTarget.value)} />;
}

describe("TextField", () => {
  test("the label names the input", () => {
    render(<TextField label="First name" />);
    const input = screen.getByRole("textbox", { name: "First name" });
    expect(input.className).toBe("field");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  test("the hint describes it", () => {
    render(<TextField label="Born" hint="A year is enough, like 1952" />);
    const input = screen.getByRole("textbox", { name: "Born" });
    const hint = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe("A year is enough, like 1952");
  });

  test("an error marks it invalid and is read after the hint", () => {
    render(<TextField label="Born" hint="A year" error="Use a year like 1952" />);
    const input = screen.getByRole("textbox", { name: "Born" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      "A year",
      "Use a year like 1952",
    ]);
  });

  test("multiline is a textarea with the same label and classes", () => {
    render(<TextField multiline label="Notes" rows={3} />);
    const area = screen.getByRole("textbox", { name: "Notes" });
    expect(area.tagName).toBe("TEXTAREA");
    expect(area.className).toBe("field");
  });

  test("typing goes through", async () => {
    render(<Controlled />);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Zainab");
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe(
      "Zainab",
    );
  });
});

describe("Select", () => {
  const options = [
    { value: "gender", label: "By gender" },
    { value: "branch", label: "By branch" },
    { value: "generation", label: "By generation", disabled: true },
  ];

  test("a labelled native select with its options", () => {
    render(<Select label="Card colours" options={options} defaultValue="branch" />);
    const select = screen.getByRole("combobox", { name: "Card colours" }) as HTMLSelectElement;
    expect(select.value).toBe("branch");
    expect([...select.options].map((o) => [o.value, o.textContent, o.disabled])).toEqual([
      ["gender", "By gender", false],
      ["branch", "By branch", false],
      ["generation", "By generation", true],
    ]);
    expect(select.closest(".select")).toBeTruthy();
  });

  test("choosing calls onChange", async () => {
    let chosen = "";
    render(
      <Select
        label="Colours"
        options={options}
        defaultValue="gender"
        onChange={(e) => (chosen = e.currentTarget.value)}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Colours" }), "branch");
    expect(chosen).toBe("branch");
  });

  test("a hint describes it", () => {
    render(<Select label="Colours" options={options} hint="Changes every card" />);
    const select = screen.getByRole("combobox", { name: "Colours" });
    expect(document.getElementById(select.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Changes every card",
    );
  });
});
