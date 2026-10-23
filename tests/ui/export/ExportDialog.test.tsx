import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as family from "@/core/layout/family";
import { ExportDialog } from "@/ui/export/ExportDialog";
import type { ExportRequest } from "@/ui/export/exporters";

import { docOf, famSimple, person, union } from "../../fixtures/families";
import { renderWithStore } from "../../fixtures/panelEnv";

const requests: ExportRequest[] = [];
let outcome: "ok" | "warn" | "side" | "area" | "fail" = "ok";
let release: (() => void) | null = null;

const exporter = async (req: ExportRequest) => {
  requests.push(req);
  if (release === null && outcome === "fail") throw new Error("boom");
  if (release) await new Promise<void>((r) => (release = r));
  return {
    blob: new Blob(["x"]),
    ...(outcome === "warn" ? { warning: { scale: 2 } } : {}),
    ...(outcome === "side" ? { warning: { scale: 2, code: "SIDE_LIMIT" as const } } : {}),
    ...(outcome === "area" ? { warning: { scale: 1.5, code: "AREA_LIMIT" as const } } : {}),
  };
};

const downloads: string[] = [];

beforeEach(() => {
  requests.length = 0;
  downloads.length = 0;
  outcome = "ok";
  release = null;
  spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
  spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
});
afterEach(() => {
  cleanup();
  mock.restore();
});

/** One couple with `n` children: wide enough to need many tiled pages. */
function wideDoc(n: number) {
  const kids = Array.from({ length: n }, (_, i) => person(`k${i}`, `K${i}`, "X", "male"));
  return docOf(
    [person("d", "D", "X", "male"), person("m", "M", "X", "female"), ...kids],
    [
      union(
        "u",
        ["d", "m"],
        kids.map((k) => k.id),
      ),
    ],
    "d",
  );
}

async function open(props: Partial<Parameters<typeof ExportDialog>[0]> = {}, doc = famSimple()) {
  let closed = 0;
  const view = await renderWithStore(
    <ExportDialog onClose={() => closed++} exporter={exporter} {...props} />,
    doc,
  );
  return { ...view, closed: () => closed, user: userEvent.setup() };
}

const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("ExportDialog", () => {
  test("lists every format and defaults to SVG of the current view, privacy off", async () => {
    await open();
    for (const name of [/SVG/, /PNG/, /JPEG/, /PDF poster/, /tiled/, /HTML/, /Backup/]) {
      expect(radio(name)).toBeTruthy();
    }
    expect(radio(/SVG/).checked).toBe(true);
    expect(radio(/current family view/).checked).toBe(true);
    expect(box(/Privacy mode/).checked).toBe(false);
  });

  test("privacy follows the format until the box is touched", async () => {
    const { user } = await open();
    await user.click(radio(/PNG/));
    expect(box(/Privacy mode/).checked).toBe(true);
    await user.click(radio(/PDF poster/));
    expect(box(/Privacy mode/).checked).toBe(false);
    await user.click(box(/Privacy mode/));
    await user.click(radio(/HTML/));
    expect(box(/Privacy mode/).checked).toBe(true);
    await user.click(box(/Privacy mode/));
    await user.click(radio(/JPEG/));
    expect(box(/Privacy mode/).checked).toBe(false);
  });

  test("shows only the controls of the chosen format", async () => {
    const { user } = await open();
    expect(screen.queryByLabelText(/^Scale/)).toBeNull();
    await user.click(radio(/PNG/));
    expect(screen.getByLabelText(/^Scale/)).toBeTruthy();
    expect(screen.queryByLabelText(/JPEG quality/)).toBeNull();
    await user.click(radio(/JPEG/));
    expect(screen.getByLabelText(/JPEG quality/)).toBeTruthy();
    await user.click(radio(/PDF poster/));
    expect(screen.getByLabelText(/Page size/)).toBeTruthy();
    expect(screen.getByLabelText(/Orientation/)).toBeTruthy();
    expect(screen.getByLabelText(/Margin/)).toBeTruthy();
    await user.click(radio(/tiled/));
    expect(screen.getByLabelText(/Paper/)).toBeTruthy();
    expect(screen.getByLabelText(/Print size/)).toBeTruthy();
    await user.click(radio(/Backup/));
    expect(screen.queryByText("What to include")).toBeNull();
    expect(box(/Include photos/)).toBeTruthy();
  });

  test("disables scopes that cannot apply", async () => {
    const { store } = await open();
    expect(radio(/selected person/).disabled).toBe(true);
    expect(radio(/on screen/).disabled).toBe(true);
    act(() => store.getState().select("c1"));
    expect(radio(/selected person/).disabled).toBe(false);
  });

  test("the visible scope is available with a canvas and passes its rect", async () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const { user } = await open({ getVisibleRect: () => rect });
    await user.click(radio(/on screen/));
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.input.visibleRect).toEqual(rect);
    expect(requests[0]!.settings.scope).toBe("visible");
  });

  test("estimates the output size, in pages for PDF", async () => {
    const { user } = await open();
    await user.click(radio(/PNG/));
    expect(screen.getByText(/About \d+ × \d+ px/)).toBeTruthy();
    await user.click(radio(/PDF poster/));
    expect(screen.getByText("About 1 page")).toBeTruthy();
    await user.click(radio(/tiled/));
    expect(screen.getByText(/About \d+ pages/)).toBeTruthy();
  });

  test("Export runs the exporter with the options, downloads the file and closes", async () => {
    const { user, closed } = await open();
    await user.click(radio(/PNG/));
    await user.type(screen.getByLabelText("Title"), "The Khans");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(closed()).toBe(1));
    expect(requests[0]!.settings).toMatchObject({
      format: "png",
      title: "The Khans",
      privacy: true,
    });
    expect(requests[0]!.input.doc.id).toBeTruthy();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^fixture-\d{4}-\d{2}-\d{2}\.png$/);
  });

  test("a reduced scale is reported and the dialog stays open", async () => {
    outcome = "warn";
    const { user, closed } = await open();
    await user.click(radio(/PNG/));
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText(/Scale reduced to 2× to fit the browser limit/)).toBeTruthy();
    expect(closed()).toBe(0);
    expect(downloads).toHaveLength(1);
  });

  test("names the browser limit the rasteriser hit", async () => {
    outcome = "side";
    const first = await open();
    await first.user.click(radio(/PNG/));
    await first.user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText(/Scale reduced to 2×: wider or taller/)).toBeTruthy();
    cleanup();
    outcome = "area";
    const second = await open();
    await second.user.click(radio(/PNG/));
    await second.user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText(/Scale reduced to 1.5×: more pixels/)).toBeTruthy();
  });

  test("a failure shows an error and leaves the dialog usable", async () => {
    outcome = "fail";
    const { user, closed } = await open();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't create the export/);
    expect(closed()).toBe(0);
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(downloads).toHaveLength(0);
  });

  test("the button is busy while the export runs", async () => {
    release = () => {};
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Export" }));
    const busy = (await screen.findByRole("button", { name: "Exporting…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => release?.());
    await waitFor(() => expect(downloads).toHaveLength(1));
  });

  test("Backup downloads the .stam.json without the exporters", async () => {
    const { user, closed } = await open();
    await user.click(radio(/Backup/));
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(closed()).toBe(1));
    expect(requests).toHaveLength(0);
    expect(downloads[0]).toMatch(/\.stam\.json$/);
  });

  test("Custom poster size takes width and height in mm, clamped to 100 to 5000", async () => {
    const { user } = await open();
    await user.click(radio(/PDF poster/));
    expect(screen.queryByLabelText(/Width \(mm\)/)).toBeNull();
    await user.selectOptions(screen.getByLabelText(/Page size/), "Custom");
    const w = screen.getByLabelText(/Width \(mm\)/);
    const h = screen.getByLabelText(/Height \(mm\)/);
    await user.clear(w);
    await user.type(w, "700");
    await user.clear(h);
    await user.type(h, "9000");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.settings).toMatchObject({ page: "Custom", customW: 700, customH: 5000 });
  });

  test("a tiled export over 100 pages asks first, and stops when declined", async () => {
    const { user } = await open({}, wideDoc(60));
    await user.click(radio(/tiled/));
    await user.selectOptions(screen.getByLabelText(/Print size/), "4");
    const shown = Number(
      /About (\d+) pages/.exec(screen.getByText(/About \d+ pages/).textContent!)![1],
    );
    expect(shown).toBeGreaterThan(100);
    expect(shown).toBeLessThanOrEqual(400);
    const ask = spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(ask).toHaveBeenCalledWith(`This will make ${shown} pages. Continue?`);
    expect(requests).toHaveLength(0);
    ask.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  test("a tiled export over 400 pages is refused with a hint", async () => {
    const { user } = await open({}, wideDoc(250));
    await user.click(radio(/tiled/));
    await user.selectOptions(screen.getByLabelText(/Print size/), "4");
    const ask = spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /smaller print size.*poster PDF/,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  test("typing a title does not lay the family out again", async () => {
    const { user } = await open();
    await user.click(radio(/tiled/));
    await user.click(radio(/whole tree/));
    const layout = spyOn(family, "layoutFamily");
    await user.type(screen.getByLabelText("Title"), "The Khans");
    expect(layout).not.toHaveBeenCalled();
  });

  test("the backup includes photos unless unticked", async () => {
    const { user } = await open();
    await user.click(radio(/Backup/));
    expect(box(/Include photos/).checked).toBe(true);
    await user.click(radio(/SVG/));
    expect(box(/Include photos/).checked).toBe(false);
  });
});
