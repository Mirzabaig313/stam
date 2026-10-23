import { newId } from "@/core/model/ids";
import type { Person, TreeDocument } from "@/core/model/types";

/**
 * Makes an import safe to store next to existing data:
 * - an imported photo whose id is already stored gets a fresh id, so it never overwrites the
 *   existing photo, and the people who use it point at the new id;
 * - a person whose `photoId` is not among the imported photos loses it, so an import can never
 *   show a photo that belongs to another tree.
 * Returns the inputs unchanged when there is nothing to do; never mutates them.
 */
export async function remapPhotoIds(
  doc: TreeDocument,
  photos: Record<string, Blob>,
  exists: (photoId: string) => Promise<boolean>,
): Promise<{ doc: TreeDocument; photos: Record<string, Blob> }> {
  const renamed = new Map<string, string>();
  for (const photoId of Object.keys(photos)) {
    if (await exists(photoId)) renamed.set(photoId, newId());
  }

  let changed = false;
  const persons: Record<string, Person> = {};
  for (const [personId, person] of Object.entries(doc.persons)) {
    const { photoId } = person;
    if (photoId === undefined) {
      persons[personId] = person;
    } else if (!Object.hasOwn(photos, photoId)) {
      const { photoId: _dropped, ...rest } = person;
      persons[personId] = rest;
      changed = true;
    } else if (renamed.has(photoId)) {
      persons[personId] = { ...person, photoId: renamed.get(photoId)! };
      changed = true;
    } else {
      persons[personId] = person;
    }
  }

  if (!changed && renamed.size === 0) return { doc, photos };
  const remappedPhotos =
    renamed.size === 0
      ? photos
      : Object.fromEntries(
          Object.entries(photos).map(([photoId, blob]) => [renamed.get(photoId) ?? photoId, blob]),
        );
  return { doc: { ...doc, persons }, photos: remappedPhotos };
}
