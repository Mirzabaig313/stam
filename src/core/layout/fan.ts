import type { TreeDocument } from "@/core/model/types";
import type { FanLayout, FanSegment } from "@/core/views/types";

import { parentSlots, viewParentUnions } from "./ancestry";

/** Radius of the focus disc at the centre, in px. */
export const FAN_CENTRE_RADIUS = 90;
/** Width of each generation's ring, in px. */
export const FAN_RING = 80;
export const FAN_MIN_GENERATIONS = 2;
export const FAN_MAX_GENERATIONS = 7;

/** Whole generations in 2–7; anything else (NaN, fractions) is rounded down and clamped. */
export function clampFanGenerations(generations: number): number {
  if (!Number.isFinite(generations)) return FAN_MIN_GENERATIONS;
  return Math.min(FAN_MAX_GENERATIONS, Math.max(FAN_MIN_GENERATIONS, Math.floor(generations)));
}

/**
 * The fan chart: the focus's ancestors (biological, else adoptive) on rings around a centre disc (the focus),
 * over the upper half circle from π (left) to 2π (right), clockwise. Generation g has 2^g slots
 * of π / 2^g each, in Ahnentafel order: a person in slot i has their father in slot 2i and
 * their mother in 2i + 1 on the next ring, so each ancestor spans half their child's arc and the
 * paternal side comes first. Missing ancestors leave their slot empty. Someone reached twice
 * (pedigree collapse) fills both slots. At most 2^8 − 2 segments, so no collapse limits needed.
 */
export function layoutFan(
  doc: TreeDocument,
  opts: { focusId: string; generations: number },
): FanLayout {
  const generations = clampFanGenerations(opts.generations);
  const radius = FAN_CENTRE_RADIUS + generations * FAN_RING;
  const segments: FanSegment[] = [];
  if (!Object.hasOwn(doc.persons, opts.focusId)) {
    return { focusId: opts.focusId, segments, radius, generations };
  }

  const parents = viewParentUnions(doc);
  let ring: { personId: string; index: number }[] = [{ personId: opts.focusId, index: 0 }];
  for (let generation = 1; generation <= generations && ring.length > 0; generation++) {
    const span = Math.PI / 2 ** generation;
    const innerRadius = FAN_CENTRE_RADIUS + (generation - 1) * FAN_RING;
    const next: typeof ring = [];
    for (const { personId, index } of ring) {
      const link = parents.get(personId);
      if (!link) continue;
      parentSlots(doc, link.union).forEach((parentId, side) => {
        if (parentId !== undefined) next.push({ personId: parentId, index: 2 * index + side });
      });
    }
    for (const { personId, index } of next) {
      const startAngle = Math.PI + index * span;
      segments.push({
        personId,
        generation,
        index,
        startAngle,
        endAngle: startAngle + span,
        innerRadius,
        outerRadius: innerRadius + FAN_RING,
      });
    }
    ring = next;
  }
  return { focusId: opts.focusId, segments, radius, generations };
}
