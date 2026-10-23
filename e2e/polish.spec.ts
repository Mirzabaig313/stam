import { expect, type Locator, type Page, test } from "@playwright/test";

import { allCards, card, chooseTheme, famSimpleFile } from "./helpers";

type Box = { x: number; y: number; width: number; height: number };

const ACCENT = "rgb(43, 71, 245)";
const INK = "rgb(17, 19, 17)";

async function openSimpleFamily(page: Page): Promise<void> {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(famSimpleFile());
  await expect(allCards(page)).toHaveCount(5);
  // The camera fits and settles after the import.
  await page.waitForTimeout(700);
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return box;
}

/** What each ring-like part of a card paints: the focus ring and the border. */
async function rings(cardLocator: Locator) {
  return cardLocator.evaluate((g) => {
    const read = (selector: string) => {
      const el = g.querySelector(selector);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        stroke: s.stroke,
        width: Number.parseFloat(s.strokeWidth),
        opacity: Number(s.opacity),
      };
    };
    return {
      border: read(".stam-card__bg"),
      focus: read(".stam-card__focus"),
      lift: read(".stam-card__lift"),
    };
  });
}

test.describe("selection and focus", () => {
  test("a selected card has one 2 px accent outline and no other ring", async ({ page }) => {
    await openSimpleFamily(page);
    await card(page, "Ali Khan").click();
    await page.mouse.move(2, 400); // off the card: no hover
    await page.waitForTimeout(400);

    const r = await rings(card(page, "Ali Khan"));
    expect(r.border).toMatchObject({ stroke: ACCENT, width: 2, opacity: 1 });
    // A mouse click is not keyboard focus: no focus ring, and no hover edge, so one ring in all.
    expect(r.focus?.opacity).toBe(0);
    expect(r.lift?.opacity).toBe(0);
  });

  test("keyboard focus adds a separate ink ring; selection stays accent; never three rings", async ({
    page,
  }) => {
    await openSimpleFamily(page);
    await card(page, "Ali Khan").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter"); // selects the focused card
    await page.mouse.move(2, 400);
    await page.waitForTimeout(400);

    const r = await rings(card(page, "Ali Khan"));
    expect(r.border).toMatchObject({ stroke: ACCENT, width: 2 });
    expect(r.focus).toMatchObject({ stroke: INK, width: 2, opacity: 1 });
    expect(r.lift?.opacity).toBe(0);

    // Hovering the focused, selected card must not add a third edge.
    await card(page, "Ali Khan").hover();
    await page.waitForTimeout(400);
    const hovered = await rings(card(page, "Ali Khan"));
    const painted = [hovered.border, hovered.focus, hovered.lift].filter(
      (part) => part && part.opacity > 0 && (part.stroke !== "none" || part === hovered.lift),
    );
    expect(painted.length).toBeLessThanOrEqual(2);
  });

  test("print theme: the selected card has a 3 px double outline, not just a heavier edge", async ({
    page,
  }) => {
    await page.goto("/app");
    await chooseTheme(page, "print");
    await openSimpleFamily(page);
    await card(page, "Ali Khan").click();
    await page.mouse.move(2, 400);
    await page.waitForTimeout(400);

    const BLACK = "rgb(0, 0, 0)";
    const selected = await rings(card(page, "Ali Khan"));
    const plain = await rings(card(page, "Omar Khan"));
    // Every print card has a 1.5 px black edge; the selected one a 3 px edge and a ring round it.
    expect(plain.border).toMatchObject({ stroke: BLACK, width: 1.5 });
    expect(plain.focus?.opacity).toBe(0);
    expect(selected.border).toMatchObject({ stroke: BLACK, width: 3 });
    expect(selected.focus).toMatchObject({ stroke: BLACK, width: 1, opacity: 1 });
  });

  test("an unselected card keeps its 1 px ink border", async ({ page }) => {
    await openSimpleFamily(page);
    await page.mouse.move(2, 400);
    const r = await rings(card(page, "Omar Khan"));
    expect(r.border).toMatchObject({ stroke: INK, width: 1 });
    expect(r.focus?.opacity).toBe(0);
  });
});

async function expectHandlesClear(page: Page, who: string) {
  await card(page, who).hover();
  const handles = page.locator(".quick-add__handle");
  await expect(handles).not.toHaveCount(0);
  // The card's drawn rectangle, not its group (which also holds the invisible focus ring).
  const own = await boxOf(card(page, who).locator(".stam-card__bg"));
  const others: Box[] = [];
  for (const c of await allCards(page).all()) others.push(await boxOf(c.locator(".stam-card__bg")));
  for (const handle of await handles.all()) {
    const box = await boxOf(handle);
    // 24 px, give or take the sub-pixel rounding of a scaled page.
    expect(box.width).toBeGreaterThan(23.9);
    expect(box.height).toBeGreaterThan(23.9);
    // Fully outside its own card and every neighbour: never over a name, avatar or date.
    expect(overlaps(box, own), "handle overlaps its card").toBe(false);
    for (const other of others) expect(overlaps(box, other), "handle overlaps a card").toBe(false);
  }
}

test.describe("quick-add handles", () => {
  test("sit fully outside the card at the 32 px couple gap", async ({ page }) => {
    await openSimpleFamily(page);
    await expectHandlesClear(page, "Ahmed Khan");
    await expectHandlesClear(page, "Sara Khan");
  });

  test("stay clear of every card on a child too", async ({ page }) => {
    await openSimpleFamily(page);
    await expectHandlesClear(page, "Zainab Khan");
  });

  test("stay clear when zoomed out, where the couple gap is narrower than a handle", async ({
    page,
  }) => {
    await openSimpleFamily(page);
    // Zoom out while the cards stay big enough to show handles (a phone starts near that limit).
    for (let i = 0; i < 3; i++) {
      const { width } = await boxOf(card(page, "Ahmed Khan").locator(".stam-card__bg"));
      if (width / 1.2 < 180 * 0.45 + 4) break;
      await page.getByRole("button", { name: "Zoom out" }).click();
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(400);
    await expectHandlesClear(page, "Ahmed Khan");
    await expectHandlesClear(page, "Sara Khan");
  });

  test("only one card shows handles at a time", async ({ page }) => {
    await openSimpleFamily(page);
    await card(page, "Ali Khan").click(); // selected
    await card(page, "Omar Khan").hover(); // hovered
    await page.waitForTimeout(400);
    await expect(page.locator(".quick-add")).toHaveCount(1);
    await expect(page.locator(".quick-add[data-handles-for]")).toHaveCount(1);
  });
});

test.describe("cards without dates", () => {
  test("the name sits in the vertical middle of the card", async ({ page }) => {
    await openSimpleFamily(page);
    // Ahmed has no dates; Ali has a birth year.
    const middle = (name: string) =>
      card(page, name).evaluate((g) => {
        const text = g.parentElement?.querySelector(".stam-card__name") as SVGGraphicsElement;
        const b = text.getBBox();
        return b.y + b.height / 2;
      });
    expect(Math.abs((await middle("Ahmed Khan")) - 36)).toBeLessThanOrEqual(2);
    // With a date line the name sits above the middle, as before.
    expect(await middle("Ali Khan")).toBeLessThan(34);
  });
});

test.describe("toolbar tooltips", () => {
  test("a button's tip hides while its menu is open, and comes back once it closes", async ({
    page,
  }) => {
    test.skip(test.info().project.name === "mobile", "touch screens show no hover tips");
    await openSimpleFamily(page);
    const button = page.getByRole("button", { name: "Menu", exact: true });
    const tip = page.locator(".tip-anchor", { has: button }).locator(".tip");
    await button.hover();
    await expect(tip).toHaveCSS("opacity", "1");

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".menu-panel")).toBeVisible();
    await expect(tip).toBeHidden();
    // Hovering it again, or keyboard focus on it, does not bring the tip over the menu.
    await button.hover();
    await page.waitForTimeout(500);
    await expect(tip).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.hover();
    await expect(tip).toHaveCSS("opacity", "1");
  });
});
