import { type RefObject, useEffect } from "react";

import type { CanvasHandle } from "@/ui/canvas/Canvas";

/** FR-X11: the browser's Print gives the whole tree on one page, so the canvas fits first. */
export function usePrintFit(canvas: RefObject<CanvasHandle | null>): void {
  useEffect(() => {
    const onBeforePrint = () => canvas.current?.fit();
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, [canvas]);
}
