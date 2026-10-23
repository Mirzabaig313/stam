import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";

import { type GedcomReport, NOTES_PER_FILE, NOTES_PER_PERSON } from "@/io/gedcom";
import { GedcomReportDialog } from "@/ui/app/GedcomReportDialog";

import { withI18n } from "../i18n";

afterEach(cleanup);

function renderReport(report: GedcomReport) {
  return render(
    withI18n(<GedcomReportDialog report={report} onOpen={() => {}} onClose={() => {}} />),
  );
}

describe("GedcomReportDialog: notes that were too long", () => {
  test("says whose notes were cut, at what length, and how many lost notes to the file limit", () => {
    renderReport({
      people: 3,
      families: 0,
      skipped: [],
      warnings: [
        { code: "NOTES_CUT", people: ["Ali Khan", "Sara Khan"], limit: NOTES_PER_PERSON },
        { code: "NOTES_FULL", count: 1750, limit: NOTES_PER_FILE },
      ],
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(
      "2 people's notes were longer than 20,000 characters and were cut short: Ali Khan and Sara Khan",
    );
    expect(dialog.textContent).toContain(
      "The file's notes came to more than 5,000,000 characters in all, so the notes of 1,750 people were cut or left out.",
    );
    // Not everything was imported, even with no skipped lines.
    expect(dialog.textContent).not.toContain("Everything in the file was imported.");
  });
});
