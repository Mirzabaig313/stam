import { useEffect, useState } from "react";

import { useRepo } from "@/ui/app/RepoContext";

/**
 * An object URL for the stored photo, or undefined while it loads, when there is no photo, or
 * when the blob is missing. The URL is revoked when the photo changes or the component unmounts.
 */
export function usePhotoUrl(photoId: string | undefined): string | undefined {
  const repo = useRepo();
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

  return loaded !== null && loaded.photoId === photoId ? loaded.url : undefined;
}
