// Urdu: the real Urdu interface, chosen in Settings, set in Nastaliq with its tall line height.
// Checks that fixed-height controls don't clip it, and that it still renders offline. Runs only in
// the "urdu" project. Set SHOTS_DIR to keep a screenshot of each screen.
import { expect, type Page, test } from "@playwright/test";

import { famSimple } from "../tests/fixtures/families";
import { allCards, card, centreOf, yearLineProblems } from "./helpers";
import { EN, tFor } from "./strings";

const t = tFor("ur");
const NASTALIQ = "Noto Nastaliq Urdu Variable";

/** Chooses Urdu in Settings from the tree list (opening it first unless `here`). */
async function useUrdu(page: Page, here = false): Promise<void> {
  if (!here) await page.goto("/app");
  await page.getByRole("button", { name: EN("settings.open") }).click();
  await page
    .getByRole("dialog", { name: EN("settings.title") })
    .getByRole("combobox", { name: EN("language.label") })
    .selectOption("ur");
  const dialog = page.getByRole("dialog", { name: t("settings.title") });
  await expect(dialog.getByText(t("language.inReview"))).toBeVisible();
  await shot(page, "settings");
  await dialog.getByRole("button", { name: t("settings.done") }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/ur-${name}.png` });
}

async function importFamily(page: Page): Promise<void> {
  const tree = { ...famSimple(), name: "خان خاندان", id: "e2e-ur-khan" };
  // One long deceased year line ("1920 – †1999") next to the short birth years.
  tree.persons.dad = {
    ...tree.persons.dad!,
    birth: { date: { year: 1920 } },
    death: { date: { year: 1999 } },
  };
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

/** Whether Nastaliq has been fetched and is drawing text on the page. */
function nastaliqLoaded(page: Page): Promise<boolean> {
  return page.evaluate(async (family) => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes(family) && f.status === "loaded");
  }, NASTALIQ);
}

/**
 * Controls too short for their text's line: Nastaliq's ink climbs and drops far past its em box
 * (a text range measures only that box), and Urdu's line height of 1.9 is what makes room for it.
 * So each control's inner height (less padding) must hold the line height of the text inside.
 */
function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    // Defined inside: page.evaluate runs it in the page, so it can't call out to this module.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const px = (v: string) => Number.parseFloat(v) || 0;
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    const controls = document.querySelectorAll(
      "button, .button, .icon-button, input, select, .field, .save-status, .chip",
    );
    for (const el of controls) {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2 || style.visibility === "hidden") continue;
      if (style.display === "inline" || el.closest("[aria-hidden='true'], .tip, svg")) continue;
      if (el instanceof HTMLInputElement && ["checkbox", "radio", "file"].includes(el.type)) {
        continue;
      }
      const room = el.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
      // The tallest line among the visible text inside (inputs and selects: their own).
      let line = 0;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        if (el instanceof HTMLInputElement && !el.value && !el.placeholder) continue;
        line = px(style.lineHeight) || px(style.fontSize) * 1.2;
      } else {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement!;
          if (!node.textContent?.trim() || parent.closest(".tip, .vh, [hidden], svg")) continue;
          // Only Arabic-script text draws in Nastaliq.
          if (!/[\u0600-\u06FF]/.test(node.textContent)) continue;
          const own = getComputedStyle(parent);
          line = Math.max(line, px(own.lineHeight) || px(own.fontSize) * 1.2);
        }
      }
      if (line > room + 1) bad.push(`${name(el)}: line ${line}px in ${room}px`);
    }
    return bad;
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 23, 12));
});

test("the interface switches to Urdu at once, in Nastaliq, with no reload", async ({ page }) => {
  await page.goto("/app");
  await page.evaluate(() => Object.assign(window, { stillHere: true }));
  await useUrdu(page, true);
  expect(await page.evaluate(() => "stillHere" in window)).toBe(true);
  await expect(page.getByRole("button", { name: t("treeList.newTree") })).toBeVisible();
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).toContain(NASTALIQ);
  expect(await nastaliqLoaded(page)).toBe(true);
  await shot(page, "tree-list");
});

test("Nastaliq's tall lines fit every fixed-height control", async ({ page }) => {
  await useUrdu(page);
  // The check itself: a 20px-high Urdu button is caught.
  await page.evaluate(() => {
    const probe = document.createElement("button");
    probe.className = "button probe";
    probe.style.cssText =
      "block-size:20px;min-block-size:0;overflow:hidden;position:fixed;inset-block-start:0";
    probe.textContent = "نیا شجرہ";
    document.body.append(probe);
  });
  expect((await clippedControls(page)).join()).toContain("button.probe");
  await page.evaluate(() => document.querySelector(".probe")?.remove());
  expect(await clippedControls(page)).toEqual([]);

  await page.getByRole("button", { name: t("treeList.newTree") }).click();
  expect(await clippedControls(page)).toEqual([]);
  await shot(page, "new-tree");
  await page.keyboard.press("Escape");

  await importFamily(page);
  expect(await clippedControls(page)).toEqual([]);
  await shot(page, "editor");

  await card(page, "Zainab Khan").click();
  await expect(page.getByRole("complementary", { name: t("panel.label") })).toBeVisible();
  expect(await clippedControls(page)).toEqual([]);
  await shot(page, "side-panel");

  await page.getByRole("button", { name: t("toolbar.menu") }).click();
  expect(await clippedControls(page)).toEqual([]);
  await shot(page, "menu");
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.getByRole("dialog", { name: t("export.title") })).toBeVisible();
  expect(await clippedControls(page)).toEqual([]);
  await shot(page, "export");
});

/** Waits until the service worker has precached the shell and controls the page. */
async function waitForOfflineReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
        once: true,
      }),
    );
  });
}

test("offline in Urdu: after one visit the strings and the Nastaliq font still load", async ({
  page,
  context,
}) => {
  await useUrdu(page);
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
  await expect(page.getByRole("button", { name: t("treeList.newTree") })).toBeVisible();
  expect(await nastaliqLoaded(page)).toBe(true);
  const failed = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "error").map((f) => f.family),
  );
  expect(failed).toEqual([]);
  await shot(page, "offline");
  await context.setOffline(false);
});

test("year lines stay inside their card and clear of the avatar", async ({ page }) => {
  await useUrdu(page);
  await importFamily(page);
  await expect(page.locator(".stam-card__years", { hasText: "1920 – †1999" })).toBeVisible();
  expect(await page.locator(".stam-canvas .stam-card__years").count()).toBe(4);
  expect(await yearLineProblems(page, ".stam-canvas")).toEqual([]);
});
