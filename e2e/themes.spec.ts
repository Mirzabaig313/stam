import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test, type TestInfo } from "@playwright/test";

import type { TreeDocument } from "@/core/model/types";

import { famCousinMarriage } from "../tests/fixtures/families";
import { allCards, card } from "./helpers";
import { EN } from "./strings";

// M4 lane T: the four themes and the card colour modes in the real editor (production build).
// THEME_SHOTS_DIR saves the screenshots somewhere to look at; otherwise they go with the results.

const THEMES = ["Light", "Dark", "Classic", "Print"] as const;

/** Three generations, two branches that meet in a cousin marriage, the grandparents deceased. */
function maliks(): TreeDocument {
  const doc = famCousinMarriage();
  const years: Record<string, number> = {
    g1: 1920,
    g2: 1925,
    p1: 1948,
    s1: 1950,
    p2: 1952,
    s2: 1949,
    cousin1: 1975,
    cousin2: 1978,
    kid: 2004,
  };
  for (const [id, year] of Object.entries(years)) doc.persons[id]!.birth = { date: { year } };
  for (const id of ["g1", "g2"]) {
    doc.persons[id]!.isLiving = false;
    doc.persons[id]!.death = { date: { year: 1999 } };
  }
  return { ...doc, id: "e2e-maliks", name: "Malik family" };
}

function stamFile(tree: TreeDocument) {
  const body = { format: "stam", schemaVersion: 1, exportedAt: new Date().toISOString(), tree };
  return {
    name: "tree.stam.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(body)),
  };
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.mouse.move(0, 700); // no tooltip left open under the pointer
  const dir = process.env.THEME_SHOTS_DIR ?? info.outputDir;
  await page.screenshot({ path: join(dir, `theme-${name}.png`) });
}

async function openTree(page: Page): Promise<void> {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(stamFile(maliks()));
  await expect(allCards(page)).toHaveCount(10); // one cousin also appears as a linked copy;
  await expect(card(page, "Jamil Malik")).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  return page.getByRole("dialog", { name: "Settings" });
}

/** Serious colour-contrast failures axe finds on the page as it is. */
async function contrastFailures(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`),
  );
}

test.describe("themes", () => {
  test.skip(
    ({ browserName, viewport }) => browserName !== "chromium" || (viewport?.width ?? 0) < 800,
    "screenshots and axe: desktop Chromium",
  );

  test("every theme on the editor, its views and the tree list, with AA contrast", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openTree(page);
    for (const theme of THEMES) {
      const dialog = await openSettings(page);
      await dialog.getByRole("radio", { name: theme, exact: true }).check();
      if (theme === "Dark") await shot(page, info, "dark-settings");
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(dialog).toBeHidden();
      const key = theme.toLowerCase();
      await expect(page.locator("html")).toHaveAttribute("data-theme", key);
      await card(page, "Imran Malik").first().click();
      await shot(page, info, key);
      expect(await contrastFailures(page), `${theme}: editor`).toEqual([]);

      for (const view of ["Fan", "Timeline"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        await shot(page, info, `${key}-${view.toLowerCase()}`);
        expect(await contrastFailures(page), `${theme}: ${view}`).toEqual([]);
      }
      await page.getByRole("button", { name: "Family", exact: true }).click();
      await page.keyboard.press("Escape");
    }
  });

  test("card colours by branch and by generation", async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openTree(page);
    const fill = (name: string) =>
      card(page, name)
        .first()
        .locator(".stam-card__bg")
        .evaluate((el) => getComputedStyle(el).fill);
    const plain = await fill("Tariq Malik");

    for (const [theme, mode] of [
      ["Light", "By branch"],
      ["Dark", "By branch"],
      ["Light", "By generation"],
      ["Dark", "By generation"],
    ] as const) {
      const dialog = await openSettings(page);
      await dialog.getByRole("radio", { name: theme, exact: true }).check();
      await dialog.getByRole("radio", { name: mode }).check();
      await dialog.getByRole("button", { name: "Done" }).click();
      await shot(
        page,
        info,
        `${theme.toLowerCase()}-${mode === "By branch" ? "branch" : "generation"}`,
      );
      expect(await contrastFailures(page), `${theme} ${mode}`).toEqual([]);
    }

    // Branch: Tariq's line (Tariq, his wife, his son) shares a hue that differs from Yasmin's.
    const dialog = await openSettings(page);
    await dialog.getByRole("radio", { name: "Light", exact: true }).check();
    await dialog.getByRole("radio", { name: "By branch" }).check();
    await dialog.getByRole("button", { name: "Done" }).click();
    const tariq = await fill("Tariq Malik");
    expect(tariq).not.toBe(plain);
    expect(await fill("Nazia Malik")).toBe(tariq);
    expect(await fill("Imran Malik")).toBe(tariq);
    expect(await fill("Yasmin Malik")).not.toBe(tariq);
  });

  test("the chosen theme is there on the first paint after a reload", async ({ page }) => {
    await openTree(page);
    const dialog = await openSettings(page);
    await dialog.getByRole("radio", { name: "Dark", exact: true }).check();
    await dialog.getByRole("button", { name: "Done" }).click();

    // The boot script sits at the top of <head>: by the time <body> exists, the theme is set.
    await page.goto("/app", { waitUntil: "commit" });
    await page.waitForFunction(() => document.body !== null);
    const early = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      ground: getComputedStyle(document.documentElement).getPropertyValue("--ground").trim(),
    }));
    expect(early.theme).toBe("dark");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 17, 15)");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0f110f");
  });

  test("the landing page follows the system, unless a theme was chosen", async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS("color", "rgb(17, 19, 17)");
    await shot(page, info, "landing-light");
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveCSS("background-color", "rgb(15, 17, 15)");
    await shot(page, info, "landing-dark");
    expect(await contrastFailures(page), "landing dark").toEqual([]);

    // A light choice in the app wins over a dark system.
    await page.evaluate(() =>
      localStorage.setItem("stam:settings", JSON.stringify({ theme: "light", themeChosen: true })),
    );
    await page.reload();
    await expect(page.locator("html")).toHaveCSS("background-color", "rgb(244, 245, 242)");
  });

  test("a dark system keeps the landing page dark after a visit to the app, until Light is chosen", async ({
    page,
  }) => {
    const DARK = "rgb(15, 17, 15)";
    const LIGHT = "rgb(244, 245, 242)";
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveCSS("background-color", DARK);

    // The app loads its (default) settings and caches them, but nobody chose a theme.
    await page.goto("/app");
    await expect(page.getByRole("button", { name: EN("treeList.newTree") })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("stam:settings")))
      .not.toBeNull();
    await page.goto("/");
    await expect(page.locator("html")).toHaveCSS("background-color", DARK);

    // Choosing Light in Settings, though it is already the app's theme, is a choice: the landing
    // page follows it.
    await page.goto("/app");
    await page.getByRole("button", { name: EN("settings.open") }).click();
    const dialog = page.getByRole("dialog", { name: EN("settings.title") });
    await dialog.getByRole("radio", { name: EN("settings.themes.light"), exact: true }).click();
    await dialog.getByRole("button", { name: EN("settings.done") }).click();
    await page.goto("/");
    await expect(page.locator("html")).toHaveCSS("background-color", LIGHT);
  });
});
