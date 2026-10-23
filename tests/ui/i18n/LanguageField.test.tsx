import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LanguageField } from "@/ui/i18n/LanguageField";
import type { Language } from "@/ui/settings/settings";

import { withI18n } from "../i18n";

afterEach(cleanup);

function mount(value: Language) {
  const picked: Language[] = [];
  render(withI18n(<LanguageField value={value} onChange={(l) => picked.push(l)} />));
  return picked;
}

describe("LanguageField", () => {
  test("lists each language in its own name and script, tagged with its language", () => {
    mount("en");
    const select = screen.getByLabelText("Language") as HTMLSelectElement;
    const options = [...select.options];
    expect(options.map((o) => [o.value, o.textContent, o.lang])).toEqual([
      ["en", "English", "en"],
      ["ur", "اردو", "ur"],
      ["ar", "العربية", "ar"],
    ]);
    expect(select.value).toBe("en");
  });

  test("reports the language picked", () => {
    const picked = mount("en");
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "ar" } });
    expect(picked).toEqual(["ar"]);
  });

  test("says when the chosen translation is still in review", () => {
    mount("ur");
    const note = screen.getByText(/Translation in review/);
    expect(note.textContent).toContain("native speaker");
    // The select points at the note, so a screen reader reads it with the choice.
    const select = screen.getByLabelText("Language");
    expect(select.getAttribute("aria-describedby")).toBe(note.id);
  });

  test("no note for English", () => {
    mount("en");
    expect(screen.queryByText(/Translation in review/)).toBeNull();
    expect(screen.getByLabelText("Language").hasAttribute("aria-describedby")).toBe(false);
  });
});
