import { expect, type Page, test } from "@playwright/test";

import { famSimple } from "../tests/fixtures/families";
import { blockingViolations } from "./axe";
import { allCards, card, chooseTheme, famSimpleFile, openGedcomReport } from "./helpers";

async function openSimpleFamily(page: Page): Promise<void> {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(famSimpleFile());
  await expect(allCards(page)).toHaveCount(5);
  await expect(card(page, "Ahmed Khan")).toBeVisible();
}

test("the tree list has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Your trees" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test("a tree list with a tree has none either", async ({ page }) => {
  await openSimpleFamily(page);
  await page.getByRole("link", { name: "My trees" }).click();
  await expect(page.locator(".tree-card")).toHaveCount(1);
  await expect(page.locator(".tree-card .tree-preview")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test("the tree list's cards open with the keyboard, and their menu is reachable", async ({
  page,
  browserName,
}) => {
  await openSimpleFamily(page);
  await page.getByRole("link", { name: "My trees" }).click();
  const link = page.getByRole("link", { name: "Simple family" });
  const more = page.getByRole("button", { name: "Actions for Simple family" });
  await link.focus();
  await page.keyboard.press("Tab");
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Simple family" });
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  // Safari leaves links out of the Tab order unless the user turns them on.
  if (browserName === "webkit") await link.focus();
  else await page.keyboard.press("Shift+Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(allCards(page)).toHaveCount(5);
});

test("the tree list is one column on a phone and two or more on a desktop", async ({ page }) => {
  await openSimpleFamily(page);
  await page.getByRole("link", { name: "My trees" }).click();
  await expect(page.locator(".tree-card")).toHaveCount(1);
  const columns = await page
    .locator(".tree-grid")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  const width = page.viewportSize()!.width;
  if (width < 640) expect(columns).toBe(1);
  else expect(columns).toBeGreaterThanOrEqual(2);
});

test("the editor with the simple family has none", async ({ page }) => {
  await openSimpleFamily(page);
  expect(await blockingViolations(page)).toEqual([]);
});

test("the editor with the person panel open has none", async ({ page }) => {
  await openSimpleFamily(page);
  await card(page, "Ali Khan").click();
  await expect(page.getByRole("complementary", { name: "Person details" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test("the quick-add handles and the inline editor have none", async ({ page }) => {
  await openSimpleFamily(page);
  await card(page, "Ali Khan").hover();
  await expect(page.getByRole("button", { name: "Add child of Ali Khan" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Add child of Ali Khan" }).click();
  await expect(page.locator(".inline-editor")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

/** The simple family with a birthday next week, so the birthdays panel has rows. */
function birthdayFile() {
  const tree = { ...famSimple(), name: "A11y family", id: "e2e-a11y" };
  tree.persons.c1 = { ...tree.persons.c1!, birth: { date: { year: 1980, month: 10, day: 25 } } };
  const body = { format: "stam", schemaVersion: 1, exportedAt: new Date().toISOString(), tree };
  return {
    name: "a11y.stam.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(body)),
  };
}

async function openBirthdayFamily(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(2026, 9, 23, 12));
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(birthdayFile());
  await expect(allCards(page)).toHaveCount(5);
}

const view = (page: Page, name: string) =>
  page.getByRole("group", { name: "View" }).getByRole("button", { name, exact: true });

for (const mode of ["Pedigree", "Descendants", "Hourglass", "Fan", "Timeline"]) {
  test(`the ${mode} view has none`, async ({ page }) => {
    await openSimpleFamily(page);
    await card(page, "Ali Khan").click();
    await view(page, mode).click();
    await expect(view(page, mode)).toHaveAttribute("aria-pressed", "true");
    if (mode === "Fan")
      await expect(page.locator(".stam-fan [data-person-id]").first()).toBeVisible();
    if (mode === "Timeline") {
      await expect(page.locator(".stam-timeline [data-person-id]").first()).toBeVisible();
    }
    expect(await blockingViolations(page)).toEqual([]);
  });
}

test("the How are we related? panel, with a result, has none", async ({ page }) => {
  await openSimpleFamily(page);
  await card(page, "Ali Khan").click();
  await card(page, "Ahmed Khan").click({ modifiers: ["Shift"] });
  const panel = page.getByRole("complementary", { name: "How are we related?" });
  await expect(panel.getByRole("list", { name: "Relationships" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  await panel.getByRole("button", { name: /^First person:/ }).click();
  await expect(page.getByRole("dialog", { name: "Choose a person" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test("the birthdays panel has none", async ({ page }) => {
  await openBirthdayFamily(page);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: /^Birthdays/ }).click();
  await expect(page.getByRole("region", { name: "Upcoming birthdays" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test("the export dialog has none, for every format", async ({ page }) => {
  await openSimpleFamily(page);
  await page.keyboard.press("ControlOrMeta+e");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  const formats = dialog.getByRole("radio");
  for (let i = 0; i < (await formats.count()); i++) {
    await formats.nth(i).check();
    expect(await blockingViolations(page), `format ${i}`).toEqual([]);
  }
});

test("the More menu, the Add chooser, search and the delete dialog have none", async ({ page }) => {
  await openSimpleFamily(page);
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menu", { name: "More" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByRole("searchbox")).toBeFocused();
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "My trees" }).click();
  await page.getByRole("button", { name: /^Actions for / }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`the Settings dialog and its language picker have none, ${theme}`, async ({ page }) => {
    await page.goto("/app");
    await chooseTheme(page, theme);
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog.getByRole("combobox", { name: "Language" })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    // Urdu, with the "Translation in review" note under the picker.
    await dialog.getByRole("combobox", { name: "Language" }).selectOption("ur");
    const urdu = page.getByRole("dialog", { name: "ترتیبات" });
    await expect(urdu.locator(".language-review")).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    await urdu.getByRole("combobox").selectOption("en");
    await expect(dialog).toBeVisible();
  });

  test(`the GEDCOM import report has none, ${theme}`, async ({ page }) => {
    await page.goto("/app");
    await chooseTheme(page, theme);
    await openGedcomReport(page);
    expect(await blockingViolations(page)).toEqual([]);
  });
}

test("the first Tab reaches Skip to content, which jumps past the toolbar", async ({
  page,
  browserName,
}) => {
  await openSimpleFamily(page);
  await page.mouse.move(2, 2);
  // Safari's Tab skips links unless the user turns that on; Option+Tab always reaches them.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  // The next Tab lands inside the main content, not back in the toolbar.
  await page.keyboard.press("Tab");
  const inMain = await page.evaluate(() => !!document.activeElement?.closest("main"));
  expect(inMain).toBe(true);
});

test("the tree list links home from the Stam wordmark", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("link", { name: "Stam home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("primary buttons say they are hovered with more than a colour", async ({ page }) => {
  await page.goto("/app");
  const button = page.getByRole("button", { name: "New tree" });
  const look = () =>
    button.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.textDecorationLine}|${s.boxShadow}|${s.borderWidth}|${s.outlineStyle}`;
    });
  const before = await look();
  await button.hover();
  await expect.poll(look).not.toBe(before);
});

test("every element that takes keyboard focus shows a visible outline", async ({ page }) => {
  await openSimpleFamily(page);
  await page.mouse.move(2, 2);

  const seen = new Set<string>();
  const problems: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      // SVG controls draw their focus ring as a stroke on a child (the card's ring rect, or the
      // hit area of a chevron or link) instead of a CSS outline.
      const drawnAsStroke = [
        ...el.querySelectorAll(".stam-card__focus, .stam-hit, .stam-card__family-bg"),
      ]
        .map((ring) => getComputedStyle(ring))
        .some(
          (ring) =>
            Number(ring.opacity) > 0 &&
            ring.stroke !== "none" &&
            Number.parseFloat(ring.strokeWidth) > 0,
        );
      const drawn =
        drawnAsStroke ||
        (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0);
      const label =
        el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName;
      return {
        key: `${el.tagName}:${label}`,
        label,
        outlineStyle: style.outlineStyle,
        drawn,
      };
    });
    if (!info) continue;
    if (seen.has(info.key)) break; // Back at the start of the cycle.
    seen.add(info.key);
    if (!info.drawn) problems.push(`${info.label} (outline-style: ${info.outlineStyle})`);
  }
  expect(seen.size).toBeGreaterThan(8);
  expect(problems).toEqual([]);
});
