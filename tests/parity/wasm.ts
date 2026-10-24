import { existsSync } from "node:fs";
import { join } from "node:path";

/** The Rust rules (`server/stam-core`, feature `wasm`), JSON strings in and out. */
export type CoreWasm = {
  apply_command_json(doc: string, cmd: string, now: string, opId: string): string;
  apply_revert_json(doc: string, entries: string, direction: string, now: string): string;
  parse_tree_json(text: string): string;
  validate_json(doc: string): string;
  apply_privacy_json(doc: string): string;
};

const root = join(import.meta.dir, "..", "..");

/** Loads a `wasm-pack --target nodejs` build from `.wasm/<name>`. */
export function loadWasm<T>(name: string): T {
  const entry = join(root, ".wasm", name, `${name.replace("-", "_")}.js`);
  if (!existsSync(entry)) throw new Error(`${entry} is missing: run \`bun run wasm\` first`);
  return require(entry) as T;
}

export const loadCore = () => loadWasm<CoreWasm>("stam-core");
