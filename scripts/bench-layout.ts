// `bun run bench`: times the layouts on big families and fails when a p75 is over budget
// (PRD performance: 1,000 people ≤ 50 ms, 5,000 people ≤ 300 ms, and every M3 view ≤ 300 ms at
// 5,000). The deep and remarried shapes guard the contour code and multi-union blocks against
// worst cases the balanced family misses; the ancestor family is a full 5,000-person pedigree.

import { bench, run } from "mitata";

import { layoutDescendants } from "@/core/layout/descendants";
import { layoutFamily } from "@/core/layout/family";
import { layoutFan } from "@/core/layout/fan";
import { layoutHourglass } from "@/core/layout/hourglass";
import { layoutPedigree } from "@/core/layout/pedigree";
import { layoutTimeline } from "@/core/layout/timeline";
import type { TreeDocument } from "@/core/model/types";
import { ancestorFamily, bigFamily, chainFamily, remarriedFamily } from "@/dev/bigFamily";

type Case = {
  name: string;
  doc: TreeDocument;
  budgetMs: number;
  layout: (doc: TreeDocument) => unknown;
};

const family = (doc: TreeDocument) => layoutFamily(doc, { rootId: doc.rootPersonId! });
const focus = (doc: TreeDocument) => ({ focusId: doc.rootPersonId! });

const balanced5k = bigFamily(5000);
const ancestors5k = ancestorFamily(5000);

const CASES: Case[] = [
  { name: "balanced, 1,000 people", doc: bigFamily(1000), budgetMs: 50, layout: family },
  { name: "balanced, 5,000 people", doc: balanced5k, budgetMs: 300, layout: family },
  { name: "chain of 2,000 generations", doc: chainFamily(2000, 2), budgetMs: 300, layout: family },
  { name: "remarried, 5,000 people", doc: remarriedFamily(5000), budgetMs: 300, layout: family },
  {
    name: "pedigree, 5,000 ancestors",
    doc: ancestors5k,
    budgetMs: 300,
    layout: (doc) => layoutPedigree(doc, focus(doc)),
  },
  {
    name: "descendants, balanced 5,000",
    doc: balanced5k,
    budgetMs: 300,
    layout: (doc) => layoutDescendants(doc, { rootId: doc.rootPersonId! }),
  },
  {
    name: "hourglass, 5,000 ancestors",
    doc: ancestors5k,
    budgetMs: 300,
    layout: (doc) => layoutHourglass(doc, focus(doc)),
  },
  {
    name: "hourglass, balanced 5,000 below",
    doc: balanced5k,
    budgetMs: 300,
    layout: (doc) => layoutHourglass(doc, focus(doc)),
  },
  {
    name: "fan, 7 generations of 5,000 ancestors",
    doc: ancestors5k,
    budgetMs: 300,
    layout: (doc) => layoutFan(doc, { ...focus(doc), generations: 7 }),
  },
  {
    name: "timeline, balanced 5,000",
    doc: balanced5k,
    budgetMs: 300,
    layout: (doc) => layoutTimeline(doc, { rootId: doc.rootPersonId! }),
  },
];

for (const { name, doc, layout } of CASES) {
  bench(name, () => layout(doc));
}

const { benchmarks } = await run();

let failed = false;
console.log("");
for (const { name, doc, budgetMs } of CASES) {
  const stats = benchmarks.find((b) => b.alias === name)?.runs[0]?.stats;
  if (!stats) {
    console.log(`FAIL ${name}: no result`);
    failed = true;
    continue;
  }
  const p75Ms = stats.p75 / 1e6;
  const ok = p75Ms <= budgetMs;
  if (!ok) failed = true;
  const people = Object.keys(doc.persons).length;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name} (${people} people): p75 ${p75Ms.toFixed(2)} ms (budget ${budgetMs} ms)`,
  );
}

process.exit(failed ? 1 : 0);
