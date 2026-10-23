import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Bun macros: run at bundle time (and in `bun test`) and inline a woff2 file from an
 * `@fontsource-variable` package as a base64 string, so exports embed the font with no fetch.
 */
export function archivoBase64(file: string): string {
  if (!/^archivo-[a-z-]+\.woff2$/.test(file)) throw new Error(`Not an Archivo font file: ${file}`);
  const url = import.meta.resolve(`@fontsource-variable/archivo/files/${file}`);
  return readFileSync(fileURLToPath(url)).toString("base64");
}

const NOTO = /^noto-(naskh-arabic|nastaliq-urdu)-arabic-wght-normal\.woff2$/;

/** Bun macro: the Arabic subset of Noto Naskh Arabic or Noto Nastaliq Urdu, as base64. */
export function notoBase64(file: string): string {
  const match = NOTO.exec(file);
  if (!match) throw new Error(`Not a Noto Arabic-script font file: ${file}`);
  const url = import.meta.resolve(`@fontsource-variable/noto-${match[1]}/files/${file}`);
  return readFileSync(fileURLToPath(url)).toString("base64");
}
