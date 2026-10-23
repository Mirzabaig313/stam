// `bun run bench`: times layoutFamily on big families and fails when a p75 is over budget
// (PRD performance: 1,000 people ≤ 50 ms, 5,000 people ≤ 300 ms). The deep and remarried shapes
// guard the contour code and multi-union blocks against worst cases the balanced family misses.

import { bench, run } from "mitata";

import { layoutFamily } from "@/core/layout/family";
import type { TreeDocument } from "@/core/model/types";
import { bigFamily, chainFamily, remarriedFamily } from "@/dev/bigFamily";

const CASES: { name: string; doc: TreeDocument; budgetMs: number }[] = [
  { name: "balanced, 1,000 people", doc: bigFamily(1000), budgetMs: 50 },
  { name: "balanced, 5,000 people", doc: bigFamily(5000), budgetMs: 300 },
  { name: "chain of 2,000 generations", doc: chainFamily(2000, 2), budgetMs: 300 },
  { name: "remarried, 5,000 people", doc: remarriedFamily(5000), budgetMs: 300 },
];

for (const { name, doc } of CASES) {
  bench(name, () => layoutFamily(doc, { rootId: doc.rootPersonId! }));
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
