import { expect, type Page, test } from "@playwright/test";

/**
 * Largest Contentful Paint of a first visit to /app on a phone: Lighthouse's mobile profile
 * (Slow 4G: 150 ms RTT, 1.6 Mbps down; a CPU four times slower). Chromium only (CDP), on the
 * phone-sized project.
 */
async function phoneLcp(page: Page, path: string): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Your trees" })).toBeVisible();
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries.at(-1)!.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });
      }),
  );
}

test("/app paints its largest content within 2.5 s on a throttled phone", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "CDP throttling, measured once on the phone project");
  const lcp = await phoneLcp(page, "/app");
  console.log(`[${info.project.name}] /app phone LCP: ${Math.round(lcp)} ms`);
  info.annotations.push({ type: "lcp-ms", description: String(Math.round(lcp)) });
  expect(lcp).toBeLessThan(2500);
});
