import type { ComponentType, RefAttributes } from "react";

import { FanChart, type FanChartProps } from "./FanChart";
import { Timeline, type TimelineProps } from "./Timeline";
import type { ViewHandle } from "./useViewCamera";

/**
 * The two read-only views; the editor page takes them as a prop so tests can swap them. Their
 * `ref` is the handle the toolbar (zoom, fit) and search (centre a person) drive.
 */
export type ViewRenderers = {
  FanChart: ComponentType<FanChartProps & RefAttributes<ViewHandle>>;
  Timeline: ComponentType<TimelineProps & RefAttributes<ViewHandle>>;
};

export const realRenderers: ViewRenderers = { FanChart, Timeline };
