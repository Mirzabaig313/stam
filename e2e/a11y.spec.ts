import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { allCards, card, famSimpleFile } from "./helpers";

/** Serious and critical axe violations, formatted so a failure says what and where. */
async function blockingViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

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
  await expect(page.locator(".tree-row")).toHaveCount(1);
  expect(await blockingViolations(page)).toEqual([]);
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
