import { afterEach, describe, expect, mock, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import "@/i18n";
import type { FuzzyDate } from "@/core/dates/fuzzy";
import { DateField, toInputText } from "@/ui/panels/DateField";

afterEach(cleanup);

const ERROR = "Use a year like 1950, 1950-03-14, abt 1950 or 1948–1952";

function setup(value?: FuzzyDate) {
  const onCommit = mock((_date: FuzzyDate | undefined) => {});
  render(<DateField label="Birth date" value={value} onCommit={onCommit} />);
  return { onCommit, input: screen.getByLabelText("Birth date") as HTMLInputElement };
}

describe("DateField", () => {
  test("previews a valid date as it is typed", async () => {
    const { input } = setup();
    await userEvent.setup().type(input, "1950-03");
    expect(screen.getByText("Mar 1950")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  test("isolates the preview, so a Latin date keeps its order in an RTL panel", async () => {
    const { input } = setup();
    await userEvent.setup().type(input, "1983-10-25");
    expect(screen.getByText(/^25 Oct 1983$/).tagName).toBe("BDI");
  });

  test("explains an invalid date and marks the input invalid", async () => {
    const { input } = setup();
    await userEvent.setup().type(input, "1950-13");
    expect(screen.getByText(ERROR)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
  });

  test("shows nothing for an empty field", () => {
    const { input } = setup();
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(screen.queryByText(ERROR)).toBeNull();
  });

  test("commits the parsed date on blur", async () => {
    const { input, onCommit } = setup();
    const user = userEvent.setup();
    await user.type(input, "abt 1950");
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ qualifier: "about", year: 1950 });
  });

  test("commits on Enter, once", async () => {
    const { input, onCommit } = setup();
    await userEvent.setup().type(input, "1950-03-14{Enter}");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ year: 1950, month: 3, day: 14 });
  });

  test("clearing the field commits undefined", async () => {
    const { input, onCommit } = setup({ year: 1950 });
    const user = userEvent.setup();
    await user.clear(input);
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(undefined);
  });

  test("an unchanged value commits nothing", async () => {
    const { input, onCommit } = setup({ year: 1950, month: 3 });
    expect(input.value).toBe("1950-03");
    const user = userEvent.setup();
    await user.click(input);
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("retyping the same date in another form commits nothing", async () => {
    const { input, onCommit } = setup({ year: 1950, month: 3 });
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "1950-3");
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("an invalid date is never committed", async () => {
    const { input, onCommit } = setup({ year: 1950 });
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "soon");
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(ERROR)).toBeTruthy();
  });

  test("follows the value when it changes from outside", () => {
    const onCommit = mock(() => {});
    const { rerender } = render(
      <DateField label="Birth date" value={{ year: 1950 }} onCommit={onCommit} />,
    );
    rerender(<DateField label="Birth date" value={{ year: 1960 }} onCommit={onCommit} />);
    expect((screen.getByLabelText("Birth date") as HTMLInputElement).value).toBe("1960");
  });
});

describe("toInputText", () => {
  test("writes text that parses back to the same date", async () => {
    const { parseFuzzyDate } = await import("@/core/dates/fuzzy");
    const dates: FuzzyDate[] = [
      { year: 1950 },
      { year: 1950, month: 3 },
      { year: 1950, month: 3, day: 4 },
      { qualifier: "about", year: 1950 },
      { qualifier: "before", year: 1950, month: 3 },
      { qualifier: "after", year: 950 },
      { qualifier: "between", year: 1948, toYear: 1952 },
      { qualifier: "between", year: 10, toYear: 50 },
    ];
    for (const date of dates) {
      expect(parseFuzzyDate(toInputText(date))).toEqual({ ok: true, date });
    }
  });
});
