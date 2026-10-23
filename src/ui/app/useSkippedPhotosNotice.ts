import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/** Import leaves the number of photos it had to skip in the navigation state. */
function skippedPhotosFrom(state: unknown): number {
  const count = (state as { skippedPhotos?: unknown } | null)?.skippedPhotos;
  return typeof count === "number" ? count : 0;
}

/**
 * The import's "photos were skipped" count, read once. The history entry is then replaced
 * without it, so a reload does not show the notice again. `dismiss` hides it for this visit.
 */
export function useSkippedPhotosNotice(): { count: number; dismiss: () => void } {
  const location = useLocation();
  const navigate = useNavigate();
  const [count, setCount] = useState(() => skippedPhotosFrom(location.state));

  useEffect(() => {
    if (skippedPhotosFrom(location.state) > 0) {
      void navigate(location.pathname, { replace: true, state: null });
    }
    // Once the state is cleared this runs again and finds nothing to do.
  }, [location.state, location.pathname, navigate]);

  return { count, dismiss: () => setCount(0) };
}
