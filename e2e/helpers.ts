import { expect, type Locator, type Page } from "@playwright/test";

import { famSimple } from "../tests/fixtures/families";

/** A card on the canvas, found by the start of its accessible name ("Ali Khan, son of ..."). */
export function card(page: Page, name: string): Locator {
  return page.locator(`.stam-card[aria-label="${name}"], .stam-card[aria-label^="${name},"]`);
}

/** All person cards (the drawing's primary role=button groups). */
export function allCards(page: Page): Locator {
  return page.locator(".stam-card");
}

/** Creates a tree from the tree list and opens it. */
export async function createTree(page: Page, name: string): Promise<void> {
  await page.goto("/app");
  await page.getByRole("button", { name: "New tree" }).click();
  await page.getByLabel("Tree name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("button", { name: "Rename tree" })).toBeVisible();
}

/** Types a name in the open inline editor, picks a gender when one is given, and confirms. */
export async function fillInlineEditor(
  page: Page,
  name: string,
  gender?: "Male" | "Female",
): Promise<void> {
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  // A card that lands near the edge makes the camera glide it into view: click once it has.
  await centreOf(editor);
  await editor.getByRole("textbox", { name: "Name" }).fill(name);
  if (gender) await editor.getByRole("button", { name: gender, exact: true }).click();
  await page.keyboard.press("Enter");
  await expect(editor).toBeHidden();
}

/** "Start with a person" in an empty tree. */
export async function startWithPerson(
  page: Page,
  name: string,
  gender: "Male" | "Female",
): Promise<void> {
  await page.getByRole("button", { name: "Start with a person" }).click();
  await fillInlineEditor(page, name, gender);
}

/** Hovers a card so its quick-add handles appear. */
export async function hoverCard(page: Page, name: string): Promise<void> {
  await centreOf(card(page, name)); // let the layout and camera settle: handles follow the card
  await card(page, name).hover();
}

/** Adds a child through the bottom handle of `parent`. */
export async function addChild(
  page: Page,
  parent: string,
  name: string,
  gender?: "Male" | "Female",
): Promise<void> {
  await hoverCard(page, parent);
  await page.getByRole("button", { name: `Add child of ${parent}` }).click();
  await fillInlineEditor(page, name, gender);
}

/** Drags with the mouse in small steps, so the drag threshold and hit tests see a real gesture. */
export async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/**
 * The centre of an element once it has stopped moving: after an add the layout and the camera
 * glide for a few hundred ms, and a drag aimed at a moving card misses.
 */
export async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  let previous = await locator.boundingBox();
  for (let i = 0; i < 40; i++) {
    await locator.page().waitForTimeout(100);
    const box = await locator.boundingBox();
    if (box && previous && box.x === previous.x && box.y === previous.y) {
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    previous = box;
  }
  throw new Error("element never stopped moving");
}

/** The "+" handle on the left or right of a card (labelled by where it is on screen). */
export function sideHandle(page: Page, name: string, side: "left" | "right"): Locator {
  return page.getByRole("button", { name: `Add spouse or sibling on the ${side} of ${name}` });
}

/** Card names from left to right within one row (same top), read from the cards' boxes. */
export async function rowOrder(page: Page, names: string[]): Promise<string[]> {
  const boxes = await Promise.all(
    names.map(async (name) => ({ name, box: await card(page, name).boundingBox() })),
  );
  return boxes.toSorted((a, b) => (a.box?.x ?? 0) - (b.box?.x ?? 0)).map((entry) => entry.name);
}

/** A `.stam.json` file for the simple family fixture, ready for `setInputFiles`. */
export function famSimpleFile(name = "Simple family"): {
  name: string;
  mimeType: string;
  buffer: Buffer;
} {
  const tree = { ...famSimple(), name, id: "e2e-fam-simple" };
  const file = {
    format: "stam",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    tree,
  };
  return {
    name: "simple.stam.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  };
}
