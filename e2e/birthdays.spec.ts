import { expect, test } from "@playwright/test";

import { famSimple } from "../tests/fixtures/families";
import { allCards, card } from "./helpers";

/** The simple family, with birthdays on 25 Oct (Zainab) and 23 Oct (Ali). */
function file() {
  const tree = { ...famSimple(), name: "Birthdays", id: "e2e-birthdays" };
  tree.persons.c1 = { ...tree.persons.c1!, birth: { date: { year: 1980, month: 10, day: 23 } } };
  tree.persons.c2 = { ...tree.persons.c2!, birth: { date: { year: 1983, month: 10, day: 25 } } };
  const body = { format: "stam", schemaVersion: 1, exportedAt: new Date().toISOString(), tree };
  return {
    name: "birthdays.stam.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(body)),
  };
}

test("the birthdays panel counts the week ahead, lists it, and a row selects the person", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2026, 9, 23, 12));
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(file());
  await expect(allCards(page)).toHaveCount(5);

  await page.getByRole("button", { name: "More" }).click();
  const button = page.getByRole("menuitem", { name: "Birthdays: 2 in the next 7 days" });
  await expect(button).toBeVisible();
  await button.click();
  const panel = page.getByRole("region", { name: "Upcoming birthdays" });
  await expect(panel).toContainText("turns 46");
  await expect(panel).toContainText("in 2 days");
  await panel.getByRole("button", { name: /^Show Zainab Khan,/ }).click();
  await expect(panel).toBeHidden();
  await expect(card(page, "Zainab Khan")).toHaveAttribute("aria-current", "true");
});
