import { fileURLToPath } from "node:url";

import { expect, type Locator, type Page } from "@playwright/test";

import { famSimple } from "../tests/fixtures/families";
import { EN, type T } from "./strings";

/** A card on the canvas, found by the start of its accessible name ("Ali Khan, son of ..."). */
export function card(page: Page, name: string): Locator {
  return page.locator(`.stam-card[aria-label="${name}"], .stam-card[aria-label^="${name},"]`);
}

/** All person cards (the drawing's primary role=button groups). */
export function allCards(page: Page): Locator {
  return page.locator(".stam-card");
}

/** Creates a tree from the tree list and opens it. */
export async function createTree(page: Page, name: string, t: T = EN): Promise<void> {
  await page.goto("/app");
  await page.getByRole("button", { name: t("treeList.newTree") }).click();
  await page.getByLabel(t("common.treeName")).fill(name);
  await page.getByRole("button", { name: t("common.create") }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("button", { name: t("toolbar.rename") })).toBeVisible();
}

/** Types a name in the open inline editor, picks a gender when one is given, and confirms. */
export async function fillInlineEditor(
  page: Page,
  name: string,
  gender?: "Male" | "Female",
  t: T = EN,
): Promise<void> {
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  // A card that lands near the edge makes the camera glide it into view: click once it has.
  await centreOf(editor);
  await editor.getByRole("textbox", { name: t("handles.name") }).fill(name);
  if (gender) {
    const label = t(gender === "Male" ? "handles.male" : "handles.female");
    await editor.getByRole("button", { name: label, exact: true }).click();
  }
  await page.keyboard.press("Enter");
  await expect(editor).toBeHidden();
}

/** "Start with a person" in an empty tree. */
export async function startWithPerson(
  page: Page,
  name: string,
  gender: "Male" | "Female",
  t: T = EN,
): Promise<void> {
  await page.getByRole("button", { name: t("handles.start") }).click();
  await fillInlineEditor(page, name, gender, t);
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
  t: T = EN,
): Promise<void> {
  await hoverCard(page, parent);
  await page.getByRole("button", { name: t("handles.addChild", { name: parent }) }).click();
  await fillInlineEditor(page, name, gender, t);
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
export function sideHandle(page: Page, name: string, side: "left" | "right", t: T = EN): Locator {
  const key = side === "left" ? "handles.addBesideLeft" : "handles.addBesideRight";
  return page.getByRole("button", { name: t(key, { name }) });
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

/** Chooses a theme in the Settings dialog from the tree list, as a user would. */
export async function chooseTheme(
  page: Page,
  theme: "light" | "dark" | "classic" | "print",
  t: T = EN,
): Promise<void> {
  await page.getByRole("button", { name: t("settings.open") }).click();
  const dialog = page.getByRole("dialog", { name: t("settings.title") });
  await dialog.getByRole("radio", { name: t(`settings.themes.${theme}`), exact: true }).check();
  await dialog.getByRole("button", { name: t("settings.done") }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Imports the damaged GEDCOM fixture and opens its report with the skipped lines expanded. */
export async function openGedcomReport(page: Page, t: T = EN): Promise<Locator> {
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      fileURLToPath(new URL("../tests/fixtures/gedcom/malformed.ged", import.meta.url)),
    );
  const report = page.getByRole("dialog", { name: t("app.import.gedcom.title") });
  await expect(report).toBeVisible();
  await report.locator("summary").first().click();
  return report;
}

/**
 * Cards whose year line leaves the card or runs into the avatar, as "name: why" strings, read
 * from the boxes the browser actually draws (so a wrong text-anchor in RTL shows up here).
 * `root` scopes the search: the canvas, or an exported SVG shown in the page.
 */
export function yearLineProblems(page: Page, root = "body"): Promise<string[]> {
  return page.evaluate((selector) => {
    const bad: string[] = [];
    const scope = document.querySelector(selector);
    const cards = [...(scope?.querySelectorAll(".stam-card") ?? [])];
    if (cards.length === 0) return [`no cards in ${selector}`];
    for (const shape of cards) {
      // The card's shape and its texts are sibling groups of one node.
      const node = shape.parentElement!;
      const years = node.querySelector(".stam-card__years");
      const bg = node.querySelector(".stam-card__bg");
      const avatar = node.querySelector(".stam-card__avatar");
      if (!years) continue;
      if (!bg || !avatar) {
        bad.push(`${shape.getAttribute("aria-label")}: no card shape or avatar`);
        continue;
      }
      const y = years.getBoundingClientRect();
      const c = bg.getBoundingClientRect();
      const a = avatar.getBoundingClientRect();
      const name = `${shape.getAttribute("aria-label") ?? node.textContent} "${years.textContent}"`;
      if (y.width === 0) bad.push(`${name}: not drawn`);
      if (y.left < c.left - 0.5 || y.right > c.right + 0.5) {
        bad.push(`${name}: outside the card (${y.left}-${y.right} vs ${c.left}-${c.right})`);
      }
      if (y.left < a.right && y.right > a.left) {
        bad.push(`${name}: over the avatar (${y.left}-${y.right} vs ${a.left}-${a.right})`);
      }
    }
    return bad;
  }, root);
}
