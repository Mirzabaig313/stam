import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/** The CSP exactly as `public/_headers` defines it, so the test fails if the server drifts. */
function headersFileCsp(): string {
  const text = readFileSync(fileURLToPath(new URL("../public/_headers", import.meta.url)), "utf8");
  const match = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(text);
  if (!match?.[1]) throw new Error("public/_headers has no Content-Security-Policy");
  return match[1].trim();
}

test("landing page is prerendered with its heading and a link to the app", async ({ page }) => {
  const response = await page.goto("/");
  const html = (await response?.text()) ?? "";
  expect(html).toContain("Every family");
  await expect(
    page.getByRole("heading", { level: 1, name: /every family fits on rows/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /start your tree/i }).first()).toHaveAttribute(
    "href",
    "/app",
  );
});

test("/privacy is served and unknown paths get the 404 page with status 404", async ({ page }) => {
  expect((await page.goto("/privacy"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  expect((await page.goto("/no-such-page"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: /no record/i })).toBeVisible();
});

test("landing page logs no console errors and loads nothing from other origins", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) foreign.push(request.url());
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

for (const path of ["/app", "/app/t/anything"]) {
  test(`${path} serves the app shell with status 200`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("#root")).toBeAttached();
  });
}

test("/app response carries the Content-Security-Policy from _headers", async ({ page }) => {
  const response = await page.goto("/app");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toBe(headersFileCsp());
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
});

test("/app logs no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
