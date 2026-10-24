import { unionYOf } from "@/core/layout/constants";
import type { LayoutResult } from "@/core/layout/types";
import type { EdgeLook } from "@/ui/canvas/Edges";

import type { FaceScale } from "./metrics";
import type { Palette, Template } from "./types";

/** The generation drawn as the view's eldest row: the smallest generation number in it. */
export function eldestGeneration(layout: LayoutResult): number {
  let min = Infinity;
  for (const n of layout.nodes) min = Math.min(min, n.generation);
  return min;
}

/**
 * How the template draws a layout's connectors. A tapering template (Botanical) thins its lines
 * row by row away from the eldest couple, like branches from a trunk.
 */
export function edgeLookFor(
  template: Template,
  palette: Palette,
  scale: FaceScale,
  layout: LayoutResult,
): EdgeLook {
  const { metrics } = layout;
  const look: EdgeLook = {
    style: template.connectors,
    colour: palette.line,
    scale: scale.card,
    metrics,
  };
  if (template.connectors.taper && layout.nodes.length > 0) {
    const eldest = eldestGeneration(layout);
    const row = layout.nodes.find((n) => n.generation === eldest)!;
    const rootY = row.y + unionYOf(metrics);
    look.taper = (y) => {
      const rows = Math.abs(y - rootY) / metrics.rowH;
      return Math.max(0.45, 1.8 - 0.45 * Math.round(rows));
    };
  }
  return look;
}
