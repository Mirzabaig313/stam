import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, type Page, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "test-results", "html-export");
// One file per worker, so parallel workers never read a file another is still writing.
let file = "";

test.beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  file = join(outDir, `family-${test.info().workerIndex}.html`);
  execFileSync("bun", [join(root, "e2e/fixtures/writeHtmlExport.ts"), file], { cwd: root });
});

/** Opens the exported file from disk, failing on any console error or any network request. */
async function openExport(page: Page): Promise<{ errors: string[]; requests: string[] }> {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) requests.push(r.url());
  });
  await page.goto(pathToFileURL(file).href);
  return { errors, requests };
}

const scale = (page: Page) =>
  page
    .locator("#world")
    .evaluate((el) => Number(/scale\(([\d.e-]+)\)/.exec(el.style.transform)?.[1]));

test("the exported file opens from disk, zooms and pans, with no errors or network", async ({
  page,
}) => {
  const { errors, requests } = await openExport(page);
  await expect(page.locator('[data-person-id="p-adam"]')).toBeVisible();
  const fitted = await scale(page);
  expect(fitted).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => scale(page)).toBeGreaterThan(fitted);

  const stage = page.locator("#stage");
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const beforeWheel = await scale(page);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scale(page)).toBeLessThan(beforeWheel);

  const before = await page.locator("#world").evaluate((el) => el.style.transform);
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 5 });
  await page.mouse.up();
  expect(await page.locator("#world").evaluate((el) => el.style.transform)).not.toBe(before);

  await page.getByRole("button", { name: "Fit to screen" }).click();
  await expect.poll(() => scale(page)).toBeCloseTo(fitted, 3);

  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("search highlights a person and a click opens their details", async ({ page }) => {
  const { errors } = await openExport(page);
  await page.getByRole("searchbox", { name: "Search by name" }).fill("hana");
  await expect(page.getByRole("status")).toHaveText("1 match");
  await expect(page.locator('[data-person-id="p-hana"]')).toHaveClass(/is-match/);
  // Escape puts the results list away (it covers the tree on a phone) and keeps the highlight.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("list", { name: "Matching people" })).toBeHidden();
  await expect(page.locator('[data-person-id="p-hana"]')).toHaveClass(/is-match/);

  // The match was centred, so it is on screen even on a phone.
  await page.locator('[data-person-id="p-hana"] text').click();
  const panel = page.getByRole("complementary");
  await expect(panel.getByRole("heading", { name: "Hana Hadžić" })).toBeFocused();
  await expect(panel).toContainText("هانا");
  await expect(panel).toContainText("b. 1935");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test("a hostile name stays text and the CSP leaves only the viewer's script running", async ({
  page,
}) => {
  const { errors } = await openExport(page);
  await page.locator('[data-person-id="p-evil"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#panel-name")).toHaveText("</script><img src=x onerror=alert(1)>");
  expect(await page.locator("#panel img, #panel b").count()).toBe(0);
  // An injected inline script would be refused by the hash-locked policy.
  const ran = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.stamInjected = true";
    document.body.append(s);
    return (window as unknown as { stamInjected?: boolean }).stamInjected === true;
  });
  expect(ran).toBe(false);
  expect(errors.filter((e) => !/Content Security Policy|Refused/i.test(e))).toEqual([]);
});
