import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { DEFAULT_LOOK, lookKey } from "@/templates/look";
import { metricsFor } from "@/templates/metrics";
import { LookDialog } from "@/ui/look/LookDialog";

import { renderWithStore } from "../../fixtures/panelEnv";
import { withI18n } from "../i18n";

afterEach(cleanup);

const open = () => renderWithStore(<>{withI18n(<LookDialog onClose={() => {}} />)}</>);

describe("LookDialog", () => {
  test("offers the six templates, the tree's own one chosen, each with a drawing of the tree", async () => {
    const { container } = await open();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(6 + 3); // six templates, then the three spacings
    expect((screen.getByRole("radio", { name: "Warm album" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(container.querySelectorAll(".look-preview")).toHaveLength(6);
    // The drawings are the tree's own people, once the faces have loaded.
    await waitFor(() =>
      expect(container.querySelector(".look-preview")?.textContent).toContain("Ahmed Khan"),
    );
  });

  test("choosing a template lays the tree out for it at once and keeps it for this tree", async () => {
    const { store, env } = await open();
    fireEvent.click(screen.getByRole("radio", { name: "Modern gallery" }));
    expect(store.getState().look.template).toBe("gallery");
    expect(store.getState().layout?.metrics).toEqual(
      metricsFor({ ...DEFAULT_LOOK, template: "gallery" }),
    );
    await Promise.resolve();
    expect(await env.repo.getSetting(lookKey("t1"))).toMatchObject({ template: "gallery" });
  });

  test("card size, text size and spacing change the look; Reset puts the sizes back", async () => {
    const { store } = await open();
    const reset = screen.getByRole("button", { name: "Reset sizes" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Card size"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Text size"), { target: { value: "110" } });
    fireEvent.click(screen.getByRole("radio", { name: "Airy" }));
    expect(store.getState().look).toMatchObject({ cardSize: 120, textSize: 110, spacing: "airy" });
    expect(screen.getByText("120 %")).toBeDefined();
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(store.getState().look).toEqual(DEFAULT_LOOK);
  });
});
