import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Segmented } from "@/ui/design/Segmented";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

type V = "light" | "dark" | "classic";

function Theme({ initial = "light" as V, disabled = false }) {
  const [value, setValue] = useState<V>(initial);
  return (
    <>
      <Segmented<V>
        label="Theme"
        value={value}
        onChange={setValue}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark", disabled },
          { value: "classic", label: "Classic" },
        ]}
      />
      <output>{value}</output>
    </>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("Segmented", () => {
  test("a named radio group; the chosen segment is checked and the only Tab stop", () => {
    render(<Theme />);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
    expect(radio("Light").getAttribute("aria-checked")).toBe("true");
    expect(radio("Dark").getAttribute("aria-checked")).toBe("false");
    expect([radio("Light"), radio("Dark"), radio("Classic")].map((r) => r.tabIndex)).toEqual([
      0, -1, -1,
    ]);
  });

  test("a click chooses", async () => {
    render(<Theme />);
    await userEvent.click(radio("Classic"));
    expect(screen.getByRole("status").textContent).toBe("classic");
    expect(radio("Classic").getAttribute("aria-checked")).toBe("true");
  });

  test("arrow keys move and choose, wrapping; Home and End jump", async () => {
    render(<Theme />);
    const user = userEvent.setup();
    radio("Light").focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status").textContent).toBe("dark");
    expect(document.activeElement).toBe(radio("Dark"));
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("status").textContent).toBe("light");
    await user.keyboard("{End}");
    expect(screen.getByRole("status").textContent).toBe("classic");
    await user.keyboard("{Home}");
    expect(screen.getByRole("status").textContent).toBe("light");
  });

  test("in RTL, ← moves toward the end", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    render(<Theme />);
    const user = userEvent.setup();
    radio("Light").focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("status").textContent).toBe("dark");
  });

  test("disabled segments are skipped by the keys", async () => {
    render(<Theme disabled />);
    const user = userEvent.setup();
    radio("Light").focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status").textContent).toBe("classic");
  });
});
