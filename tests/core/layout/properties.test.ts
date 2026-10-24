import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { type BlockTree, buildBlockTree } from "@/core/layout/blocks";
import { type CardMetrics, type CardSize, DEFAULT_METRICS } from "@/core/layout/constants";
import { layoutFamily } from "@/core/layout/family";
import { nodeHeight, nodeWidth } from "@/core/layout/result";
import type { LayoutResult } from "@/core/layout/types";
import { partnersOf, unionsOf } from "@/core/model/tree";
import type { TreeDocument } from "@/core/model/types";
import { validate } from "@/core/model/validate";
import { CARD_SIZE, SPACINGS, TEMPLATE_IDS, TEXT_SIZE } from "@/templates/look";
import { metricsFor } from "@/templates/metrics";

import { arbFamily, runs } from "../../fixtures/arbitraries";
import { arbDeepFamily } from "../../fixtures/deepFamily";
import {
  expectBarsBetweenRows,
  expectGroupsUnderAnchors,
  expectNoCrossingChildEdges,
  expectNoOverlappingBrackets,
} from "./checks";

// Each run builds a family from up to 60 commands or 300 people, so give the 10,000-run
// `verify` room.
const TIMEOUT_MS = 10 * 60 * 1000;
const numRuns = runs();

type Case = {
  doc: TreeDocument;
  rootId: string;
  collapsed: Set<string>;
  metrics: CardMetrics;
  /** Cards resized on their own (60 % to 250 % of the metrics' card), by person. */
  sizes: Map<string, CardSize> | null;
};

/** The size controls' steps between `min` and `max`. */
const steps = (r: { min: number; max: number; step: number }) =>
  fc.integer({ min: r.min / r.step, max: r.max / r.step }).map((n) => n * r.step);

/** Half the time today's card; otherwise any template at any card size, text size and spacing. */
const arbMetrics: fc.Arbitrary<CardMetrics> = fc.oneof(
  fc.constant(DEFAULT_METRICS),
  fc
    .record({
      template: fc.constantFrom(...TEMPLATE_IDS),
      cardSize: steps(CARD_SIZE),
      textSize: steps(TEXT_SIZE),
      spacing: fc.constantFrom(...SPACINGS),
    })
    .map(metricsFor),
);

/** A random family, a random view root, a random set of collapsed people and card metrics. */
function arbCase(families: fc.Arbitrary<TreeDocument>): fc.Arbitrary<Case> {
  return fc
    .tuple(
      families,
      fc.nat(1000),
      fc.array(fc.nat(1000), { maxLength: 4 }),
      arbMetrics,
      fc.option(
        fc.array(
          fc.tuple(
            fc.nat(1000),
            fc.integer({ min: 60, max: 250 }),
            fc.integer({ min: 60, max: 250 }),
          ),
          { maxLength: 8 },
        ),
        { freq: 2 },
      ),
    )
    .filter(([doc]) => Object.keys(doc.persons).length > 0)
    .map(([doc, rootPick, collapsePicks, metrics, resized]) => {
      const people = Object.keys(doc.persons);
      const pick = (n: number) => people[n % people.length]!;
      // Mostly the document root; sometimes another person, as "View family" does.
      const rootId = rootPick % 3 === 0 ? pick(rootPick) : (doc.rootPersonId ?? pick(rootPick));
      const sizes = resized
        ? new Map(
            resized.map(([n, w, h]) => [
              pick(n),
              {
                w: Math.round((metrics.cardW * w) / 100),
                h: Math.round((metrics.cardH * h) / 100),
              },
            ]),
          )
        : null;
      return { doc, rootId, collapsed: new Set(collapsePicks.map(pick)), metrics, sizes };
    });
}

/**
 * Independent oracle: the blood set (the root and everyone below through unions with no
 * collapsed partner) plus every partner of a blood person.
 */
function expectedPeople({ doc, rootId, collapsed }: Case) {
  const blood = new Set([rootId]);
  const queue = [rootId];
  for (let i = 0; i < queue.length; i++) {
    for (const union of unionsOf(doc, queue[i]!)) {
      if (union.partners.some((p) => collapsed.has(p))) continue;
      for (const { personId } of union.children) {
        if (blood.has(personId)) continue;
        blood.add(personId);
        queue.push(personId);
      }
    }
  }
  const shown = new Set(blood);
  for (const personId of blood) {
    for (const partner of partnersOf(doc, personId)) shown.add(partner);
  }
  return { blood, shown };
}

const layoutOf = ({ doc, rootId, collapsed, metrics, sizes }: Case): LayoutResult =>
  layoutFamily(doc, {
    rootId,
    collapsed,
    metrics,
    ...(sizes ? { sizes: (id: string) => sizes.get(id) } : {}),
  });

/** The block tree behind a layout, and which block each node belongs to. */
type Context = { tree: BlockTree; blockOf: Map<string, number>; childBlocks: string[] };

function contextOf(c: Case): Context {
  const tree = buildBlockTree(c.doc, c.rootId, c.collapsed);
  const blockOf = new Map<string, number>();
  const childBlocks: string[] = [];
  const stack = [tree.root];
  for (let index = 0; stack.length > 0; index++) {
    const block = stack.pop()!;
    for (const member of block.members) blockOf.set(member.nodeId, index);
    for (const union of block.unions) {
      for (const child of union.children) {
        childBlocks.push(child.bloodNodeId);
        stack.push(child);
      }
    }
  }
  return { tree, blockOf, childBlocks };
}

type Check = (c: Case, layout: LayoutResult, ctx: Context) => void;

/**
 * Building a random family costs far more than laying it out, so every property runs on each
 * generated case inside one fast-check run. A failure names the property it broke.
 */
const properties: Record<string, Check> = {
  "no two node rectangles intersect or touch": (_, { nodes, metrics: m }) => {
    const byX = nodes.toSorted((a, b) => a.x - b.x);
    const widest = Math.max(...nodes.map((n) => nodeWidth(n, m)));
    for (let i = 0; i < byX.length; i++) {
      const a = byX[i]!;
      for (let j = i + 1; j < byX.length && byX[j]!.x <= a.x + widest; j++) {
        const b = byX[j]!;
        const overlapX = b.x <= a.x + nodeWidth(a, m) && a.x <= b.x + nodeWidth(b, m);
        const overlapY = b.y <= a.y + nodeHeight(a, m) && a.y <= b.y + nodeHeight(b, m);
        if (!overlapX) continue;
        if (overlapY) throw new Error(`${a.nodeId} touches ${b.nodeId}`);
      }
    }
  },

  "every node sits on its generation row, rows apart by at least the row gap": (
    _,
    { nodes, metrics: m },
  ) => {
    const rows = Map.groupBy(nodes, (n) => n.generation);
    const generations = [...rows.keys()].toSorted((a, b) => a - b);
    let bottom = -Infinity;
    for (const g of generations) {
      const row = rows.get(g)!;
      const top = row[0]!.y;
      for (const n of row) expect(n.y).toBe(top);
      expect(top).toBeGreaterThanOrEqual(bottom + m.rowH - m.cardH - 1e-9);
      bottom = Math.max(...row.map((n) => n.y + nodeHeight(n, m)));
    }
  },

  "every child edge ends at its child's top centre": (_, { nodes, edges, metrics: m }) => {
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    for (const edge of edges) {
      if (edge.kind !== "child") continue;
      const child = byId.get(edge.id.split(":").at(-1)!)!;
      expect(child).toBeDefined();
      expect(edge.points.at(-1)).toEqual([child.x + nodeWidth(child, m) / 2, child.y]);
    }
  },

  "layout is deterministic": (c, layout) => {
    expect(layoutOf(c)).toEqual(layout);
  },

  "every expected person appears exactly once as a primary node (R15 oracle)": (c, layout) => {
    const { blood, shown } = expectedPeople(c);
    const nodesOf = Map.groupBy(layout.nodes, (n) => n.personId);
    for (const personId of Object.keys(c.doc.persons)) {
      const nodes = nodesOf.get(personId) ?? [];
      const primary = nodes.filter((n) => n.kind !== "linked");
      if (shown.has(personId)) {
        expect(primary.map((n) => [n.nodeId, n.kind])).toEqual([
          [personId, blood.has(personId) ? "blood" : "spouse"],
        ]);
        expect(layout.primaryNode[personId]).toBe(personId);
      } else {
        expect(nodes).toEqual([]);
        expect(layout.primaryNode[personId]).toBeUndefined();
      }
    }
    // Unreachable means not connected at all: people hidden only by a collapse do not count.
    const connected = expectedPeople({ ...c, collapsed: new Set() }).shown;
    expect(layout.unreachable).toEqual(
      Object.keys(c.doc.persons).filter((id) => !connected.has(id)),
    );
    expect(new Set(layout.nodes.map((n) => n.nodeId)).size).toBe(layout.nodes.length);
  },

  "cards of one block sit exactly the couple gap apart, other blocks at least the gap": (
    _,
    { nodes, metrics: m },
    { blockOf },
  ) => {
    for (const row of Map.groupBy(nodes, (n) => n.y).values()) {
      const byX = row.toSorted((a, b) => a.x - b.x);
      for (let i = 1; i < byX.length; i++) {
        const [a, b] = [byX[i - 1]!, byX[i]!];
        const gap = b.x - a.x - nodeWidth(a, m);
        if (blockOf.get(a.nodeId) === blockOf.get(b.nodeId)) {
          if (Math.abs(gap - m.coupleGap) > 1e-9) {
            throw new Error(`${a.nodeId}|${b.nodeId} gap ${gap}`);
          }
        } else if (gap < m.gap - 1e-9) {
          throw new Error(`${a.nodeId}|${b.nodeId} gap ${gap} < ${m.gap}`);
        }
      }
    }
  },

  "every placed child has exactly one child edge, and nothing else has one": (
    _,
    { edges },
    { childBlocks },
  ) => {
    const targets = edges.filter((e) => e.kind === "child").map((e) => e.id.split(":").at(-1)!);
    expect(targets.toSorted()).toEqual(childBlocks.toSorted());
  },

  "each union's children sit under that union's anchor": (_, layout, { tree }) => {
    expectGroupsUnderAnchors(tree.root, layout);
  },

  "no child edge crosses another union's child edge (R12)": (_, layout) => {
    expectNoCrossingChildEdges(layout);
  },

  "no over-bracket overlaps another": (_, layout) => {
    expectNoOverlappingBrackets(layout);
  },

  "sibling bars stay between the rows": (_, layout) => {
    expectBarsBetweenRows(layout);
  },

  "the leftmost card is at x = 0 and the root row at y = 0": (c, layout) => {
    expect(Math.min(...layout.nodes.map((n) => n.x))).toBe(0);
    const root = layout.nodes.find((n) => n.nodeId === c.rootId)!;
    expect(root.kind).toBe("blood");
    expect(root.y).toBe(0);
  },
};

function checkAll(c: Case): void {
  const layout = layoutOf(c);
  const ctx = contextOf(c);
  for (const [name, check] of Object.entries(properties)) {
    try {
      check(c, layout, ctx);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`${name}: ${message}`, { cause });
    }
  }
}

describe("layout properties", () => {
  test("deep families are valid and reach deep generations", () => {
    const docs = fc.sample(arbDeepFamily(), { numRuns: 200, seed: 1 });
    for (const doc of docs) expect(validate(doc)).toEqual([]);
    const deepest = Math.max(
      ...docs.map((doc) => layoutFamily(doc, { rootId: doc.rootPersonId! }).generationCount),
    );
    expect(deepest).toBeGreaterThanOrEqual(10);
  });

  test(
    `hold over command-built families: ${Object.keys(properties).join("; ")}`,
    () => fc.assert(fc.property(arbCase(arbFamily()), checkAll), { numRuns }),
    TIMEOUT_MS,
  );

  test(
    "hold over deep, bushy families",
    () => fc.assert(fc.property(arbCase(arbDeepFamily()), checkAll), { numRuns }),
    TIMEOUT_MS,
  );
});
