import { type CDPSession, expect, type Page, test } from "@playwright/test";

import { addChild, card, centreOf, createTree, startWithPerson } from "./helpers";

// Real touch input through the DevTools protocol: Chromium only, on the phone-sized project.
test.beforeEach(({ browserName }, info) => {
  test.skip(browserName !== "chromium" || info.project.name !== "mobile", "CDP touch, phone only");
});

type Finger = { x: number; y: number; id: number };

/** The canvas camera, from the world group's transform. */
async function camera(page: Page): Promise<{ x: number; y: number; k: number }> {
  const transform = await page.locator(".stam-canvas__svg > g").getAttribute("transform");
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(transform ?? "");
  if (!m) throw new Error(`no camera transform: ${transform}`);
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
}

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  touchPoints: Finger[],
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
}

async function familyOnPhone(page: Page): Promise<CDPSession> {
  await createTree(page, "Touch family");
  await startWithPerson(page, "Ahmed Khan", "Male");
  await addChild(page, "Ahmed Khan", "Ali", "Male");
  // Bigger cards, so two fingers fit on one.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  await centreOf(card(page, "Ahmed Khan"));
  return page.context().newCDPSession(page);
}

test("two fingers that both land on a card pinch-zoom, and the card is not picked up (I3)", async ({
  page,
}) => {
  const cdp = await familyOnPhone(page);
  const { x, y } = await centreOf(card(page, "Ahmed Khan"));
  const before = await camera(page);
  const fingers = (d: number): Finger[] => [
    { x: x - 10 - d, y, id: 1 },
    { x: x + 10 + d, y, id: 2 },
  ];
  await touch(cdp, "touchStart", fingers(0));
  for (let d = 4; d <= 60; d += 4) await touch(cdp, "touchMove", fingers(d));
  // Held past the long-press time: still a pinch, never a picked-up card.
  await page.waitForTimeout(450);
  await expect(page.locator(".dnd-ghost")).toHaveCount(0);
  await touch(cdp, "touchEnd", []);

  expect((await camera(page)).k).toBeGreaterThan(before.k * 1.5);
  await expect(page.locator(".dnd-ghost")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a one-finger drag that starts on a card pans the canvas (I3)", async ({ page }) => {
  const cdp = await familyOnPhone(page);
  const { x, y } = await centreOf(card(page, "Ahmed Khan"));
  const before = await camera(page);
  await touch(cdp, "touchStart", [{ x, y, id: 1 }]);
  // Well inside the 350 ms long-press.
  for (let d = 10; d <= 80; d += 10) await touch(cdp, "touchMove", [{ x: x + d, y: y + d, id: 1 }]);
  await touch(cdp, "touchEnd", []);

  const after = await camera(page);
  expect(after.x - before.x).toBeGreaterThan(60);
  expect(after.y - before.y).toBeGreaterThan(60);
  expect(after.k).toBe(before.k);
  await expect(page.locator(".dnd-ghost")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a long-press on a card still picks it up instead of panning", async ({ page }) => {
  const cdp = await familyOnPhone(page);
  const { x, y } = await centreOf(card(page, "Ali Khan"));
  const before = await camera(page);
  await touch(cdp, "touchStart", [{ x, y, id: 1 }]);
  await page.waitForTimeout(500);
  for (let d = 10; d <= 60; d += 10) await touch(cdp, "touchMove", [{ x: x + d, y, id: 1 }]);
  await expect(page.locator(".dnd-ghost")).toHaveCount(1);
  const during = await camera(page);
  await touch(cdp, "touchEnd", []);
  expect(during).toEqual(before);
});
