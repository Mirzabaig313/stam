import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  addChild,
  allCards,
  card,
  centreOf,
  createTree,
  dragBetween,
  fillInlineEditor,
  hoverCard,
  rowOrder,
  sideHandle,
  startWithPerson,
} from "./helpers";

test("1. a new tree starts with one person", async ({ page }) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await expect(card(page, "Ahmed Khan")).toBeVisible();
  await expect(allCards(page)).toHaveCount(1);
});

test("2. a child inherits the last name and a spouse gets the opposite gender", async ({
  page,
}) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");

  await addChild(page, "Ahmed Khan", "Ali", "Male");
  await expect(card(page, "Ali Khan")).toBeVisible();

  await hoverCard(page, "Ahmed Khan");
  await expect(sideHandle(page, "Ahmed Khan", "left")).toHaveCount(1);
  await sideHandle(page, "Ahmed Khan", "right").click();
  await page.getByRole("menuitem", { name: "Spouse" }).click();
  const editor = page.locator(".inline-editor");
  await expect(editor.getByRole("button", { name: "Female" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Gender is already chosen, so Enter alone confirms.
  await fillInlineEditor(page, "Sara Malik");
  await expect(card(page, "Sara Malik")).toBeVisible();
  await expect(allCards(page)).toHaveCount(3);
});

test("3. dragging a child before its sibling reorders, and one undo restores the order", async ({
  page,
}) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await addChild(page, "Ahmed Khan", "Ali", "Male");
  await addChild(page, "Ahmed Khan", "Omar", "Male");
  await addChild(page, "Ahmed Khan", "Zainab", "Female");
  const names = ["Ali Khan", "Omar Khan", "Zainab Khan"];
  expect(await rowOrder(page, names)).toEqual(names);

  const first = await centreOf(card(page, "Ali Khan"));
  const last = await centreOf(card(page, "Zainab Khan"));
  // Release in the row's front slot: the gap left of the first card (cards are 180 px wide, the
  // drop zone reaches 40 px past the outermost card).
  await dragBetween(page, last, { x: first.x - 90 - 20, y: last.y });
  await expect.poll(() => rowOrder(page, names)).toEqual(["Zainab Khan", "Ali Khan", "Omar Khan"]);

  // Focus is wherever the drag left it; the editor's undo shortcut works from the page.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => rowOrder(page, names)).toEqual(names);
});

test("4. dropping a grandchild on its grandparent offers only allowed actions", async ({
  page,
}) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await addChild(page, "Ahmed Khan", "Ali", "Male");
  await addChild(page, "Ali Khan", "Hamza", "Male");

  const from = await centreOf(card(page, "Hamza Khan"));
  const to = await centreOf(card(page, "Ahmed Khan"));
  await dragBetween(page, from, to);

  const menu = page.getByRole("menu", { name: /Move Ahmed Khan|Move Hamza Khan/ });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Make child of/ })).toBeVisible();
  // An ancestor can be neither a spouse nor a child's child.
  await expect(menu.getByRole("menuitem", { name: /Make spouse of/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /Make parent of/ })).toHaveCount(0);

  // Esc closes the menu and nothing moved.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(allCards(page)).toHaveCount(3);
});

test("5. a reload right after an edit, with no wait, keeps everything", async ({ page }) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await addChild(page, "Ahmed Khan", "Ali", "Male");
  // No waiting for autosave: the 500 ms debounce has not run and IndexedDB may not have the
  // edits. The synchronous journal must bring them back.
  await page.reload();
  await expect(card(page, "Ahmed Khan")).toBeVisible();
  await expect(card(page, "Ali Khan")).toBeVisible();
  await expect(allCards(page)).toHaveCount(2);
  // Restored edits are saved at once, and the status settles to Saved after the next edit.
  await addChild(page, "Ahmed Khan", "Omar", "Male");
  await expect(page.locator(".save-status-saved")).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("6. a JSON export imports as a second tree with the same people", async ({ page }, info) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await addChild(page, "Ahmed Khan", "Ali", "Male");
  await addChild(page, "Ahmed Khan", "Omar", "Male");

  await page.getByRole("button", { name: "More" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Download backup (.json)" }).click(),
  ]);
  const path = info.outputPath("export.stam.json");
  await download.saveAs(path);
  expect(JSON.parse(readFileSync(path, "utf8")).format).toBe("stam");

  await page.getByRole("link", { name: "My trees" }).click();
  await page.locator('input[type="file"]').setInputFiles(path);
  // Importing opens the new tree; its three people are on the canvas.
  await expect(allCards(page)).toHaveCount(3);

  await page.getByRole("link", { name: "My trees" }).click();
  const rows = page.locator(".tree-card");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) await expect(row).toContainText("3 people");
});

test("7. the keyboard alone moves between relatives and opens the panel", async ({ page }) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await addChild(page, "Ahmed Khan", "Ali", "Male");
  // Park the pointer away so handles and hover do not matter.
  await page.mouse.move(2, 2);

  const focusedCard = page.locator(".stam-card:focus");
  for (let i = 0; i < 40 && (await focusedCard.count()) === 0; i++)
    await page.keyboard.press("Tab");
  await expect(focusedCard).toHaveCount(1);

  // From whichever card the tab stop is on, walk to Ahmed (up) and then to Ali (down).
  await page.keyboard.press("ArrowUp");
  await expect(card(page, "Ahmed Khan")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(card(page, "Ali Khan")).toBeFocused();

  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Person details" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("First name")).toHaveValue("Ali");
});

test("8. Esc during an inline add removes the new card and leaves nothing to redo", async ({
  page,
}) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");

  await hoverCard(page, "Ahmed Khan");
  await page.getByRole("button", { name: "Add child of Ahmed Khan" }).click();
  await expect(allCards(page)).toHaveCount(2);
  await page.locator(".inline-editor").getByRole("textbox", { name: "Name" }).fill("Ali");
  await page.keyboard.press("Escape");

  await expect(page.locator(".inline-editor")).toBeHidden();
  await expect(allCards(page)).toHaveCount(1);

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(allCards(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
});

test("9. the panel's Family section adds a child and shows a relative; details appear on demand", async ({
  page,
}) => {
  await createTree(page, "E2E family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await card(page, "Ahmed Khan").click();
  const panel = page.getByRole("complementary", { name: "Person details" });
  await expect(panel.getByRole("heading", { name: "Ahmed Khan" })).toBeVisible();

  // "+ Add" under Children uses quick add: a new card with the inline editor.
  await panel
    .getByRole("group", { name: "Children" })
    .getByRole("button", { name: "Add child" })
    .click();
  await fillInlineEditor(page, "Ali", "Male");
  await expect(card(page, "Ali Khan")).toBeVisible();
  const children = panel.getByRole("group", { name: "Children" });
  await expect(children.getByRole("button", { name: "Ali Khan" })).toBeVisible();

  // A relative's chip selects them, and their card is brought into view.
  await children.getByRole("button", { name: "Ali Khan" }).click();
  await expect(panel.getByRole("heading", { name: "Ali Khan" })).toBeVisible();
  await expect(card(page, "Ali Khan")).toHaveClass(/stam-card--selected/);
  await expect(card(page, "Ali Khan")).toBeInViewport();
  await expect(
    panel.getByRole("group", { name: "Parents" }).getByRole("button", { name: "Ahmed Khan" }),
  ).toBeVisible();

  // Empty details are "+" buttons; one reveals its field with the focus in it.
  await expect(panel.getByLabel("Birth date", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Add birth date" }).click();
  await expect(panel.getByLabel("Birth date", { exact: true })).toBeFocused();
  await page.keyboard.type("1980");
  await page.keyboard.press("Enter");
  // The header's life line is the cards' own: "b. 1980" and the age.
  await expect(panel.locator(".sheet__header")).toContainText(/b\. 1980 · \d+ yrs/);
});
