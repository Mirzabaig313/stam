// GEDCOM through the real UI, against the production build: import a hand-written 5.5.1 file,
// read its report, open the tree, export it as GEDCOM (privacy on) and import that again.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { card } from "./helpers";

const FIXTURE = fileURLToPath(new URL("../tests/fixtures/gedcom/full-551.ged", import.meta.url));

test("import a .ged file, read the report, export GEDCOM and import it again", async ({ page }) => {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);

  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toBeVisible();
  await expect(report).toContainText("Imported 9 people and 3 families.");
  await expect(report).toContainText("Mystery Person");
  await report.getByText("3 lines were not imported").click();
  await expect(report.getByText("Line 80, OCCU: not used by this app")).toBeVisible();

  await report.getByRole("button", { name: "Open tree" }).click();
  await expect(card(page, "Ahmed Khan")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+e");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("radio", { name: /GEDCOM/ }).check();
  await expect(dialog.getByRole("checkbox", { name: /Include photos/ })).toHaveCount(0);
  // On by default for GEDCOM, which is often shared.
  await expect(dialog.getByRole("checkbox", { name: /Privacy mode/ })).toBeChecked();
  await expect(dialog.getByText("GEDCOM files are often shared")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Export", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.ged$/);
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const text = readFileSync(path, "utf8");
  expect(text).toContain("1 SOUR STAM");
  expect(text).toContain("1 NAME Ahmed /Khan/");
  // Zainab (born 1925) is living: privacy drops her birth date; Ahmed is deceased and keeps his.
  expect(text).not.toContain("2 FEB 1925");
  expect(text).toContain("12 MAR 1970");

  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(path);
  const again = page.getByRole("dialog", { name: "Import report" });
  await expect(again).toContainText("Imported 9 people and 3 families.");
  await expect(again).toContainText("Everything in the file was imported.");
  await again.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("link", { name: /full-551/ })).toHaveCount(2);
});
