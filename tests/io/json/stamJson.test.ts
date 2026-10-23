import { describe, expect, test } from "bun:test";

import type { TreeDocument } from "@/core/model/types";
import { backupFileName, exportStamJson, ImportError, importStamJson } from "@/io/json/stamJson";

import { allFamilies, famSimple } from "../../fixtures/families";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);

function pngBlob(): Blob {
  return new Blob([PNG_BYTES], { type: "image/png" });
}

/** Gives the first person a photo so the photo path is exercised. */
function withPhoto(doc: TreeDocument): TreeDocument {
  const [firstId] = Object.keys(doc.persons);
  const first = doc.persons[firstId!]!;
  return { ...doc, persons: { ...doc.persons, [first.id]: { ...first, photoId: "photo-1" } } };
}

function sameExceptIdentity(actual: TreeDocument, expected: TreeDocument) {
  expect({ ...actual, id: "x", createdAt: "x", updatedAt: "x" }).toEqual({
    ...expected,
    id: "x",
    createdAt: "x",
    updatedAt: "x",
  });
}

async function importError(text: string): Promise<ImportError> {
  try {
    await importStamJson(text);
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return error as ImportError;
  }
  throw new Error("expected importStamJson to reject");
}

function envelope(overrides: Record<string, unknown> = {}, tree: unknown = famSimple()): string {
  return JSON.stringify({
    format: "stam",
    schemaVersion: 1,
    exportedAt: "2026-10-23T00:00:00.000Z",
    tree,
    ...overrides,
  });
}

type Loose = Record<string, any>;

function bad(mutate: (tree: Loose) => void): string {
  const tree = JSON.parse(JSON.stringify(famSimple()));
  mutate(tree);
  return envelope({}, tree);
}

const firstPerson = (tree: Loose) => Object.values<any>(tree.persons)[0];
const firstUnion = (tree: Loose) => Object.values<any>(tree.unions)[0];

describe("exportStamJson / importStamJson", () => {
  test.each(allFamilies)("%s round-trips without photos", async (_name, build) => {
    const doc = build();
    const text = await exportStamJson(doc, {}, { includePhotos: false });
    expect(JSON.parse(text).photos).toBeUndefined();
    const result = await importStamJson(text);
    sameExceptIdentity(result.doc, doc);
    expect(result.photos).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  test.each(allFamilies)("%s round-trips with photos", async (_name, build) => {
    const doc = withPhoto(build());
    const text = await exportStamJson(doc, { "photo-1": pngBlob() }, { includePhotos: true });
    const result = await importStamJson(text);
    sameExceptIdentity(result.doc, doc);
    expect(Object.keys(result.photos)).toEqual(["photo-1"]);
    const photo = result.photos["photo-1"]!;
    expect(photo.type).toBe("image/png");
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PNG_BYTES);
    expect(result.warnings).toEqual([]);
  });

  test("includePhotos false leaves photos out even when given", async () => {
    const text = await exportStamJson(
      withPhoto(famSimple()),
      { "photo-1": pngBlob() },
      { includePhotos: false },
    );
    expect(JSON.parse(text).photos).toBeUndefined();
  });

  test("the file has the documented envelope", async () => {
    const doc = famSimple();
    const parsed = JSON.parse(await exportStamJson(doc, {}, { includePhotos: false }));
    expect(parsed.format).toBe("stam");
    expect(parsed.schemaVersion).toBe(1);
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
    expect(parsed.tree).toEqual(doc);
  });

  test("import assigns a new tree id, fresh createdAt and updatedAt, keeps person and union ids", async () => {
    const doc = famSimple();
    const { doc: imported } = await importStamJson(
      await exportStamJson(doc, {}, { includePhotos: false }),
    );
    expect(imported.id).not.toBe(doc.id);
    expect(imported.id.length).toBeGreaterThan(0);
    expect(imported.createdAt).not.toBe(doc.createdAt);
    expect(Number.isNaN(Date.parse(imported.createdAt))).toBe(false);
    expect(Object.keys(imported.persons)).toEqual(Object.keys(doc.persons));
    expect(Object.keys(imported.unions)).toEqual(Object.keys(doc.unions));
    // Imported now: it lists as just edited, and the backup reminder counts it (M5).
    expect(imported.updatedAt).toBe(imported.createdAt);
    expect(imported.updatedAt > doc.updatedAt).toBe(true);
  });

  test("a tree with people but no root gets one: the topmost ancestor of the first person (M4)", async () => {
    const { rootPersonId: _, ...rootless } = famSimple();
    // c1 is listed first; his topmost ancestor is his father.
    const persons = Object.fromEntries(
      ["c1", "dad", "mom", "c2", "c3"].map((id) => [id, famSimple().persons[id]!]),
    );
    const { doc } = await importStamJson(envelope({}, { ...rootless, persons }));
    expect(doc.rootPersonId).toBe("dad");
  });

  test("rejects future schemaVersion and malformed JSON", async () => {
    expect((await importError(envelope({ schemaVersion: 2 }))).code).toBe("FUTURE_VERSION");
    expect((await importError("{not json")).code).toBe("NOT_JSON");
    expect((await importError("")).code).toBe("NOT_JSON");
    expect((await importError("[1,2]")).code).toBe("NOT_STAM");
    expect((await importError("42")).code).toBe("NOT_STAM");
    expect((await importError(envelope({ format: "gedcom" }))).code).toBe("NOT_STAM");
    expect((await importError(envelope({ schemaVersion: "1" }))).code).toBe("NOT_STAM");
    expect((await importError(envelope({ schemaVersion: 0 }))).code).toBe("NOT_STAM");
    expect((await importError(envelope({ tree: undefined }))).code).toBe("NOT_STAM");

    const dangling = famSimple();
    const [unionId] = Object.keys(dangling.unions);
    const u = dangling.unions[unionId!]!;
    dangling.unions[unionId!] = {
      ...u,
      children: [...u.children, { personId: "ghost", type: "biological" }],
    };
    const error = await importError(envelope({}, dangling));
    expect(error.code).toBe("INVALID_TREE");
    expect(error.message).toContain("ghost");
  });

  test("rejects trees with wrong field types", async () => {
    const cases = [
      bad((t) => (t.name = 5)),
      bad((t) => (t.schemaVersion = 2)),
      bad((t) => (t.persons = [])),
      bad((t) => (firstPerson(t).gender = "other")),
      bad((t) => (firstPerson(t).isLiving = "yes")),
      bad((t) => (firstPerson(t).firstName = undefined)),
      bad((t) => (firstPerson(t).birth = { date: { year: "1900" } })),
      bad((t) => (firstUnion(t).partners = "a")),
      bad((t) => (firstUnion(t).partners = ["a", "b", "c"])),
      bad((t) => (firstUnion(t).status = "dating")),
      bad((t) => (firstUnion(t).children = [{ personId: "x", type: "natural" }])),
      bad((t) => (t.unionOrder = { a: "b" })),
      bad((t) => (t.settings = { theme: 1 })),
      bad((t) => (t.rootPersonId = 7)),
      bad((t) => (t.updatedAt = 7)),
    ];
    for (const text of cases) expect((await importError(text)).code).toBe("INVALID_TREE");
  });

  test("a javascript: photo URL is dropped with one warning", async () => {
    const result = await importStamJson(
      envelope({
        photos: {
          good: "data:image/png;base64,AAEC",
          evil: "javascript:alert(1)",
        },
      }),
    );
    expect(Object.keys(result.photos)).toEqual(["good"]);
    expect(result.warnings).toEqual([{ code: "PHOTO_DROPPED", photoId: "evil" }]);
  });

  test("photos with a wrong type, SVG data or broken base64 are dropped", async () => {
    const result = await importStamJson(
      envelope({
        photos: {
          svg: "data:image/svg+xml;base64,AAEC",
          gif: "data:image/gif;base64,AAEC",
          notString: 5,
          broken: "data:image/png;base64,@@@@",
          webp: "data:image/webp;base64,AAEC",
          jpeg: "data:image/jpeg;base64,AAEC",
        },
      }),
    );
    expect(Object.keys(result.photos).toSorted()).toEqual(["jpeg", "webp"]);
    expect(result.warnings.map((w) => w.photoId).toSorted()).toEqual([
      "broken",
      "gif",
      "notString",
      "svg",
    ]);
  });

  test("rejects input over 50 MB with TOO_LARGE", async () => {
    const error = await importError(" ".repeat(50 * 1024 * 1024 + 1));
    expect(error.code).toBe("TOO_LARGE");
  });

  test("a photos field that is not an object is a NOT_STAM error", async () => {
    expect((await importError(envelope({ photos: [] }))).code).toBe("NOT_STAM");
  });
});

const withOrder = (personId: string, order: string[]) =>
  bad((t) => (t.unionOrder = { ...t.unionOrder, [personId]: order }));

describe("hostile ids and unknown fields", () => {
  test("a unionOrder entry naming a built-in property is INVALID_TREE, not a crash", async () => {
    const firstId = Object.keys(famSimple().persons)[0]!;
    expect((await importError(withOrder(firstId, ["toString"]))).code).toBe("INVALID_TREE");
    expect((await importError(withOrder(firstId, ["__proto__"]))).code).toBe("INVALID_TREE");
  });

  test.each(["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"])(
    "a person with id %s is INVALID_TREE",
    async (id) => {
      const doc = famSimple();
      const someone = Object.values(doc.persons)[0]!;
      const tree = { ...doc, persons: { ...doc.persons, [id]: { ...someone, id } } };
      expect((await importError(envelope({}, tree))).code).toBe("INVALID_TREE");
    },
  );

  test("ids must be short and made of letters, digits, _ and -", async () => {
    for (const id of ["", "a b", "a/b", "x".repeat(65), "é"]) {
      const doc = famSimple();
      const someone = Object.values(doc.persons)[0]!;
      const tree = { ...doc, persons: { ...doc.persons, [id]: { ...someone, id } } };
      expect((await importError(envelope({}, tree))).code).toBe("INVALID_TREE");
    }
  });

  test("a photoId or rootPersonId that is a built-in property name is INVALID_TREE", async () => {
    expect((await importError(bad((t) => (firstPerson(t).photoId = "toString")))).code).toBe(
      "INVALID_TREE",
    );
    expect((await importError(bad((t) => (t.rootPersonId = "constructor")))).code).toBe(
      "INVALID_TREE",
    );
  });

  test("a photo id of __proto__ is dropped and does not touch the prototype", async () => {
    const result = await importStamJson(
      envelope({
        photos: { ["__proto__"]: "data:image/png;base64,AAEC", good: "data:image/png;base64,AAEC" },
      }),
    );
    expect(Object.keys(result.photos)).toEqual(["good"]);
    expect(Object.getPrototypeOf(result.photos)).toBe(Object.prototype);
    expect(result.warnings).toEqual([{ code: "PHOTO_DROPPED", photoId: "__proto__" }]);
  });

  test("unknown fields are dropped from the tree, people, unions and settings", async () => {
    const doc = famSimple();
    const text = bad((t) => {
      t.sneaky = 1;
      firstPerson(t).sneaky = 2;
      firstPerson(t).birth = { date: { year: 1900, sneaky: 5 }, place: "X", sneaky: 6 };
      firstUnion(t).sneaky = 3;
      firstUnion(t).children[0].sneaky = 4;
      t.settings.sneaky = 5;
    });
    const { doc: imported } = await importStamJson(text);
    expect(JSON.stringify(imported)).not.toContain("sneaky");
    expect(Object.values(imported.persons)[0]!.birth).toEqual({ date: { year: 1900 }, place: "X" });
    expect(Object.keys(imported.persons)).toEqual(Object.keys(doc.persons));
  });
});

describe("backupFileName", () => {
  test("slugs the tree name and appends the date", () => {
    const doc = { ...famSimple(), name: "Khan Family" };
    expect(backupFileName(doc, new Date(2026, 9, 23, 12))).toBe("khan-family-2026-10-23.stam.json");
  });

  test("falls back to 'family' when the name has no usable characters", () => {
    const doc = { ...famSimple(), name: "  !!!  " };
    expect(backupFileName(doc, new Date(2026, 0, 5))).toBe("family-2026-01-05.stam.json");
  });

  test("keeps letters from other scripts", () => {
    const doc = { ...famSimple(), name: "خاندان / Khan" };
    expect(backupFileName(doc, new Date(2026, 0, 5))).toBe("خاندان-khan-2026-01-05.stam.json");
  });
});
