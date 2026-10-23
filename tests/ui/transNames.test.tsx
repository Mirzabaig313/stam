import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { cleanup, screen } from "@testing-library/react";

import { DeleteDialog } from "@/ui/panels/DeleteDialog";

import { docOf, person, union } from "../fixtures/families";
import { renderWithStore } from "../fixtures/panelEnv";

afterEach(cleanup);

/** A name that looks like markup and interpolation to i18next's <Trans>. */
const EVIL_FIRST = "Ali <i>x</i>";
const EVIL_LAST = "Khan {{count}} <0>y</0>";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

/** Every string in a nested translation object, with its key. */
function strings(value: unknown, key = ""): [string, string][] {
  if (typeof value === "string") return [[key, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    strings(v, key ? `${key}.${k}` : k),
  );
}

describe("names in <Trans> sentences (M1)", () => {
  test("no <Trans> interpolates values: names go in as component children", () => {
    for (const file of sourceFiles("src")) {
      const source = readFileSync(file, "utf8");
      for (const [, block] of source.matchAll(/<Trans\b([^>]*?)\/>/gs)) {
        expect({ file, values: /\bvalues=/.test(block!) }).toEqual({ file, values: false });
      }
    }
  });

  test("translations hold a name slot as an empty tag, never {{name}}", () => {
    const en = JSON.parse(readFileSync("src/i18n/locales/en.json", "utf8")) as unknown;
    for (const [key, text] of strings(en)) {
      if (/<(name|target)\b/.test(text)) {
        expect({ key, text: /\{\{(name|target)\}\}/.test(text) }).toEqual({ key, text: false });
      }
    }
  });

  test("a name that looks like markup is shown exactly as typed", async () => {
    const doc = docOf(
      [
        person("dad", EVIL_FIRST, EVIL_LAST, "male"),
        person("mom", "Sara", "Khan", "female"),
        person("c1", "Omar", "Khan", "male"),
      ],
      [union("u1", ["dad", "mom"], ["c1"])],
      "dad",
    );
    await renderWithStore(<DeleteDialog personId="dad" onClose={() => {}} />, doc);
    const full = `${EVIL_FIRST} ${EVIL_LAST}`;
    expect(screen.getByRole("heading").textContent).toBe(`Delete ${full}?`);
    expect(screen.getByRole("button", { name: `Delete ${full} only` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Delete ${full} and 1 descendant` })).toBeTruthy();
    expect(screen.getByRole("heading").querySelector("bdi")?.textContent).toBe(full);
  });
});
