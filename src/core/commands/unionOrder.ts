import type { Draft } from "immer";

import { compareFuzzyDate, type FuzzyDate } from "@/core/dates/fuzzy";
import type { TreeDocument } from "@/core/model/types";

type Doc = Draft<TreeDocument>;

/** A date without a year cannot be ordered, so it counts as no date. */
export function datedYear(date: FuzzyDate | undefined): FuzzyDate | undefined {
  return date?.year === undefined ? undefined : date;
}

/** FR-R9: before the first union that starts later, otherwise last. */
export function insertUnionInOrder(doc: Doc, personId: string, unionId: string): void {
  const order = (doc.unionOrder[personId] ??= []);
  const start = datedYear(doc.unions[unionId]?.start);
  let index = order.length;
  if (start) {
    const later = order.findIndex((id) => {
      const other = datedYear(doc.unions[id]?.start);
      return other !== undefined && compareFuzzyDate(other, start) > 0;
    });
    if (later >= 0) index = later;
  }
  order.splice(index, 0, unionId);
}
