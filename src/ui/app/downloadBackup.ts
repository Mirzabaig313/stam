import type { TreeDocument } from "@/core/model/types";
import { backupFileName, exportStamJson } from "@/io/json/stamJson";
import type { TreeRepo } from "@/storage/treeRepo";

import { noteBackup } from "./backupState";

/** Saves a `.stam.json` copy of the tree through the browser, then records the backup (FR-X7). */
export async function downloadBackup(
  repo: TreeRepo,
  doc: TreeDocument,
  opts: { includePhotos: boolean },
  now: Date = new Date(),
): Promise<void> {
  const photos: Record<string, Blob> = {};
  if (opts.includePhotos) {
    for (const person of Object.values(doc.persons)) {
      if (!person.photoId || photos[person.photoId]) continue;
      const blob = await repo.getPhoto(person.photoId);
      if (blob) photos[person.photoId] = blob;
    }
  }
  const json = await exportStamJson(doc, photos, opts);

  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = backupFileName(doc, now);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  await noteBackup(repo, now);
}
