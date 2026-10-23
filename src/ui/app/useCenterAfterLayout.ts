import { useCallback, useEffect, useRef, useState } from "react";

import type { LayoutResult } from "@/core/layout/types";

/**
 * Centring that waits for the layout. A search pick can change the view root and ask to centre
 * in the same tick, before the canvas has drawn the new layout. `requestCenter(id)` remembers the
 * person; once a committed layout has a node for them, `centerOn(id)` runs and the request is
 * cleared. A person already in the current layout is centred right after the next commit.
 * Asking with null drops a waiting request (the person can't be shown), so it can never fire
 * later when they turn up for some other reason.
 */
export function useCenterAfterLayout(
  layout: LayoutResult | null,
  centerOn: (personId: string) => void,
): (personId: string | null) => void {
  const pending = useRef<string | null>(null);
  // Only a re-render signal: asking again for the same person must still run the effect.
  const [requests, setRequests] = useState(0);
  const latest = useRef(centerOn);
  useEffect(() => {
    latest.current = centerOn;
  });

  useEffect(() => {
    const personId = pending.current;
    if (personId === null || layout?.primaryNode[personId] === undefined) return;
    pending.current = null;
    latest.current(personId);
    // `requests` is what re-runs this after an ask; `layout` re-runs it after a commit.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, layout]);

  return useCallback((personId: string | null) => {
    pending.current = personId;
    if (personId !== null) setRequests((n) => n + 1);
  }, []);
}
