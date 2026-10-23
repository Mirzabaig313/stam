import { expect, type Locator, type Page, test } from "@playwright/test";

import { famSimple } from "../tests/fixtures/families";
import { allCards, card, chooseTheme, famSimpleFile, fillInlineEditor, hoverCard } from "./helpers";

type Box = { x: number; y: number; width: number; height: number };

// M6 tokens (tokens.css): the mulberry accent, the aubergine ink, the soft card edge.
const ACCENT = "rgb(124, 42, 92)";
const INK = "rgb(42, 30, 36)";
const CARD_EDGE = "rgba(42, 30, 36, 0.18)";

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

  test("an unselected card keeps its soft 1 px edge", async ({ page }) => {
    await openSimpleFamily(page);
    await page.mouse.move(2, 400);
    const r = await rings(card(page, "Omar Khan"));
    expect(r.border).toMatchObject({ stroke: CARD_EDGE, width: 1 });
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
    const button = page.getByRole("button", { name: "More", exact: true });
    const tip = page.locator(".tip-anchor", { has: button }).locator(".tip");
    await button.hover();
    await expect(tip).toHaveCSS("opacity", "1");

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("menu", { name: "More" })).toBeVisible();
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

test.describe("toolbar layout", () => {
  test("one row at 1280 px, never wrapping, with the views near the middle", async ({ page }) => {
    test.skip(test.info().project.name === "mobile", "the desktop bar");
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSimpleFamily(page);
    const bar = await boxOf(page.getByRole("banner"));
    expect(bar.height).toBeLessThanOrEqual(64);
    // Every control sits on the bar's one row.
    for (const name of ["My trees", "Add person", "Search people", "Zoom in", "Undo", "More"]) {
      const role = name === "My trees" ? "link" : "button";
      const box = await boxOf(page.getByRole(role, { name, exact: true }));
      expect(box.y, name).toBeGreaterThanOrEqual(bar.y);
      expect(box.y + box.height, name).toBeLessThanOrEqual(bar.y + bar.height);
    }
    const views = await boxOf(page.getByRole("group", { name: "View" }));
    expect(Math.abs(views.x + views.width / 2 - 640)).toBeLessThan(160);

    // Every view keeps the one row: the fan's generations float on the canvas, not in the bar.
    for (const mode of ["Pedigree", "Descendants", "Hourglass", "Fan", "Timeline", "Family"]) {
      await page
        .getByRole("group", { name: "View" })
        .getByRole("button", { name: mode, exact: true })
        .click();
      await expect(
        page.getByRole("group", { name: "View" }).getByRole("button", { name: mode, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect((await boxOf(page.getByRole("banner"))).height, mode).toBeLessThanOrEqual(64);
      if (mode === "Fan") {
        const generations = await boxOf(page.getByRole("group", { name: "Generations" }));
        expect(generations.y, "the stepper is on the canvas").toBeGreaterThan(bar.y + bar.height);
      }
    }
  });

  test("a phone gets a top bar and a bottom dock with Add, Search and the views", async ({
    page,
  }) => {
    test.skip(test.info().project.name !== "mobile", "the phone bars");
    await openSimpleFamily(page);
    const height = page.viewportSize()!.height;
    for (const name of ["Add person", "Search people"]) {
      const box = await boxOf(page.getByRole("button", { name, exact: true }));
      expect(box.y + box.height, name).toBeGreaterThan(height - 70);
    }
    const views = await boxOf(page.getByRole("group", { name: "View" }));
    expect(views.y + views.height).toBeGreaterThan(height - 70);
    const more = await boxOf(page.getByRole("button", { name: "More", exact: true }));
    expect(more.y).toBeLessThan(60);
    // The canvas ends above the dock.
    const canvas = await boxOf(page.locator(".stam-canvas"));
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(height - 55);
    await expect(page.locator(".stam-minimap")).toHaveCount(0);
  });
});

test.describe("a person above", () => {
  test("Ismail → Haider: the + above Haider puts Ahmed between them; one undo restores it", async ({
    page,
  }) => {
    const tree = {
      ...famSimple(),
      id: "e2e-ismail",
      name: "Ismail",
      rootPersonId: "ismail",
      persons: {
        ismail: {
          id: "ismail",
          firstName: "Ismail",
          lastName: "Khan",
          gender: "male",
          isLiving: true,
        },
        haider: {
          id: "haider",
          firstName: "Haider",
          lastName: "Khan",
          gender: "male",
          isLiving: true,
        },
      },
      unions: {
        u: {
          id: "u",
          partners: ["ismail"],
          status: "partner",
          children: [{ personId: "haider", type: "biological" }],
        },
      },
      unionOrder: { ismail: ["u"] },
    };
    await page.goto("/app");
    await page.locator('input[type="file"]').setInputFiles({
      name: "ismail.stam.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "stam",
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          tree,
        }),
      ),
    });
    await expect(allCards(page)).toHaveCount(2);
    await card(page, "Haider Khan").click();
    await hoverCard(page, "Haider Khan");
    await page
      .getByRole("button", { name: "Add a person between Ismail Khan and Haider Khan" })
      .click();
    await fillInlineEditor(page, "Ahmed", "Male");
    await expect(allCards(page)).toHaveCount(3);
    const [ismail, ahmed, haider] = await Promise.all(
      ["Ismail Khan", "Ahmed Khan", "Haider Khan"].map((name) => boxOf(card(page, name))),
    );
    expect(ismail!.y).toBeLessThan(ahmed!.y);
    expect(ahmed!.y).toBeLessThan(haider!.y);
    await expect(card(page, "Haider Khan")).toHaveAttribute("aria-label", /son of Ahmed Khan/);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(allCards(page)).toHaveCount(2);
    await expect(card(page, "Haider Khan")).toHaveAttribute("aria-label", /son of Ismail Khan/);
  });
});

test.describe("+ Add person", () => {
  test("adds a child to the selected person through the chooser and the inline editor", async ({
    page,
  }) => {
    await openSimpleFamily(page);
    await card(page, "Zainab Khan").click();
    await page.getByRole("button", { name: "Add person" }).click();
    const chooser = page.getByRole("menu", { name: "Add to Zainab Khan" });
    await expect(chooser).toBeVisible();
    await expectInWindow(page, chooser);
    await chooser.getByRole("menuitem", { name: "Child", exact: true }).click();
    const editor = page.locator(".inline-editor");
    await expect(editor).toBeVisible();
    await editor.getByRole("textbox", { name: "Name" }).fill("Sana Khan");
    await editor.getByRole("button", { name: "Female", exact: true }).click();
    await page.keyboard.press("Enter");
    await expect(allCards(page)).toHaveCount(6);
    await expect(card(page, "Sana Khan")).toBeVisible();
  });

  test("with nobody selected it asks for a selection first", async ({ page }) => {
    await openSimpleFamily(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Add person" }).click();
    const chooser = page.getByRole("menu", { name: "Select someone first" });
    await expect(chooser).toBeVisible();
    await expectInWindow(page, chooser);
    await page.keyboard.press("Escape");
    await expect(chooser).toBeHidden();
  });
});

async function expectInWindow(page: Page, locator: Locator): Promise<void> {
  const box = await boxOf(locator);
  const size = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height);
}
