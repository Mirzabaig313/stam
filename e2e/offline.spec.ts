import { expect, type Page, test } from "@playwright/test";

import { addChild, allCards, card, createTree, startWithPerson } from "./helpers";

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

test("after one visit /app works offline: the list, opening a tree and editing it", async ({
  page,
  context,
}) => {
  await createTree(page, "Offline family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await expect(page.locator(".save-status-saved")).toBeVisible();
  const treeUrl = page.url();
  await waitForOfflineReady(page);

  await context.setOffline(true);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Your trees" })).toBeVisible();
  await page.getByRole("link", { name: /Offline family/ }).click();
  await expect(card(page, "Ahmed Khan")).toBeVisible();

  await addChild(page, "Ahmed Khan", "Ali", "Male");
  await expect(allCards(page)).toHaveCount(2);
  await expect(page.locator(".save-status-saved")).toBeVisible();

  // A full reload of a deep link, still offline, comes back with the edit.
  await page.goto(treeUrl);
  await expect(card(page, "Ali Khan")).toBeVisible();
  await expect(allCards(page)).toHaveCount(2);
  await context.setOffline(false);
});

test("the service worker leaves the landing page alone", async ({ page, context }) => {
  await page.goto("/app");
  await waitForOfflineReady(page);
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration("/app"))?.scope,
  );
  expect(new URL(scope!).pathname).toBe("/app");
  await context.setOffline(true);
  // Outside the worker's scope, so offline it fails like any page.
  await expect(page.goto("/privacy")).rejects.toThrow();
  await context.setOffline(false);
});

test("sw.js is never cached by the browser", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toBe("no-cache");
});
