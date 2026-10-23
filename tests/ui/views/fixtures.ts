import type { TreeDocument } from "@/core/model/types";
import type { FanLayout, FanSegment, TimelineLayout } from "@/core/views/types";

import { docOf, person, union } from "../../fixtures/families";

// Hand-built layouts in the shape of the shared contract: lane T builds the real layouts in
// parallel, so these renderer tests must not depend on them.

/**
 * Noor (focus) ← Ali + Hina; Ali ← Ahmed + Sara; Hina ← Imran + an unknown mother.
 * Ahmed's own father Karim is known; everyone else above is missing.
 */
export function fanFamily(): TreeDocument {
  return docOf(
    [
      person("noor", "Noor", "Khan", "female", { birth: { date: { year: 1985 } } }),
      person("ali", "Ali", "Khan", "male", { birth: { date: { year: 1950 } } }),
      person("hina", "Hina", "Raza", "female", { birth: { date: { year: 1955 } } }),
      person("ahmed", "Ahmed", "Khan", "male", {
        isLiving: false,
        birth: { date: { year: 1920 } },
        death: { date: { year: 1990 } },
      }),
      person("sara", "Sara", "Khan", "female", {
        isLiving: false,
        birth: { date: { year: 1925 } },
      }),
      person("imran", "Imran", "Raza", "male", { birth: { date: { year: 1930 } } }),
      person("unknownMom", "", "", "female", { isPlaceholder: true }),
      person("karim", "Karim", "Khan", "male", {
        isLiving: false,
        birth: { date: { year: 1890 } },
      }),
    ],
    [
      union("u0", ["karim"], ["ahmed"]),
      union("u1", ["ahmed", "sara"], ["ali"]),
      union("u2", ["imran", "unknownMom"], ["hina"]),
      union("u3", ["ali", "hina"], ["noor"]),
    ],
    "karim",
  );
}

const R0 = 80;
const RING = 90;

function seg(personId: string, generation: number, index: number): FanSegment {
  const span = Math.PI / 2 ** generation;
  return {
    personId,
    generation,
    index,
    startAngle: Math.PI + index * span,
    endAngle: Math.PI + (index + 1) * span,
    innerRadius: R0 + (generation - 1) * RING,
    outerRadius: R0 + generation * RING,
  };
}

/** Three generations around Noor; Karim's wife and the unknown mother's parents are missing. */
export function fanLayout(): FanLayout {
  return {
    focusId: "noor",
    generations: 3,
    radius: R0 + 3 * RING,
    segments: [
      seg("ali", 1, 0),
      seg("hina", 1, 1),
      seg("ahmed", 2, 0),
      seg("sara", 2, 1),
      seg("imran", 2, 2),
      seg("unknownMom", 2, 3),
      seg("karim", 3, 0),
    ],
  };
}

/** Bars for the same family: two generations, one estimated end, living people end in 2026. */
export function timelineLayout(): TimelineLayout {
  return {
    minYear: 1890,
    maxYear: 2026,
    rows: 5,
    generationRows: [
      { generation: 0, firstRow: 0, lastRow: 0 },
      { generation: 1, firstRow: 1, lastRow: 2 },
      { generation: 2, firstRow: 3, lastRow: 4 },
    ],
    bars: [
      bar("karim", 0, 0, 1890, 1960, { endKnown: false }),
      bar("ahmed", 1, 1, 1920, 1990),
      bar("sara", 2, 1, 1925, 1995, { endKnown: false }),
      bar("ali", 3, 2, 1950, 2026, { living: true }),
      bar("hina", 4, 2, 1955, 2026, { living: true }),
    ],
  };
}

function bar(
  personId: string,
  row: number,
  generation: number,
  start: number,
  end: number,
  extra: { endKnown?: boolean; living?: boolean } = {},
) {
  const living = extra.living ?? false;
  return {
    personId,
    row,
    generation,
    start,
    end,
    startKnown: true,
    endKnown: extra.endKnown ?? !living,
    living,
  };
}
