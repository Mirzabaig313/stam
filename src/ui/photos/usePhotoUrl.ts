import { createContext, useContext, useEffect, useState } from "react";

import { api } from "@/cloud/api";
import { useRepo } from "@/ui/app/RepoContext";

/**
 * Set by the editor for a cloud tree: photos not stored on this device (a tree opened by a link,
 * or on another device) are shown from the server instead.
 */
export const CloudPhotoContext = createContext<{ treeId: string; token?: string } | null>(null);

/**
 * An object URL for the stored photo, or undefined while it loads, when there is no photo, or
 * when the blob is missing. The URL is revoked when the photo changes or the component unmounts.
 */
export function usePhotoUrl(photoId: string | undefined): string | undefined {
  const repo = useRepo();
  const cloud = useContext(CloudPhotoContext);
  const [loaded, setLoaded] = useState<{ photoId: string; url: string } | null>(null);

  useEffect(() => {
    if (photoId === undefined) return;
    let cancelled = false;
    let url: string | undefined;
    repo
      .getPhoto(photoId)
      .then((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setLoaded({ photoId, url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url !== undefined) URL.revokeObjectURL(url);
      setLoaded(null);
    };
  }, [repo, photoId]);

  if (loaded !== null && loaded.photoId === photoId) return loaded.url;
  return photoId !== undefined && cloud
    ? api.photoUrl(cloud.treeId, photoId, cloud.token)
    : undefined;
}
