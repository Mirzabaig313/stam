import { type Api, api as defaultApi } from "@/cloud/api";
import type { TreeRepo } from "@/storage/treeRepo";

/** Downloads running now, so the canvas and a panel asking at once fetch a photo once. */
const downloading = new Map<string, Promise<Blob | undefined>>();

/**
 * A photo of the owner's cloud tree that this device does not have (added on another device):
 * downloaded with the owner's token and kept on the device, where it then loads like any other.
 * Undefined when it cannot be had (offline, or not on the server).
 */
export function fetchOwnerPhoto(
  repo: TreeRepo,
  treeId: string,
  photoId: string,
  api: Api = defaultApi,
): Promise<Blob | undefined> {
  let pending = downloading.get(photoId);
  if (!pending) {
    pending = api
      .downloadPhoto(treeId, photoId)
      .then(async (blob) => {
        await repo.putPhoto(photoId, blob).catch(() => {});
        return blob;
      })
      .catch(() => undefined)
      .finally(() => downloading.delete(photoId));
    downloading.set(photoId, pending);
  }
  return pending;
}
