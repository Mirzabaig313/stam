import { describe, expect, test } from "bun:test";

import type { TreeDocument } from "@/core/model/types";
import { remapPhotoIds } from "@/io/json/remapPhotos";

import { famSimple } from "../../fixtures/families";

const blob = (tag: string) => new Blob([tag], { type: "image/png" });

function withPhotos(photoIds: Record<string, string>): TreeDocument {
  const doc = famSimple();
  const persons = { ...doc.persons };
  for (const [personId, photoId] of Object.entries(photoIds)) {
    persons[personId] = { ...persons[personId]!, photoId };
  }
  return { ...doc, persons };
}

const ids = () => Object.keys(famSimple().persons);

describe("remapPhotoIds", () => {
  test("renames only colliding photo ids and updates every reference", async () => {
    const [a, b, c] = ids();
    const doc = withPhotos({ [a!]: "taken", [b!]: "taken", [c!]: "free" });
    const photos = { taken: blob("t"), free: blob("f") };

    const result = await remapPhotoIds(doc, photos, async (id) => id === "taken");

    const newId = result.doc.persons[a!]!.photoId!;
    expect(newId).not.toBe("taken");
    expect(result.doc.persons[b!]!.photoId).toBe(newId);
    expect(result.doc.persons[c!]!.photoId).toBe("free");
    expect(Object.keys(result.photos).toSorted()).toEqual(["free", newId].toSorted());
    expect(result.photos[newId]).toBe(photos.taken);
    expect(result.photos.free).toBe(photos.free);
  });

  test("returns the same objects when nothing collides, and never mutates its input", async () => {
    const [a] = ids();
    const doc = withPhotos({ [a!]: "p1" });
    const photos = { p1: blob("x") };
    const result = await remapPhotoIds(doc, photos, async () => false);
    expect(result.doc).toBe(doc);
    expect(result.photos).toBe(photos);

    await remapPhotoIds(doc, photos, async () => true);
    expect(doc.persons[a!]!.photoId).toBe("p1");
    expect(Object.keys(photos)).toEqual(["p1"]);
  });

  test("new ids are valid ids and do not clash with each other or existing photos", async () => {
    const [a, b] = ids();
    const doc = withPhotos({ [a!]: "x", [b!]: "y" });
    const result = await remapPhotoIds(doc, { x: blob("x"), y: blob("y") }, async () => true);
    const [first, second] = Object.keys(result.photos);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  test("clears a photo id that has no imported photo, and keeps the ones that do", async () => {
    const [a, b, c] = ids();
    const doc = withPhotos({ [a!]: "elsewhere", [b!]: "mine" });
    const photos = { mine: blob("m") };

    const result = await remapPhotoIds(doc, photos, async () => false);

    expect(result.doc.persons[a!]!.photoId).toBeUndefined();
    expect("photoId" in result.doc.persons[a!]!).toBe(false);
    expect(result.doc.persons[b!]!.photoId).toBe("mine");
    expect(result.doc.persons[c!]).toBe(doc.persons[c!]);
    expect(result.photos).toBe(photos);
    expect(doc.persons[a!]!.photoId).toBe("elsewhere");
  });

  test("a missing photo is cleared even when it exists locally", async () => {
    const [a] = ids();
    const doc = withPhotos({ [a!]: "local-only" });
    const result = await remapPhotoIds(doc, {}, async () => true);
    expect(result.doc.persons[a!]!.photoId).toBeUndefined();
  });
});
