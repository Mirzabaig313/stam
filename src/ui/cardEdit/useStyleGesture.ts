import { useRef } from "react";

import type { CardStyles } from "@/templates/cardStyle";
import { useEditorStore } from "@/ui/store/useEditor";

/**
 * Card style changes the way design tools make them: shown live while a corner is dragged or a
 * slider moves (`preview`), then kept as one undo step when the gesture ends (`commit`), or put
 * back (`cancel`). A swatch click is a gesture of one step: `commit` alone.
 */
export function useStyleGesture() {
  const store = useEditorStore();
  /** The styles before the gesture: what `cancel` restores. */
  const start = useRef<CardStyles | null>(null);
  return {
    preview(next: CardStyles) {
      start.current ??= store.getState().cardStyles;
      store.getState().previewCardStyles(next);
    },
    commit(next: CardStyles, label: string) {
      start.current = null;
      store.getState().commitCardStyles(next, label);
    },
    cancel() {
      if (start.current) store.getState().previewCardStyles(start.current);
      start.current = null;
    },
    /** True while a gesture is under way. */
    get active() {
      return start.current !== null;
    },
  };
}
