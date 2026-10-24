// Runs tests/worker against a fresh local Worker: builds the site if needed, applies the D1
// migrations to an empty local state, starts `wrangler dev` (port 8788, never the owner's 3333),
// waits until it answers, runs the tests, then stops it.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { GOOGLE_MOCK_PORT, startGoogleMock } from "./google-mock";

const root = join(import.meta.dir, "..");
const PORT = Number(process.env.WORKER_TEST_PORT ?? 8788);
const origin = `http://localhost:${PORT}`;
const state = join(root, ".wrangler", "test-state");

/** Test-only values; the real ones are Worker secrets (docs/deploy.md). */
const VARS: Record<string, string> = {
  ENVIRONMENT: "dev",
  SITE_ORIGIN: origin,
  SESSION_SECRET: "test-session-secret-test-session-secret",
  LINK_KEY: "c3RhbS10ZXN0LWxpbmsta2V5LTMyLWJ5dGVzLWxvbmc=",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  GOOGLE_AUTH_URL: `http://localhost:${GOOGLE_MOCK_PORT}/auth`,
  GOOGLE_TOKEN_URL: `http://localhost:${GOOGLE_MOCK_PORT}/token`,
  GOOGLE_USERINFO_URL: `http://localhost:${GOOGLE_MOCK_PORT}/userinfo`,
  ...JSON.parse(process.env.WORKER_TEST_VARS ?? "{}"),
};

function run(cmd: string[]): void {
  const r = Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed`);
}

if (!existsSync(join(root, "dist", "app.html"))) run(["bun", "run", "build"]);
rmSync(state, { recursive: true, force: true });
run(["bunx", "wrangler", "d1", "migrations", "apply", "stam", "--local", "--persist-to", state]);

const google = startGoogleMock();
const varArgs = Object.entries(VARS).flatMap(([k, v]) => ["--var", `${k}:${v}`]);
const worker = Bun.spawn(
  ["bunx", "wrangler", "dev", "--port", String(PORT), "--persist-to", state, ...varArgs],
  { cwd: root, stdout: process.env.WORKER_LOGS === "1" ? "inherit" : "pipe", stderr: "inherit" },
);

let code = 1;
try {
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("wrangler dev did not start");
    try {
      if ((await fetch(`${origin}/api/health`)).ok) break;
    } catch {
      // not up yet
    }
    await Bun.sleep(500);
  }
  const tests = Bun.spawn(["bun", "test", ...process.argv.slice(2), "tests/worker"], {
    cwd: root,
    env: {
      ...process.env,
      WORKER_URL: origin,
      WORKER_STATE: state,
      GOOGLE_MOCK_URL: `http://localhost:${GOOGLE_MOCK_PORT}`,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  code = await tests.exited;
} finally {
  worker.kill();
  await worker.exited;
  void google.stop(true);
}
process.exit(code);
