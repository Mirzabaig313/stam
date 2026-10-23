import { presumedLiving } from "@/core/birthdays";
import type { FuzzyDate, TreeDocument } from "@/core/model/types";
import type { TimelineBar, TimelineLayout } from "@/core/views/types";

import { buildBlockTree } from "./blocks";
import type { Block } from "./types";

const NONE: ReadonlySet<string> = new Set();
/** Assumed lifespan, in years, for someone dead with no death year. */
export const ASSUMED_LIFESPAN = 70;

/** A date as a fractional year: the month and day (when known) move it into the year. */
function yearOf(date: FuzzyDate & { year: number }): number {
  const month = (date.month ?? 1) - 1;
  const day = (date.day ?? 1) - 1;
  return date.year + (month + day / 31) / 12;
}

/** "before" and "after" dates leave the real date open. */
const isOpen = (date: FuzzyDate) => date.qualifier === "before" || date.qualifier === "after";

/**
 * The timeline: one lifespan bar per person in the family view of `rootId` (blood relatives and
 * their partners, with the family view's generations), one row each, grouped by generation and
 * ordered by birth (ties keep family-view order).
 *
 * - No birth year: no bar.
 * - A death year ends the bar (`endKnown` unless it is a "before"/"after" date).
 * - No death year and living: the bar ends at `now` (`living`, `endKnown`). Someone born more
 *   than 110 years ago is not presumed living (`presumedLiving`).
 * - No death year and not living: `ASSUMED_LIFESPAN` years, `endKnown = false`.
 *
 * Pure; `now` defaults to the current date and is only read for living people's end.
 */
export function layoutTimeline(
  doc: TreeDocument,
  opts: { rootId: string },
  now: Date = new Date(),
): TimelineLayout {
  const nowYear = yearOf({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  });
  const empty: TimelineLayout = {
    bars: [],
    minYear: now.getUTCFullYear(),
    maxYear: now.getUTCFullYear(),
    rows: 0,
    generationRows: [],
  };
  if (!Object.hasOwn(doc.persons, opts.rootId)) return empty;

  // Everyone the family view places, at their primary position.
  const order: [string, number][] = [];
  const stack: Block[] = [buildBlockTree(doc, opts.rootId, NONE).root];
  while (stack.length > 0) {
    const block = stack.pop()!;
    for (const m of block.members) if (m.kind !== "linked") order.push([m.personId, block.depth]);
    for (let u = block.unions.length - 1; u >= 0; u--) {
      const children = block.unions[u]!.children;
      for (let c = children.length - 1; c >= 0; c--) stack.push(children[c]!);
    }
  }

  const bars: TimelineBar[] = [];
  for (const [personId, generation] of order) {
    const person = doc.persons[personId]!;
    const birth = person.birth?.date;
    if (birth?.year === undefined) continue;
    const start = yearOf({ ...birth, year: birth.year });
    const death = person.death?.date;
    let end: number;
    let endKnown: boolean;
    let living = false;
    if (death?.year !== undefined) {
      end = yearOf({ ...death, year: death.year });
      endKnown = !isOpen(death);
    } else if (presumedLiving(person, now)) {
      end = nowYear;
      endKnown = true;
      living = true;
    } else {
      end = start + ASSUMED_LIFESPAN;
      endKnown = false;
    }
    bars.push({
      personId,
      row: 0,
      generation,
      start,
      end: Math.max(start, end),
      startKnown: !isOpen(birth),
      endKnown,
      living,
    });
  }
  if (bars.length === 0) return empty;

  // Stable: ties keep family-view order.
  bars.sort((a, b) => a.generation - b.generation || a.start - b.start);
  const generationRows: TimelineLayout["generationRows"] = [];
  let minYear = Infinity;
  let maxYear = -Infinity;
  const result = bars.map((bar, row): TimelineBar => {
    const last = generationRows.at(-1);
    if (last?.generation === bar.generation) last.lastRow = row;
    else generationRows.push({ generation: bar.generation, firstRow: row, lastRow: row });
    minYear = Math.min(minYear, bar.start);
    maxYear = Math.max(maxYear, bar.end);
    return { ...bar, row };
  });
  return { bars: result, minYear, maxYear, rows: result.length, generationRows };
}
