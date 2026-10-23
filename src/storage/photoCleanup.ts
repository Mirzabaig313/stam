import { browserStorage, pendingDocs } from "./journal";
import { photoIdsOf, type TreeRepo } from "./treeRepo";

/**
 * Deletes the stored photos that nothing uses any more: no tree, no snapshot, and no unsaved edit
 * in the journal (a photo is stored before the edit that points at it is saved). Runs after a
 * tree is deleted and after an import. Returns how many photos were deleted.
 */
export async function cleanUpUnusedPhotos(
  repo: Pick<TreeRepo, "deleteUnusedPhotos">,
  storage = browserStorage(),
): Promise<number> {
  const keep = pendingDocs(storage).flatMap((doc) => photoIdsOf(doc));
  return repo.deleteUnusedPhotos(keep);
}
