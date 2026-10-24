import { lazy, type ReactNode, Suspense, useCallback, useEffect } from "react";

import type { LayoutNode } from "@/core/layout/types";
import type { Rect } from "@/ui/canvas/viewport";
import { useEditor } from "@/ui/store/useEditor";

import { cardEdit } from "./actions";

/** The handles and toolbars load when a card is first selected, not with the editor. */
const CardFrame = lazy(() => import("./CardFrame").then((m) => ({ default: m.CardFrame })));

/** Below this on-screen card width the card is too small to edit by hand: no frame. */
const MIN_FRAME_WIDTH = 90;

function Frame({ node, rect }: { node: LayoutNode; rect: Rect }) {
  const selected = useEditor((s) => s.selectedId === node.personId);
  const primary = useEditor((s) => s.layout?.primaryNode[node.personId] === node.nodeId);
  const editing = useEditor((s) => s.editing !== null);
  if (!selected || !primary || editing || rect.width < MIN_FRAME_WIDTH) return null;
  return (
    <Suspense fallback={null}>
      <CardFrame node={node} rect={rect} />
    </Suspense>
  );
}

/**
 * Editing cards by hand on the canvas: the selected card gets corner handles and the card and
 * text toolbars. `renderNodeExtras` goes into the canvas's overlay beside quick add's.
 */
export function useCardEditing(): {
  renderNodeExtras: (node: LayoutNode, rect: Rect) => ReactNode;
} {
  const selectedId = useEditor((s) => s.selectedId);
  // A line chosen on one card is not chosen on the next.
  useEffect(() => {
    const line = cardEdit.getState().line;
    if (line && line.personId !== selectedId) cardEdit.setState({ line: null });
  }, [selectedId]);
  const renderNodeExtras = useCallback(
    (node: LayoutNode, rect: Rect) => (
      <Frame key={`frame-${node.nodeId}`} node={node} rect={rect} />
    ),
    [],
  );
  return { renderNodeExtras };
}
