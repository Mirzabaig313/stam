import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { CARD_H, CARD_W, ROW_H } from "@/core/layout/constants";
import { layoutDescendants } from "@/core/layout/descendants";
import { layoutFan } from "@/core/layout/fan";
import { layoutHourglass } from "@/core/layout/hourglass";
import { layoutPedigree } from "@/core/layout/pedigree";
import { layoutTimeline } from "@/core/layout/timeline";
import type { LayoutResult } from "@/core/layout/types";
import { parentsOf, parentUnionOf, partnersOf, unionsOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";

import { arbFamily, runs } from "../../fixtures/arbitraries";
import { arbDeepFamily } from "../../fixtures/deepFamily";
import { expectNoCrossingChildEdges } from "./checks";

// Properties of the pedigree, descendants and hourglass layouts (plus sanity checks on the fan
// and timeline), checked together on each generated family because building one costs more
// than laying it out.
const TIMEOUT_MS = 10 * 60 * 1000;
const numRuns = runs();
const NOW = new Date("2026-07-01T00:00:00Z");

type Case = { doc: TreeDocument; focusId: string; collapsed: Set<string> };

/** A random family, a random focus (often a deep one) and a random set of collapsed people. */
function arbCase(families: fc.Arbitrary<TreeDocument>): fc.Arbitrary<Case> {
  return fc
    .tuple(families, fc.nat(1000), fc.array(fc.nat(1000), { maxLength: 3 }))
    .filter(([doc]) => Object.keys(doc.persons).length > 0)
    .map(([doc, focusPick, collapsePicks]) => {
      const people = Object.keys(doc.persons);
      const pick = (n: number) => people[n % people.length]!;
      return { doc, focusId: pick(focusPick), collapsed: new Set(collapsePicks.map(pick)) };
    });
}

// Independent oracles, written with the (slow but obvious) model queries.

/** Biological parents, else adoptive parents (the controller's adopted-only ruling). */
function viewParentsOf(doc: Case["doc"], personId: string): string[] {
  const bio = parentsOf(doc, personId);
  return bio.length > 0 ? bio : [...(parentUnionOf(doc, personId, "adopted")?.partners ?? [])];
}

/** The focus and every ancestor (see `viewParentsOf`) not hidden behind a collapsed person. */
function expectedAncestors({ doc, focusId, collapsed }: Case): Set<string> {
  const shown = new Set([focusId]);
  const queue = [focusId];
  for (let i = 0; i < queue.length; i++) {
    if (collapsed.has(queue[i]!)) continue;
    for (const parent of viewParentsOf(doc, queue[i]!)) {
      if (!shown.has(parent)) {
        shown.add(parent);
        queue.push(parent);
      }
    }
  }
  return shown;
}

/** The root and everyone below through any child link, not below a collapsed person. */
function expectedDescendants({ doc, focusId, collapsed }: Case): Set<string> {
  const shown = new Set([focusId]);
  const queue = [focusId];
  for (let i = 0; i < queue.length; i++) {
    if (collapsed.has(queue[i]!)) continue;
    for (const union of unionsOf(doc, queue[i]!)) {
      for (const { personId } of union.children) {
        if (!shown.has(personId)) {
          shown.add(personId);
          queue.push(personId);
        }
      }
    }
  }
  return shown;
}

/** The family view below the focus: blood (not passing a collapsed partner) plus partners. */
function expectedFamily({ doc, focusId, collapsed }: Case): Set<string> {
  const blood = new Set([focusId]);
  const queue = [focusId];
  for (let i = 0; i < queue.length; i++) {
    for (const union of unionsOf(doc, queue[i]!)) {
      if (union.partners.some((p) => collapsed.has(p))) continue;
      for (const { personId } of union.children) {
        if (!blood.has(personId)) {
          blood.add(personId);
          queue.push(personId);
        }
      }
    }
  }
  const shown = new Set(blood);
  for (const personId of blood) for (const p of partnersOf(doc, personId)) shown.add(p);
  return shown;
}

type Check = (c: Case, layout: LayoutResult, expected: Set<string>) => void;

const treeChecks: Record<string, Check> = {
  "no two cards intersect or touch": (_, { nodes }) => {
    const byX = nodes.toSorted((a, b) => a.x - b.x);
    for (let i = 0; i < byX.length; i++) {
      const a = byX[i]!;
      for (let j = i + 1; j < byX.length && byX[j]!.x <= a.x + CARD_W; j++) {
        const b = byX[j]!;
        if (b.y <= a.y + CARD_H && a.y <= b.y + CARD_H) {
          throw new Error(`${a.nodeId} touches ${b.nodeId}`);
        }
      }
    }
  },

  "every card sits on its generation's row; top row y = 0, leftmost x = 0": (c, { nodes }) => {
    const minGen = Math.min(...nodes.map((n) => n.generation));
    for (const n of nodes) expect(n.y).toBe((n.generation - minGen) * ROW_H);
    expect(Math.min(...nodes.map((n) => n.x))).toBe(0);
    expect(nodes.find((n) => n.nodeId === c.focusId)?.generation).toBe(0);
  },

  "every expected person appears exactly once as non-linked, nobody else at all": (
    c,
    layout,
    expected,
  ) => {
    const nodesOf = Map.groupBy(layout.nodes, (n) => n.personId);
    for (const personId of Object.keys(c.doc.persons)) {
      const nodes = nodesOf.get(personId) ?? [];
      if (expected.has(personId)) {
        expect(nodes.filter((n) => n.kind !== "linked").map((n) => n.nodeId)).toEqual([personId]);
        expect(layout.primaryNode[personId]).toBe(personId);
      } else {
        expect(nodes).toEqual([]);
      }
    }
    expect(new Set(layout.nodes.map((n) => n.nodeId)).size).toBe(layout.nodes.length);
    expect(new Set(layout.edges.map((e) => e.id)).size).toBe(layout.edges.length);
  },

  "every child edge ends at its child's top centre": (_, { nodes, edges }) => {
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    for (const edge of edges) {
      if (edge.kind !== "child") continue;
      const child = byId.get(edge.id.slice(`child:${edge.unionId}:`.length))!;
      expect(child).toBeDefined();
      expect(edge.points.at(-1)).toEqual([child.x + CARD_W / 2, child.y]);
    }
  },

  "child edges from different anchors never meet": (_, layout) => {
    expectNoCrossingChildEdges(layout, (e) => String(e.points[0]));
  },
};

/** Each layout with its oracle; generations must be ≤ 0, ≥ 0 or either. */
const layouts: {
  name: string;
  run: (c: Case) => LayoutResult;
  expected: (c: Case) => Set<string>;
  generations: "up" | "down" | "both";
}[] = [
  {
    name: "pedigree",
    run: (c) => layoutPedigree(c.doc, { focusId: c.focusId, collapsed: c.collapsed }),
    expected: expectedAncestors,
    generations: "up",
  },
  {
    name: "descendants",
    run: (c) => layoutDescendants(c.doc, { rootId: c.focusId, collapsed: c.collapsed }),
    expected: expectedDescendants,
    generations: "down",
  },
  {
    name: "hourglass",
    run: (c) => layoutHourglass(c.doc, { focusId: c.focusId, collapsed: c.collapsed }),
    expected: (c) => new Set([...expectedAncestors(c), ...expectedFamily(c)]),
    generations: "both",
  },
];

function checkAll(c: Case): void {
  for (const { name, run, expected, generations } of layouts) {
    const layout = run(c);
    const people = expected(c);
    const checks: Record<string, Check> = {
      ...treeChecks,
      "layout is deterministic": () => expect(run(c)).toEqual(layout),
      "generations point the right way": () => {
        for (const n of layout.nodes) {
          if (generations === "up" && n.generation > 0) throw new Error(`${n.nodeId} below`);
          if (generations === "down" && n.generation < 0) throw new Error(`${n.nodeId} above`);
        }
      },
    };
    for (const [property, check] of Object.entries(checks)) {
      try {
        check(c, layout, people);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`${name}: ${property}: ${message}`, { cause });
      }
    }
  }

  // Fan: every segment is a real ancestor in its Ahnentafel slot, inside the upper half.
  const fan = layoutFan(c.doc, { focusId: c.focusId, generations: 5 });
  const slots = new Set<string>();
  for (const s of fan.segments) {
    const key = `${s.generation}:${s.index}`;
    if (slots.has(key)) throw new Error(`fan: slot ${key} used twice`);
    slots.add(key);
    expect(s.startAngle).toBeGreaterThanOrEqual(Math.PI - 1e-9);
    expect(s.endAngle).toBeLessThanOrEqual(2 * Math.PI + 1e-9);
    expect(expectedAncestors({ ...c, collapsed: new Set() }).has(s.personId)).toBe(true);
  }

  // Timeline: rows are 0..n-1 in generation order, and every bar ends after it starts.
  const timeline = layoutTimeline(c.doc, { rootId: c.focusId }, NOW);
  expect(timeline.bars.map((b) => b.row)).toEqual(timeline.bars.map((_, i) => i));
  for (let i = 1; i < timeline.bars.length; i++) {
    expect(timeline.bars[i]!.generation).toBeGreaterThanOrEqual(timeline.bars[i - 1]!.generation);
  }
  for (const b of timeline.bars) expect(b.end).toBeGreaterThanOrEqual(b.start);
}

describe("view layout properties", () => {
  test(
    "hold over command-built families",
    () => fc.assert(fc.property(arbCase(arbFamily()), checkAll), { numRuns }),
    TIMEOUT_MS,
  );

  test(
    "hold over deep, bushy families",
    () => fc.assert(fc.property(arbCase(arbDeepFamily()), checkAll), { numRuns }),
    TIMEOUT_MS,
  );
});
