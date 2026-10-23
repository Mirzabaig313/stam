import { describe, expect, test } from "bun:test";

import { ImportError } from "@/io/json/errors";
import { parseTreeDocument } from "@/io/json/parseTree";

import { allFamilies, famSimple } from "../../fixtures/families";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return (error as ImportError).code;
  }
  throw new Error("expected a throw");
}

describe("parseTreeDocument", () => {
  test.each(allFamilies)("%s parses to an equal document", (_name, build) => {
    const doc = build();
    expect(parseTreeDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  test("a future version is FUTURE_VERSION", () => {
    expect(codeOf(() => parseTreeDocument({ ...famSimple(), schemaVersion: 2 }))).toBe(
      "FUTURE_VERSION",
    );
  });

  test("non-objects, bad versions and broken trees are INVALID_TREE", () => {
    expect(codeOf(() => parseTreeDocument(null))).toBe("INVALID_TREE");
    expect(codeOf(() => parseTreeDocument([]))).toBe("INVALID_TREE");
    expect(codeOf(() => parseTreeDocument({ ...famSimple(), schemaVersion: "1" }))).toBe(
      "INVALID_TREE",
    );
    expect(codeOf(() => parseTreeDocument({ ...famSimple(), schemaVersion: 0 }))).toBe(
      "INVALID_TREE",
    );
    expect(codeOf(() => parseTreeDocument({ ...famSimple(), persons: [] }))).toBe("INVALID_TREE");
    expect(codeOf(() => parseTreeDocument({ ...famSimple(), rootPersonId: "ghost" }))).toBe(
      "INVALID_TREE",
    );
  });

  test("a stored tree with people but no root gets one on load (M4)", () => {
    const { rootPersonId: _, ...rootless } = famSimple();
    expect(parseTreeDocument(rootless).rootPersonId).toBe("dad");
    const { rootPersonId: __, ...empty } = {
      ...famSimple(),
      persons: {},
      unions: {},
      unionOrder: {},
    };
    expect(parseTreeDocument(empty).rootPersonId).toBeUndefined();
  });

  test("runs an injected v0 to v1 migration before checking the shape", () => {
    const { name, ...rest } = famSimple();
    const legacy = { ...rest, title: name, schemaVersion: 0 };
    const migrations = {
      0: (tree: Record<string, unknown>) => {
        const { title, ...others } = tree;
        return { ...others, name: title };
      },
    };
    const doc = parseTreeDocument(legacy, { migrations });
    expect(doc).toEqual(famSimple());
    expect(doc.schemaVersion).toBe(1);
  });

  test("a version with no migration is INVALID_TREE", () => {
    expect(
      codeOf(() => parseTreeDocument({ ...famSimple(), schemaVersion: 0 }, { migrations: {} })),
    ).toBe("INVALID_TREE");
  });

  test("a migration that throws is INVALID_TREE", () => {
    const migrations = {
      0: () => {
        throw new Error("boom");
      },
    };
    expect(
      codeOf(() => parseTreeDocument({ ...famSimple(), schemaVersion: 0 }, { migrations })),
    ).toBe("INVALID_TREE");
  });

  test("the input is not mutated", () => {
    const raw = JSON.parse(JSON.stringify(famSimple()));
    raw.extra = 1;
    const before = JSON.stringify(raw);
    parseTreeDocument(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
