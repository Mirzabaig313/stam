import { unreachableFrom } from "@/core/layout/blocks";
import type { CardMetrics, SizeOf } from "@/core/layout/constants";
import { layoutDescendants } from "@/core/layout/descendants";
import { layoutFamily } from "@/core/layout/family";
import { clampFanGenerations, layoutFan } from "@/core/layout/fan";
import { growUpward } from "@/core/layout/flip";
import { layoutHourglass } from "@/core/layout/hourglass";
import { layoutPedigree } from "@/core/layout/pedigree";
import { layoutTimeline } from "@/core/layout/timeline";
import type { LayoutResult } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";
import type { FanLayout, TimelineLayout, ViewMode } from "@/core/views/types";

/** The views in switcher order (Alt+1 .. Alt+6). */
export const VIEW_MODES: readonly ViewMode[] = [
  "family",
  "pedigree",
  "descendants",
  "hourglass",
  "fan",
  "timeline",
];

/** How many generations of ancestors the fan chart draws until another number is chosen (FR-V5). */
export const FAN_GENERATIONS = 4;
export { clampFanGenerations };

/** Fan and timeline are for reading (FR-V7): nothing in them edits the tree. */
export function isReadOnlyView(mode: ViewMode): boolean {
  return mode === "fan" || mode === "timeline";
}

/** Views drawn around one chosen person. */
export function isFocusView(mode: ViewMode): boolean {
  return mode === "pedigree" || mode === "descendants" || mode === "hourglass" || mode === "fan";
}

/** The layout functions the store calls; the store takes them as a dependency so tests can fake them. */
export type ViewLayoutFns = {
  family: typeof layoutFamily;
  pedigree: typeof layoutPedigree;
  descendants: typeof layoutDescendants;
  hourglass: typeof layoutHourglass;
  fan: typeof layoutFan;
  timeline: typeof layoutTimeline;
};

export const realLayouts: ViewLayoutFns = {
  family: layoutFamily,
  pedigree: layoutPedigree,
  descendants: layoutDescendants,
  hourglass: layoutHourglass,
  fan: layoutFan,
  timeline: layoutTimeline,
};

export type ViewInputs = {
  viewMode: ViewMode;
  viewRootId: string | null;
  focusId: string | null;
  collapsed: ReadonlySet<string>;
  /** Generations the fan draws (2–7); `FAN_GENERATIONS` when left out. */
  fanGenerations?: number;
  /** Card size and spacing of the tree's look; the default metrics when left out. */
  metrics?: CardMetrics;
  /** "up": the template draws the eldest row at the bottom (Botanical). */
  growth?: "down" | "up";
  /** Cards resized on their own. */
  sizes?: SizeOf;
};

export type ComputedViews = {
  /** What the canvas draws; for fan and timeline, the family layout (exports use it). */
  layout: LayoutResult | null;
  fanLayout: FanLayout | null;
  timelineLayout: TimelineLayout | null;
  /**
   * Who the family view (from the view root) can't reach, whatever view is shown: the toolbar's
   * "N not connected" is about the family view.
   */
  familyUnreachable: string[];
};

/** The person a focus view is drawn around: the chosen focus, else the view root, else the root. */
export function resolveFocus(
  doc: TreeDocument | null,
  focusId: string | null,
  viewRootId: string | null,
): string | null {
  if (!doc) return null;
  if (focusId !== null && doc.persons[focusId]) return focusId;
  const fallback = viewRootId ?? doc.rootPersonId;
  return fallback !== undefined && doc.persons[fallback] ? fallback : null;
}

/** Lays the document out for the current view. All null while there is no root person. */
export function computeViews(
  fns: ViewLayoutFns,
  doc: TreeDocument | null,
  input: ViewInputs,
  now: Date = new Date(),
): ComputedViews {
  const none: ComputedViews = {
    layout: null,
    fanLayout: null,
    timelineLayout: null,
    familyUnreachable: [],
  };
  const rootId = input.viewRootId ?? doc?.rootPersonId;
  if (!doc || rootId === undefined) return none;
  const { collapsed, viewMode, metrics, sizes } = input;
  /** Card views in a template that grows upward are drawn upside down (see `growUpward`). */
  const grown = (layout: LayoutResult): LayoutResult =>
    input.growth === "up" ? growUpward(layout) : layout;
  const family = () => grown(fns.family(doc, { rootId, collapsed, metrics, sizes }));
  const focus = resolveFocus(doc, input.focusId, input.viewRootId);
  /** A focus view's own layout, with the family view's unreachable people. */
  const around = (layout: LayoutResult | null): ComputedViews => ({
    ...none,
    layout: layout && grown(layout),
    familyUnreachable: unreachableFrom(doc, rootId),
  });
  /** The family layout, which fan and timeline keep for exports. */
  const withFamily = (extra: Partial<ComputedViews> = {}): ComputedViews => {
    const layout = family();
    return { ...none, layout, familyUnreachable: layout.unreachable, ...extra };
  };
  switch (viewMode) {
    case "pedigree":
      return around(
        focus ? fns.pedigree(doc, { focusId: focus, collapsed, metrics, sizes }) : null,
      );
    case "descendants":
      return around(
        focus ? fns.descendants(doc, { rootId: focus, collapsed, metrics, sizes }) : null,
      );
    case "hourglass":
      return around(
        focus ? fns.hourglass(doc, { focusId: focus, collapsed, metrics, sizes }) : null,
      );
    case "fan":
      return withFamily({
        fanLayout: focus
          ? fns.fan(doc, { focusId: focus, generations: input.fanGenerations ?? FAN_GENERATIONS })
          : null,
      });
    case "timeline":
      return withFamily({ timelineLayout: fns.timeline(doc, { rootId }, now) });
    default:
      return withFamily();
  }
}
