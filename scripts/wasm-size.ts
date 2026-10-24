// The Worker's compressed size against the free plan's 3 MB limit (spec §10): builds the release
// Worker with worker-build and gzips everything it uploads (the WASM and its JS glue).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = join(import.meta.dir, "..");
const crate = join(root, "server", "stam-worker");
const LIMIT = 3_000_000;
const WARN = 2_500_000;

const build = Bun.spawnSync(["worker-build", "--release"], {
  cwd: crate,
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) {
  console.error("worker-build failed");
  process.exit(1);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let raw = 0;
let gzipped = 0;
for (const file of files(join(crate, "build"))) {
  const bytes = readFileSync(file);
  raw += bytes.length;
  gzipped += gzipSync(bytes, { level: 9 }).length;
}
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`Worker: ${kb(raw)} raw, ${kb(gzipped)} gzip (free plan limit ${kb(LIMIT)})`);
if (gzipped > LIMIT) {
  console.error("Over the free plan's Worker size limit.");
  process.exit(1);
}
if (gzipped > WARN) console.warn("Close to the free plan's Worker size limit.");
