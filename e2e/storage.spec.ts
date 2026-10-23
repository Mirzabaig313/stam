import { expect, test } from "@playwright/test";

import { addChild, allCards, card, createTree, hoverCard, startWithPerson } from "./helpers";

/** Waits until the toolbar says every edit is in IndexedDB. */
async function waitForSaved(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator(".save-status-saved")).toBeVisible();
}

test("an undo right after a save survives an immediate reload (C1)", async ({ page }) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await addChild(page, "Ahmed Khan", "Ali", "Male");
  await waitForSaved(page);
  await expect(allCards(page)).toHaveCount(2);

  // The undo brings back an older updatedAt than the saved tree; reload before it is saved.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(allCards(page)).toHaveCount(1);
  await page.reload();

  await expect(card(page, "Ahmed Khan")).toBeVisible();
  await expect(allCards(page)).toHaveCount(1);
  await expect(card(page, "Ali Khan")).toHaveCount(0);
});

test("a stale tab goes read-only and never overwrites another tab's save (C2)", async ({
  page: tabA,
  context,
}) => {
  await createTree(tabA, "Two tabs");
  await startWithPerson(tabA, "Ahmed Khan", "Male");
  await waitForSaved(tabA);

  const tabB = await context.newPage();
  await tabB.goto(tabA.url());
  await expect(card(tabB, "Ahmed Khan")).toBeVisible();
  await addChild(tabB, "Ahmed Khan", "Ali", "Male");
  await waitForSaved(tabB);

  // Tab A heard the save: its copy is stale, so it is read-only now.
  await expect(
    tabA.getByText("This tree changed in another tab. Reload to keep editing."),
  ).toBeVisible();
  await expect(tabA.getByRole("button", { name: "Reload" })).toBeVisible();
  await hoverCard(tabA, "Ahmed Khan");
  await expect(tabA.getByRole("button", { name: "Add child of Ahmed Khan" })).toHaveCount(0);
  // An edit through the toolbar is refused too, and nothing is saved when A goes away.
  await tabA.getByRole("button", { name: /^Rename tree/ }).click();
  await tabA.getByRole("textbox", { name: "Tree name" }).fill("Stale name");
  await tabA.keyboard.press("Enter");
  await expect(tabA.getByRole("button", { name: /^Rename tree/ })).toHaveText("Two tabs");
  await tabA.close({ runBeforeUnload: true });

  await tabB.reload();
  await expect(card(tabB, "Ali Khan")).toBeVisible();
  await expect(allCards(tabB)).toHaveCount(2);
  await expect(tabB.getByRole("button", { name: /^Rename tree/ })).toHaveText("Two tabs");
});

test("a tab keeps editing when My trees in another tab restores its unsaved edits (N2)", async ({
  page: tabA,
  context,
}) => {
  await createTree(tabA, "Live tab");
  await startWithPerson(tabA, "Ahmed Khan", "Male");
  await waitForSaved(tabA);

  // Tab B waits on a page with a client-side link to My trees, so the list opens in milliseconds.
  const tabB = await context.newPage();
  await tabB.goto("/app/nowhere");
  const toMyTrees = tabB.getByRole("link", { name: "Back to your trees" });
  await expect(toMyTrees).toBeVisible();

  // A edits: the journal has it at once, the autosave waits for its debounce.
  await tabA.getByRole("button", { name: /^Rename tree/ }).click();
  await tabA.getByRole("textbox", { name: "Tree name" }).fill("Renamed in A");
  await tabA.keyboard.press("Enter");
  // B's tree list restores A's journal entry before A's own save runs.
  await toMyTrees.click();
  await expect(tabB.getByText("Renamed in A")).toBeVisible();

  // A keeps editing: it never goes read-only, and every edit survives a reload.
  await addChild(tabA, "Ahmed Khan", "Ali", "Male");
  await waitForSaved(tabA);
  await expect(tabA.getByText(/changed in another tab/)).toHaveCount(0);
  await tabA.reload();
  await expect(card(tabA, "Ali Khan")).toBeVisible();
  await expect(allCards(tabA)).toHaveCount(2);
  await expect(tabA.getByRole("button", { name: /^Rename tree/ })).toHaveText("Renamed in A");
});
