import type { TreeDocument } from "@/core/model/types";

import { TAB_ID } from "./multitab";
import { type SaveOptions, StaleWriteError, type TreeRepo } from "./treeRepo";

/**
 * One editor session's saves. Each is compare-and-swap against the `savedAt` the session last
 * loaded or saved, so a tab working on an old copy can never overwrite another tab's newer save
 * (or bring back a tree another tab deleted): the repo throws `StaleWriteError` instead.
 *
 * One exception: when the save in between only restored this tab's own journal entry (another
 * tab's tree list or editor recovered it while this tab was still editing), this tab's document
 * already holds everything that save wrote. The guard takes that save over and retries once.
 */
export type SaveGuard = {
  /** The tree was loaded at this version (`savedAt` from `getTree`). */
  loaded(savedAt: number | null): void;
  /** Saves `doc` on top of that version and returns the new `savedAt` (see `TreeRepo.saveTree`). */
  save(
    doc: TreeDocument,
    opts?: Pick<SaveOptions, "capturedAt" | "recoveredFrom">,
  ): Promise<number>;
};

export function createSaveGuard(repo: TreeRepo, { tabId = TAB_ID } = {}): SaveGuard {
  /** Undefined until a load: saves are unguarded until the session knows its version. */
  let savedAt: number | null | undefined;
  const saveOn = (doc: TreeDocument, opts: SaveOptions) =>
    repo.saveTree(doc, savedAt === undefined ? opts : { ...opts, ifSavedAt: savedAt });
  return {
    loaded(at) {
      savedAt = at;
    },
    async save(doc, opts = {}) {
      try {
        savedAt = await saveOn(doc, opts);
      } catch (error) {
        if (!(error instanceof StaleWriteError) || error.recoveredFrom !== tabId) throw error;
        savedAt = error.storedSavedAt;
        savedAt = await saveOn(doc, opts);
      }
      return savedAt;
    },
  };
}
