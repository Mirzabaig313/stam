export type ViewMode = "family" | "pedigree" | "descendants" | "hourglass" | "fan" | "timeline";
export type FanSegment = {
  personId: string;
  generation: number; // 1 = parents of focus, 2 = grandparents, ...
  index: number; // 0-based position within its generation (paternal side first)
  startAngle: number; // radians, 0 = pointing right, increasing clockwise; the fan spans π..2π (upper half)
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
};
export type FanLayout = {
  focusId: string;
  segments: FanSegment[];
  radius: number;
  generations: number;
};
export type TimelineBar = {
  personId: string;
  row: number; // 0-based lane, grouped by generation, ordered by birth
  generation: number;
  start: number; // year (fractional allowed)
  end: number; // year; for living people = current year
  startKnown: boolean;
  endKnown: boolean;
  living: boolean;
};
export type TimelineLayout = {
  bars: TimelineBar[];
  minYear: number;
  maxYear: number;
  rows: number;
  generationRows: { generation: number; firstRow: number; lastRow: number }[];
};
