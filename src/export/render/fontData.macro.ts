import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Bun macro: runs at bundle time (and in `bun test`) and inlines an Archivo woff2 file from
 * `@fontsource-variable/archivo/files` as a base64 string, so exports embed the font with no fetch.
 */
export function archivoBase64(file: string): string {
  if (!/^archivo-[a-z-]+\.woff2$/.test(file)) throw new Error(`Not an Archivo font file: ${file}`);
  const url = import.meta.resolve(`@fontsource-variable/archivo/files/${file}`);
  return readFileSync(fileURLToPath(url)).toString("base64");
}
