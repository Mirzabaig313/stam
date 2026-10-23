import { expect, type Locator, type Page, test, type TestInfo } from "@playwright/test";

import type { TreeDocument } from "@/core/model/types";

import { bigFamily } from "../src/dev/bigFamily";
import { famRemarriage, person, union } from "../tests/fixtures/families";
import { card, centreOf, fillInlineEditor, hoverCard } from "./helpers";

// M3 integration: the six views, the relationship calculator and birthdays, in the real editor
// on the production build.

/**
 * famRemarriage (Ali, his ex-wife Hina and wife Mehr, children Bilal, Noor and Sana) with three
 * generations of Ali's ancestors above it, an adopted-only son (Zaid), birth years for the
 * timeline and birthdays around 23 Oct 2026.
 */
function razaFamily(): TreeDocument {
  const doc = famRemarriage();
  const born = (id: string, year: number, month?: number, day?: number) => {
    doc.persons[id]!.birth = { date: { year, month, day } };
  };
  const died = (id: string, year: number) => {
    doc.persons[id]!.isLiving = false;
    doc.persons[id]!.death = { date: { year } };
  };
  const ancestors = [
    person("nadir", "Nadir", "Raza", "male"),
    person("zohra", "Zohra", "Raza", "female"),
    person("feroz", "Feroz", "Shah", "male"),
    person("gul", "Gul", "Shah", "female"),
    person("karim", "Karim", "Raza", "male"),
    person("bano", "Bano", "Raza", "female"),
    person("zaid", "Zaid", "Raza", "male"),
  ];
  for (const p of ancestors) doc.persons[p.id] = p;
  const add = (u: ReturnType<typeof union>) => {
    doc.unions[u.id] = u;
    for (const p of u.partners) (doc.unionOrder[p] ??= []).push(u.id);
  };
  add(union("un", ["nadir", "zohra"], ["karim"]));
  add(union("uf", ["feroz", "gul"], ["bano"]));
  add(union("uk", ["karim", "bano"], ["ali"]));
  doc.unions.m2!.children.push({ personId: "zaid", type: "adopted" });
  doc.rootPersonId = "nadir";

  born("nadir", 1900);
  born("zohra", 1905);
  born("feroz", 1898);
  born("gul", 1902);
  born("karim", 1925, 10, 24); // deceased: no birthday reminder
  born("bano", 1928);
  born("ali", 1950, 10, 29);
  born("wife1", 1952);
  born("wife2", 1960, 12, 1);
  born("a1", 1976, 3, 2);
  born("a2", 1978, 10, 23); // today
  born("a3", 1991, 10, 25);
  born("zaid", 1995, 11, 10);
  for (const id of ["nadir", "zohra", "feroz", "gul"]) died(id, 1970);
  died("karim", 1990);
  died("bano", 2000);
  return { ...doc, id: "e2e-raza", name: "Raza family" };
}

function stamFile(tree: TreeDocument, name = "tree.stam.json") {
  const body = { format: "stam", schemaVersion: 1, exportedAt: new Date().toISOString(), tree };
  return { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(body)) };
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

async function importTree(page: Page, tree: TreeDocument): Promise<void> {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(stamFile(tree));
  await expect(page.getByRole("group", { name: "View" })).toBeVisible();
}

const MODES = ["Family", "Pedigree", "Descendants", "Hourglass", "Fan", "Timeline"] as const;
type Mode = (typeof MODES)[number];

const switcher = (page: Page) => page.getByRole("group", { name: "View" });
const viewButton = (page: Page, mode: Mode) =>
  switcher(page).getByRole("button", { name: mode, exact: true });
const fanItems = (page: Page) => page.locator(".stam-fan [role=button][data-person-id]");
const bars = (page: Page) => page.locator(".stam-timeline [role=button][data-person-id]");
const fanItem = (page: Page, id: string) =>
  page.locator(`.stam-fan [role=button][data-person-id="${id}"]`).first();
const bar = (page: Page, id: string) =>
  page.locator(`.stam-timeline [role=button][data-person-id="${id}"]`).first();
const handles = (page: Page) =>
  page.getByRole("button", { name: /^Add (parent|child) of |^Add spouse or sibling/ });

/** What a view draws: cards on the canvas, segments in the fan, bars in the timeline. */
function itemsOf(page: Page, mode: Mode): Locator {
  if (mode === "Fan") return fanItems(page);
  if (mode === "Timeline") return bars(page);
  return page.locator(".stam-card");
}

async function expectMode(page: Page, mode: Mode): Promise<void> {
  await expect(viewButton(page, mode)).toHaveAttribute("aria-pressed", "true");
  for (const other of MODES) {
    if (other !== mode)
      await expect(viewButton(page, other)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(itemsOf(page, mode).first()).toBeVisible();
}

async function closePanel(page: Page): Promise<void> {
  await page
    .getByRole("complementary", { name: "Person details" })
    .getByRole("button", { name: "Close panel" })
    .click();
  await expect(page.getByRole("complementary", { name: "Person details" })).toBeHidden();
}

const isPhone = (info: TestInfo) => info.project.name === "mobile";

/** Saves a screenshot to $SHOTS_DIR/integrated-<name>-<desktop|phone>.png (desktop: chromium). */
async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const dir = process.env.SHOTS_DIR;
  if (!dir || info.project.name === "webkit") return;
  await page.waitForTimeout(400); // let camera glides finish
  const form = isPhone(info) ? "phone" : "desktop";
  await page.screenshot({ path: `${dir}/integrated-${name}-${form}.png` });
}

test.describe("views", () => {
  test("the switcher and Alt+1…6 go through all six views, each drawing without console errors", async ({
    page,
  }, info) => {
    const errors = watchErrors(page);
    await importTree(page, razaFamily());
    await expectMode(page, "Family");
    // Focus views follow the selection in: Bilal. Closing the panel keeps the focus and the
    // screenshots clear of the phone's bottom sheet.
    await card(page, "Bilal Raza").click();
    await viewButton(page, "Pedigree").click();
    await expect(page.getByText("Focus: Bilal Raza")).toBeVisible();
    await closePanel(page);

    for (const mode of MODES) {
      await viewButton(page, mode).click();
      await expectMode(page, mode);
      await shot(page, info, mode.toLowerCase());
    }
    // Alt+digit, by key code, in a scrambled order.
    for (const n of [2, 5, 3, 6, 4, 1]) {
      await page.locator("body").press(`Alt+Digit${n}`);
      await expectMode(page, MODES[n - 1]!);
    }
    expect(errors).toEqual([]);
  });

  test("pedigree: a parent added through a handle shows in the pedigree and in the family view", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await importTree(page, razaFamily());
    await card(page, "Bilal Raza").click();
    await viewButton(page, "Pedigree").click();
    await expectMode(page, "Pedigree");
    // Bilal, his parents, grandparents and great-grandparents: four rows, nine cards.
    await expect(page.locator(".stam-card")).toHaveCount(9);
    await expect(card(page, "Noor Raza")).toHaveCount(0); // a sibling: not in a pedigree

    // Full cards (and handles) need a closer zoom on a phone; then search centres Nadir.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Search people" }).click();
    await page.getByRole("searchbox", { name: "Search people" }).fill("Nadir");
    await page
      .getByRole("dialog", { name: "Search people" })
      .getByRole("button", { name: /^Nadir Raza/ })
      .click();
    await hoverCard(page, "Nadir Raza");
    await page.getByRole("button", { name: "Add parent of Nadir Raza" }).click();
    await fillInlineEditor(page, "Jalal Raza", "Male");
    await expect(card(page, "Jalal Raza")).toBeVisible();
    await page.getByRole("button", { name: "Fit tree to screen" }).click(); // zoomed in, cards cull
    await expect(page.locator(".stam-card")).toHaveCount(10);

    await viewButton(page, "Family").click();
    await expectMode(page, "Family");
    await expect(card(page, "Jalal Raza")).toBeVisible();
    await expect(card(page, "Noor Raza")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("pedigree: an adopted-only son's adoptive parents are drawn on a dotted line", async ({
    page,
  }) => {
    await importTree(page, razaFamily());
    await card(page, "Zaid Raza").click();
    await viewButton(page, "Pedigree").click();
    await expectMode(page, "Pedigree");
    await expect(card(page, "Ali Raza")).toBeVisible();
    await expect(card(page, "Mehr Raza")).toBeVisible();
    await expect(card(page, "Karim Raza")).toBeVisible();
    const line = page.locator('[data-edge-id="child:m2:zaid"]');
    await expect(line).toHaveCount(1);
    expect(await line.evaluate((el) => el.outerHTML)).toContain('stroke-dasharray="2 3"');
  });

  for (const mode of ["Fan", "Timeline"] as const) {
    test(`${mode.toLowerCase()} is read-only: no handles; a click selects and the panel opens read-only`, async ({
      page,
    }, info) => {
      const errors = watchErrors(page);
      await importTree(page, razaFamily());
      await card(page, "Bilal Raza").click();
      // The family view has handles (a phone's fitted view is too small for them).
      if (!isPhone(info)) await expect(handles(page).first()).toBeAttached();
      await viewButton(page, mode).click();
      await expectMode(page, mode);
      await expect(handles(page)).toHaveCount(0);
      await expect(page.locator(".stam-card")).toHaveCount(0);
      await closePanel(page); // a phone's sheet would cover the fan

      const target = mode === "Fan" ? fanItem(page, "karim") : bar(page, "a3");
      const name = mode === "Fan" ? "Karim Raza" : "Sana Raza";
      await target.click();
      await expect(target).toHaveAttribute("aria-current", "true");
      const panel = page.getByRole("complementary", { name: "Person details" });
      await expect(panel.getByRole("heading", { name })).toBeVisible();
      const firstName = panel.getByRole("textbox", { name: "First name" });
      expect(await firstName.evaluate((el) => el.closest("[inert]") !== null)).toBe(true);
      await expect(panel.getByRole("button", { name: "Delete…" })).toBeDisabled();
      expect(errors).toEqual([]);
    });
  }
});

test.describe("relationship calculator", () => {
  test("Shift+click: the sentence, the path highlighted and the rest dimmed; Esc clears it", async ({
    page,
  }, info) => {
    const errors = watchErrors(page);
    await importTree(page, razaFamily());
    await card(page, "Bilal Raza").click();
    await card(page, "Sana Raza").click({ modifiers: ["Shift"] });
    const panel = page.getByRole("complementary", { name: "How are we related?" });
    await expect(panel).toContainText("Bilal Raza is Sana Raza's half-brother");

    const node = (id: string) => page.locator(`.stam-node[data-node-id="${id}"]`);
    for (const id of ["a1", "ali", "a3"]) {
      await expect(node(id)).not.toHaveClass(/stam-node--dimmed/);
    }
    for (const id of ["a2", "wife1", "wife2", "nadir"]) {
      await expect(node(id)).toHaveClass(/stam-node--dimmed/);
    }
    await expect(page.locator(".stam-edges--path [data-edge-id]").first()).toBeAttached();
    await shot(page, info, "calculator-path");

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.locator(".stam-node--dimmed")).toHaveCount(0);
    await expect(page.locator(".stam-edges--path")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the How are we related? panel: pickers, adoption said outright, swap and Urdu", async ({
    page,
  }, info) => {
    const errors = watchErrors(page);
    await importTree(page, razaFamily());
    await page.getByRole("button", { name: "How are we related?" }).click();
    const panel = page.getByRole("complementary", { name: "How are we related?" });
    await expect(panel).toContainText("Choose two people");

    const pick = async (slot: "First person" | "Second person", query: string, name: string) => {
      await panel.getByRole("button", { name: new RegExp(`^${slot}:`) }).click();
      const dialog = page.getByRole("dialog", { name: "Choose a person" });
      await dialog.getByRole("searchbox").fill(query);
      await dialog.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      await expect(dialog).toBeHidden();
    };
    await pick("First person", "Ali", "Ali Raza");
    await pick("Second person", "Zaid", "Zaid Raza");
    await expect(panel.getByRole("list", { name: "Relationships" })).toContainText(
      "Ali Raza is Zaid Raza's adoptive father",
    );
    await panel.getByRole("button", { name: "Swap people" }).click();
    const results = panel.getByRole("list", { name: "Relationships" });
    await expect(results).toContainText("Zaid Raza is Ali Raza's adopted son");
    await expect(results.locator('bdi[lang="ur"]')).toHaveText("لے پالک بیٹا");
    await shot(page, info, "calculator-panel");

    await pick("First person", "Nadir", "Nadir Raza");
    await pick("Second person", "Bilal", "Bilal Raza");
    await expect(results).toContainText("Nadir Raza is Bilal Raza's great-grandfather");
    await expect(results.locator('bdi[lang="ur"]')).toHaveText("پردادا");
    expect(errors).toEqual([]);
  });
});

test.describe("birthdays", () => {
  test("with a fixed date: the badge counts the week, the list is in date order, a row centres the person", async ({
    page,
  }, info) => {
    const errors = watchErrors(page);
    await page.clock.setFixedTime(new Date(2026, 9, 23, 12));
    await importTree(page, razaFamily());

    // Noor today, Sana in 2 days, Ali in 6; Zaid in 18 days is listed but not counted, and
    // Karim (24 Oct) has died, so he is not reminded.
    const button = page.getByRole("button", { name: "Birthdays: 3 in the next 7 days" });
    await expect(button).toHaveText("3");
    await button.click();
    const list = page.getByRole("region", { name: "Upcoming birthdays" });
    const rows = list.getByRole("button", { name: /^Show / });
    await expect(rows).toHaveText([/Noor Raza/, /Sana Raza/, /Ali Raza/, /Zaid Raza/]);
    await expect(list).toContainText("today");
    await expect(list).toContainText("in 2 days");
    await expect(list).not.toContainText("Karim");
    await shot(page, info, "birthdays");

    await list.getByRole("button", { name: /^Show Zaid Raza,/ }).click();
    await expect(list).toBeHidden();
    const zaid = card(page, "Zaid Raza");
    await expect(zaid).toHaveAttribute("aria-current", "true");
    const centre = await centreOf(zaid);
    const slot = (await page.locator('[data-slot="canvas"]').boundingBox())!;
    expect(Math.abs(centre.x - (slot.x + slot.width / 2))).toBeLessThan(slot.width * 0.15);
    expect(centre.y).toBeGreaterThan(slot.y);
    expect(centre.y).toBeLessThan(slot.y + slot.height);
    expect(errors).toEqual([]);
  });
});

test.describe("performance", () => {
  test("1,000 people: every view switch stays quick; layout time per view is logged", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const tree = { ...bigFamily(1000), id: "e2e-big", name: "Big family" };
    await importTree(page, tree);
    await expect(page.locator(".stam-card").first()).toBeVisible();

    const timings: Record<string, number> = {};
    // Family last, so it is a real switch too; Alt+digit as a keyboard user would.
    for (const mode of [...MODES.slice(1), "Family"] as Mode[]) {
      const n = MODES.indexOf(mode) + 1;
      const started = await page.evaluate(() => performance.now());
      await page.locator("body").press(`Alt+Digit${n}`);
      await expectMode(page, mode);
      // Two frames after the view's first item is visible: the switch has been painted.
      const ended = await page.evaluate(
        () =>
          new Promise<number>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))),
          ),
      );
      timings[mode] = Math.round(ended - started);
    }
    console.log(
      `[${info.project.name}] view switch at 1,000 people (ms): ${JSON.stringify(timings)}`,
    );
    info.annotations.push({ type: "switch-ms", description: JSON.stringify(timings) });
    for (const [mode, ms] of Object.entries(timings)) {
      expect(ms, `${mode} switch`).toBeLessThan(2500);
    }
    expect(errors).toEqual([]);
  });
});
