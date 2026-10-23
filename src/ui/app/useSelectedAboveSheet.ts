import { type RefObject, useEffect } from "react";

import type { CanvasHandle } from "@/ui/canvas/Canvas";

/**
 * How many px at the bottom of the canvas the person panel covers: the bottom sheet on narrow
 * screens. 0 when the panel sits beside the canvas or is closed.
 */
export function panelCoverage(): number {
  const canvas = document.querySelector(".stam-canvas")?.getBoundingClientRect();
  const panel = document.querySelector(".person-panel")?.getBoundingClientRect();
  if (!canvas || !panel || panel.width === 0 || panel.height === 0) return 0;
  const overlapsX = panel.left < canvas.right && panel.right > canvas.left;
  const overlapsY = panel.top < canvas.bottom && panel.bottom > canvas.top;
  if (!overlapsX || !overlapsY) return 0;
  return canvas.bottom - Math.max(panel.top, canvas.top);
}

/**
 * R38: when selecting a person opens the panel as a bottom sheet over the canvas, the canvas
 * centres their card in the area above the sheet, so the card and its handles stay in view.
 */
export function useSelectedAboveSheet(
  canvasRef: RefObject<CanvasHandle | null>,
  selectedId: string | null,
): void {
  useEffect(() => {
    if (selectedId === null) return;
    const bottomInset = panelCoverage();
    if (bottomInset > 0) canvasRef.current?.centerOnPerson(selectedId, { bottomInset });
  }, [canvasRef, selectedId]);
}
