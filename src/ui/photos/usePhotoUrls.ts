import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/cloud/api";
import type { TreeDocument } from "@/core/model/types";
import { useRepo } from "@/ui/app/RepoContext";

import { fetchOwnerPhoto } from "./ownerPhotos";
import { CloudPhotoContext } from "./usePhotoUrl";

/**
 * Object URLs for every photo in the document, for the canvas, which draws many cards at once.
 * Returns a lookup: the URL of a loaded photo, else undefined (loading, or the blob is missing).
 * A photo's URL is created once and kept while any person still uses it. URLs of photos that
 * left the document are revoked, and so are all of them on unmount. The lookup changes identity
 * whenever the set of loaded URLs changes.
 */
export function usePhotoUrls(doc: TreeDocument | null): (photoId: string) => string | undefined {
  const repo = useRepo();
  const cloud = useContext(CloudPhotoContext);
  const urls = useRef(new Map<string, string>());
  /** Photos this device does not have: a cloud tree's come from the server. */
  const missing = useRef(new Set<string>());
  const [version, setVersion] = useState(0);

  const photoKey = doc
    ? [...new Set(Object.values(doc.persons).flatMap((p) => (p.photoId ? [p.photoId] : [])))]
        .toSorted()
        .join("\n")
    : "";

  useEffect(() => {
    const wanted = new Set(photoKey === "" ? [] : photoKey.split("\n"));
    let cancelled = false;
    let removed = false;
    for (const [photoId, url] of urls.current) {
      if (wanted.has(photoId)) continue;
      URL.revokeObjectURL(url);
      urls.current.delete(photoId);
      removed = true;
    }
    if (removed) setVersion((v) => v + 1);
    for (const photoId of wanted) {
      if (urls.current.has(photoId)) continue;
      repo
        .getPhoto(photoId)
        .then((blob) => {
          if (blob || cancelled) return blob;
          // Not on this device: the owner downloads it; a link user's <img> loads it by URL.
          if (cloud && !cloud.token) return fetchOwnerPhoto(repo, cloud.treeId, photoId);
          missing.current.add(photoId);
          setVersion((v) => v + 1);
          return undefined;
        })
        .then((blob) => {
          // A change of the photo set while loading cancels this run; the next run loads again.
          if (!blob || cancelled || urls.current.has(photoId)) return;
          urls.current.set(photoId, URL.createObjectURL(blob));
          setVersion((v) => v + 1);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [repo, photoKey, cloud]);

  // Unmount (and a strict-mode remount): release everything; the effect above loads again.
  useEffect(() => {
    const held = urls.current;
    return () => {
      for (const url of held.values()) URL.revokeObjectURL(url);
      held.clear();
    };
  }, []);

  // `version` is the signal that `urls` changed.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(
    (photoId: string) =>
      urls.current.get(photoId) ??
      (cloud?.token && missing.current.has(photoId)
        ? api.photoUrl(cloud.treeId, photoId, cloud.token)
        : undefined),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [version, cloud],
  );
}
