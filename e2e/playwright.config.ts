import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

// Another lane's QA server may already hold 4400, so the port is overridable and an existing
// server is never reused (it could be serving a different build).
const PORT = Number(process.env.E2E_PORT ?? 4400);
const root = fileURLToPath(new URL("..", import.meta.url));

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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true },
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
