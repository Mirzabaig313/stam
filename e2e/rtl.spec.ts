// Right to left: every screen and the core editor flows with the page in Arabic RTL, on the
// production build (whose CSS keeps logical properties instead of lowering them by :lang()).
// Runs only in the "rtl" project. Set SHOTS_DIR to keep a screenshot of each screen.
//
// The app is switched to Arabic through the real Settings dialog (`useArabicRtl`), and every
// selector reads the real Arabic strings from ar.json (`t`, from ./strings). The tree follows the
// interface ("auto" tree direction), so it mirrors. The landing page has no language setting:
// its test forces `<html lang="ar" dir="rtl">` instead (`forceRtlDocument`).
import { readFileSync } from "node:fs";

import { expect, type Locator, type Page, test } from "@playwright/test";

import type { TreeDocument } from "@/core/model/types";

import { famSimple } from "../tests/fixtures/families";
import { blockingViolations } from "./axe";
import {
  addChild,
  allCards,
  card,
  centreOf,
  chooseTheme,
  createTree,
  dragBetween,
  hoverCard,
  openGedcomReport,
  rowOrder,
  sideHandle,
  startWithPerson,
  yearLineProblems,
} from "./helpers";
import { EN, tFor } from "./strings";

const t = tFor("ar");

/**
 * Chooses Arabic in the Settings dialog, which saves it to the repo, as a user would: the dialog
 * turns Arabic at once, with no reload.
 */
async function useArabicRtl(page: Page): Promise<void> {
  await page.goto("/app");
  await page.getByRole("button", { name: EN("settings.open") }).click();
  await page
    .getByRole("dialog", { name: EN("settings.title") })
    .getByRole("combobox", { name: EN("language.label") })
    .selectOption("ar");
  const dialog = page.getByRole("dialog", { name: t("settings.title") });
  await expect(dialog.getByText(t("language.inReview"))).toBeVisible();
  await dialog.getByRole("button", { name: t("settings.done") }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
}

/** Keeps `<html lang="ar" dir="rtl">` from the first byte on, whatever the page sets. */
async function forceRtlDocument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Defined inside: the init script runs in the page, so it can't call out to this module.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const force = () => {
      const html = document.documentElement;
      if (!html) return;
      if (html.getAttribute("dir") !== "rtl") html.setAttribute("dir", "rtl");
      if (html.getAttribute("lang") !== "ar") html.setAttribute("lang", "ar");
    };
    new MutationObserver(force).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["dir", "lang"],
    });
    force();
  });
}

/** Collects console errors and uncaught exceptions for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Saves `$SHOTS_DIR/rtl-<name>.png` once motion has settled. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/rtl-${name}.png` });
}

/** famSimple with birthdays on 23 and 25 Oct and an Arabic-script name for Zainab's husband. */
function khanFamily(): TreeDocument {
  const tree = { ...famSimple(), name: "عائلة خان", id: "e2e-rtl-khan" };
  tree.persons.c1 = { ...tree.persons.c1!, birth: { date: { year: 1980, month: 10, day: 23 } } };
  tree.persons.c2 = { ...tree.persons.c2!, birth: { date: { year: 1983, month: 10, day: 25 } } };
  return tree;
}

async function importTree(page: Page, tree: TreeDocument): Promise<void> {
  const body = { format: "stam", schemaVersion: 1, exportedAt: new Date().toISOString(), tree };
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles({
    name: "tree.stam.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(body)),
  });
  await expect(allCards(page)).toHaveCount(5);
  await centreOf(card(page, "Ali Khan"));
}

/** The element's box, which must lie inside the window. */
async function expectOnScreen(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  const size = locator.page().viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5);
}

const CHILDREN = ["Ali Khan", "Zainab Khan", "Omar Khan"];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 23, 12));
  await useArabicRtl(page);
});

test.describe("screens", () => {
  test("landing page", async ({ page }) => {
    const errors = watchErrors(page);
    await forceRtlDocument(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(page, "landing");
    // Nothing spills sideways: in RTL, overflow shows as content left of 0.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test("tree list: empty, then with a tree", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("button", { name: t("treeList.newTree") })).toBeVisible();
    await shot(page, "tree-list-empty");
    await page.getByRole("button", { name: t("treeList.newTree") }).click();
    await page.getByLabel(t("common.treeName")).fill("عائلة خان");
    await shot(page, "tree-list-new");
    await page.getByRole("button", { name: t("common.create") }).click();
    await expect(page.getByRole("link", { name: "عائلة خان" })).toBeVisible();
    await shot(page, "tree-list");
  });

  test("editor: the tree mirrors, the first child on the right; toolbar starts on the right", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await importTree(page, khanFamily());
    await expect(page.locator(".stam-canvas")).toHaveAttribute("dir", "rtl");
    expect(await rowOrder(page, CHILDREN)).toEqual(CHILDREN.toReversed());

    // The toolbar runs from the right: "My trees" sits right of the undo button.
    const home = await page.getByRole("link", { name: t("toolbar.myTrees") }).boundingBox();
    const undo = await page.getByRole("button", { name: t("toolbar.undo") }).boundingBox();
    expect(home!.x).toBeGreaterThan(undo!.x);
    // Undo and redo arrows face the other way; zoom does not.
    await expect(page.getByRole("button", { name: t("toolbar.undo") }).locator("svg")).toHaveCSS(
      "scale",
      "-1 1",
    );
    await expect(page.getByRole("button", { name: t("toolbar.zoomIn") }).locator("svg")).toHaveCSS(
      "scale",
      "none",
    );
    // The generation ruler is at the inline start (right), the minimap at the bottom left.
    const canvas = (await page.locator(".stam-canvas").boundingBox())!;
    const ruler = (await page.locator(".stam-ruler").boundingBox())!;
    expect(ruler.x + ruler.width).toBeCloseTo(canvas.x + canvas.width, 0);
    const minimap = page.locator(".stam-minimap");
    if ((await minimap.count()) > 0) {
      const box = (await minimap.boundingBox())!;
      expect(box.x).toBeLessThan(canvas.x + canvas.width / 2);
    }
    await shot(page, "editor");
    expect(errors).toEqual([]);
  });

  test("tooltips stay on screen at both ends of the toolbar", async ({ page }) => {
    await importTree(page, khanFamily());
    for (const key of ["toolbar.zoomIn", "toolbar.menu", "views.mode.family"]) {
      const button = page.getByRole("button", { name: t(key), exact: true });
      await button.hover();
      const tip = page.locator(".tip-anchor:hover > .tip");
      await expect(tip).toBeVisible();
      await expect(tip).toHaveCSS("opacity", "1");
      await expectOnScreen(tip);
      await shot(page, `tooltip-${key.split(".").at(-1)!.toLowerCase()}`);
    }
  });

  test("view switcher, fan and timeline", async ({ page }) => {
    const errors = watchErrors(page);
    await importTree(page, khanFamily());
    const switcher = page.getByRole("group", { name: t("views.switcher") });
    await switcher.getByRole("button", { name: t("views.mode.descendants"), exact: true }).hover();
    await page.waitForTimeout(500);
    await shot(page, "view-switcher");
    for (const mode of ["pedigree", "descendants", "hourglass", "fan", "timeline"]) {
      await switcher.getByRole("button", { name: t(`views.mode.${mode}`), exact: true }).click();
      await page.mouse.move(2, 400);
      await shot(page, `view-${mode}`);
    }
    expect(errors).toEqual([]);
  });

  test("person panel and delete dialog", async ({ page }) => {
    await importTree(page, khanFamily());
    await card(page, "Zainab Khan").click();
    const panel = page.getByRole("complementary", { name: t("panel.label") });
    await expect(panel).toBeVisible();
    // The panel sits at the inline end: the left in RTL.
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeLessThan(page.viewportSize()!.width / 2);
    await shot(page, "side-panel");
    await panel.getByRole("button", { name: t("panel.deleteButton") }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await shot(page, "delete-dialog");
    await page.keyboard.press("Escape");
  });

  test("toolbar menu and export dialog", async ({ page }) => {
    await importTree(page, khanFamily());
    await page.getByRole("button", { name: t("toolbar.menu") }).click();
    const menu = page.locator(".toolbar-menu, [role=menu]").first();
    await page.waitForTimeout(200);
    await shot(page, "menu");
    if (await menu.isVisible()) await expectOnScreen(menu);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+e");
    await expect(page.getByRole("dialog", { name: t("export.title") })).toBeVisible();
    await shot(page, "export-dialog");
  });

  test("birthdays panel", async ({ page }) => {
    await importTree(page, khanFamily());
    await page.getByRole("button", { name: t("birthdays.open") }).click();
    const panel = page.getByRole("region", { name: t("birthdays.title") });
    await expect(panel).toContainText(t("birthdays.inDays", { count: 2 }));
    await expectOnScreen(panel);
    await shot(page, "birthdays");
  });

  test("relationship panel with the path highlighted", async ({ page }) => {
    await importTree(page, khanFamily());
    await card(page, "Ali Khan").click();
    await card(page, "Omar Khan").click({ modifiers: ["Shift"] });
    const panel = page.getByRole("complementary", { name: t("kinship.panel.title") });
    // The Arabic sentence (idafa): "Ali Khan هو أخ Omar Khan".
    await expect(panel).toContainText(/Ali Khan\s+هو\s+أخ\s+Omar Khan/);
    await shot(page, "relation-panel");
  });

  test("search", async ({ page }) => {
    await importTree(page, khanFamily());
    await page.keyboard.press("ControlOrMeta+f");
    const box = page.getByRole("searchbox", { name: t("toolbar.search") });
    await box.fill("Omar");
    await shot(page, "search");
    await page.keyboard.press("Enter");
    await expect(card(page, "Omar Khan")).toHaveAttribute("aria-current", "true");
  });

  test("the drop menu after dragging a card onto another", async ({ page }) => {
    await importTree(page, khanFamily());
    const from = await centreOf(card(page, "Ali Khan"));
    const to = await centreOf(card(page, "Omar Khan"));
    await dragBetween(page, from, to);
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expectOnScreen(menu);
    // It opens toward the inline end: its right edge at the drop point.
    const box = (await menu.boundingBox())!;
    expect(Math.abs(box.x + box.width - to.x)).toBeLessThan(2);
    await shot(page, "drop-menu");
    await page.keyboard.press("Escape");
  });
});

test.describe("core flows", () => {
  test("add people: side handles name the side they are on", async ({ page }) => {
    await createTree(page, "RTL family", t);
    await startWithPerson(page, "Ahmed Khan", "Male", t);
    await addChild(page, "Ahmed Khan", "Ali", "Male", t);
    await addChild(page, "Ahmed Khan", "Omar", "Male", t);
    // Ali came first, so he is on the right.
    expect(await rowOrder(page, ["Ali Khan", "Omar Khan"])).toEqual(["Omar Khan", "Ali Khan"]);
    await hoverCard(page, "Ali Khan");
    const left = (await sideHandle(page, "Ali Khan", "left", t).boundingBox())!;
    const right = (await sideHandle(page, "Ali Khan", "right", t).boundingBox())!;
    expect(left.x).toBeLessThan(right.x);
    await shot(page, "handles");
  });

  test("drag a child to the front of the row (the right), then undo with Ctrl+Z", async ({
    page,
  }) => {
    await importTree(page, khanFamily());
    const first = await centreOf(card(page, "Ali Khan"));
    const last = await centreOf(card(page, "Omar Khan"));
    // The front slot is right of the first card in RTL.
    await dragBetween(page, last, { x: first.x + 90 + 20, y: last.y });
    await expect
      .poll(() => rowOrder(page, CHILDREN))
      .toEqual(["Zainab Khan", "Ali Khan", "Omar Khan"]);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => rowOrder(page, CHILDREN)).toEqual(CHILDREN.toReversed());
  });

  test("arrow keys follow what the user sees", async ({ page }) => {
    await importTree(page, khanFamily());
    await card(page, "Zainab Khan").focus();
    await page.keyboard.press("ArrowRight");
    await expect(card(page, "Ali Khan")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(card(page, "Omar Khan")).toBeFocused();
  });

  test("export SVG: the drawing is mirrored like the canvas", async ({ page }, info) => {
    await importTree(page, khanFamily());
    await page.keyboard.press("ControlOrMeta+e");
    const dialog = page.getByRole("dialog", { name: t("export.title") });
    await dialog.getByRole("radio", { name: /SVG/ }).check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: t("export.export"), exact: true }).click(),
    ]);
    const path = info.outputPath("tree.svg");
    await download.saveAs(path);
    const svg = readFileSync(path, "utf8");
    // Ali (first child) is drawn right of Omar (last child).
    const xOf = (name: string) => {
      const at = svg.indexOf(name);
      const before = svg.lastIndexOf("translate(", at);
      return Number(/translate\(([-\d.e]+)/.exec(svg.slice(before))?.[1]);
    };
    expect(xOf("Ali")).toBeGreaterThan(xOf("Omar"));
  });
  test("year lines stay inside their card and clear of the avatar, on canvas and in SVG", async ({
    page,
  }, info) => {
    // Ahmed's is the long deceased line ("1920 – †1999"); the others are birth years only.
    const tree = khanFamily();
    tree.persons.dad = {
      ...tree.persons.dad!,
      birth: { date: { year: 1920 } },
      death: { date: { year: 1999 } },
    };
    await importTree(page, tree);
    await expect(page.locator(".stam-card__years", { hasText: "1920 – †1999" })).toBeVisible();
    expect(await page.locator(".stam-canvas .stam-card__years").count()).toBe(4);
    expect(await yearLineProblems(page, ".stam-canvas")).toEqual([]);

    // The export draws the same cards: check the downloaded SVG as a browser draws it.
    await page.keyboard.press("ControlOrMeta+e");
    const dialog = page.getByRole("dialog", { name: t("export.title") });
    await dialog.getByRole("radio", { name: /SVG/ }).check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: t("export.export"), exact: true }).click(),
    ]);
    const path = info.outputPath("years.svg");
    await download.saveAs(path);
    await page.goto(`file://${path}`);
    expect(await page.locator(".stam-card__years").count()).toBe(4);
    expect(await yearLineProblems(page, ":root")).toEqual([]);
  });
});

test.describe("accessibility in Arabic", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`Settings dialog, language picker and GEDCOM report: no serious axe violations, ${theme}`, async ({
      page,
    }) => {
      await page.goto("/app");
      await chooseTheme(page, theme, t);
      await page.getByRole("button", { name: t("settings.open") }).click();
      const dialog = page.getByRole("dialog", { name: t("settings.title") });
      await expect(dialog.getByRole("combobox", { name: t("language.label") })).toBeVisible();
      await expect(dialog.getByText(t("language.inReview"))).toBeVisible();
      expect(await blockingViolations(page)).toEqual([]);
      await shot(page, `settings-${theme}`);
      await dialog.getByRole("button", { name: t("settings.done") }).click();

      const report = await openGedcomReport(page, t);
      await expect(report).toContainText(t("app.import.gedcom.title"));
      expect(await blockingViolations(page)).toEqual([]);
      await shot(page, `gedcom-report-${theme}`);
    });
  }
});
