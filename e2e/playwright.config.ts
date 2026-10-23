import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

// Another lane's QA server may already hold 4400, so the port is overridable and an existing
// server is never reused (it could be serving a different build).
const PORT = Number(process.env.E2E_PORT ?? 4400);
const root = fileURLToPath(new URL("..", import.meta.url));

/** Specs that run only in their own language project. */
const LANGUAGE_SPECS = ["rtl.spec.ts", "urdu.spec.ts"];

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: LANGUAGE_SPECS, use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", testIgnore: LANGUAGE_SPECS, use: { ...devices["Desktop Safari"] } },
    // Firefox is opt-in (E2E_FIREFOX=1): Playwright's Firefox build does not start on every
    // machine (on macOS 27 it exits with "Could not find profile folder").
    ...(process.env.E2E_FIREFOX === "1"
      ? [{ name: "firefox", testIgnore: LANGUAGE_SPECS, use: { ...devices["Desktop Firefox"] } }]
      : []),
    {
      name: "mobile",
      testIgnore: LANGUAGE_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    // Right to left: an Arabic locale; rtl.spec.ts puts the page in Arabic RTL (see its notes).
    // Urdu: the real Urdu interface in Nastaliq (urdu.spec.ts), Pakistani locale.
    {
      name: "urdu",
      testMatch: "urdu.spec.ts",
      use: { ...devices["Desktop Chrome"], locale: "ur-PK", timezoneId: "Asia/Karachi" },
    },
    {
      name: "rtl",
      testMatch: "rtl.spec.ts",
      use: { ...devices["Desktop Chrome"], locale: "ar", timezoneId: "Asia/Karachi" },
    },
  ],
  webServer: {
    command: "bun run build && bun run scripts/serve-dist.ts",
    cwd: root,
    env: { PORT: String(PORT) },
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
