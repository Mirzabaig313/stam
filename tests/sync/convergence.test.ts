import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { applyPrivacy } from "@/core/model/privacy";
import type { Person, TreeDocument } from "@/core/model/types";
import { validate } from "@/core/model/validate";

import { ALL_KINDS, arbOp, buildFamily, runs } from "../fixtures/arbitraries";
import { canonicalDoc } from "../fixtures/canonical";
import { type ClientSpec, Simulation } from "./simulation";

const TIES = { min: 1990, max: 1992 };

const arbStep = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("edit" as const),
      c: fc.nat(10),
      op: arbOp(ALL_KINDS, TIES),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("undo" as const), c: fc.nat(10) }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("serve" as const), c: fc.nat(10) }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("deliver" as const), c: fc.nat(10) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("drop" as const), c: fc.nat(10) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("reconnect" as const), c: fc.nat(10) }) },
);

const editors = fc.array(fc.constantFrom<ClientSpec>({ role: "owner" }, { role: "edit" }), {
  minLength: 2,
  maxLength: 5,
});

type Step = typeof arbStep extends fc.Arbitrary<infer T> ? T : never;

function run(start: TreeDocument, specs: ClientSpec[], steps: Step[]) {
  const sim = new Simulation(start, specs);
  for (const step of steps) {
    const c = sim.clients[step.c % sim.clients.length]!;
    if (step.kind === "edit") sim.edit(c, step.op);
    if (step.kind === "undo") sim.undo(c);
    if (step.kind === "serve") sim.serve(c);
    if (step.kind === "deliver") sim.deliver(c);
    if (step.kind === "drop") sim.disconnect(c);
    if (step.kind === "reconnect") sim.connect(c);
  }
  sim.settle();
  return sim;
}

/** Every person in a welcome's tree or an applied op's changes. */
function peopleIn(msg: {
  doc?: TreeDocument;
  changes?: { persons: Record<string, Person | null> };
}): Person[] {
  const persons = msg.doc?.persons ?? msg.changes?.persons ?? {};
  return Object.values(persons).filter((p): p is Person => p !== null);
}

describe("clients and the room converge", () => {
  test("2–5 editors with random edits, undos, delays and dropped connections end on one valid tree", () => {
    fc.assert(
      fc.property(
        fc.array(arbOp(ALL_KINDS, TIES), { maxLength: 10 }),
        editors,
        fc.array(arbStep, { maxLength: 60 }),
        (ops, specs, steps) => {
          const sim = run(buildFamily(ops), specs, steps);
          const server = sim.serverDoc();
          expect(validate(server)).toEqual([]);
          for (const c of sim.clients) {
            expect(c.sync.pendingCount).toBe(0);
            expect(canonicalDoc(c.sync.view)).toBe(canonicalDoc(server));
            expect(c.sync.version).toBe(sim.room.version());
          }
        },
      ),
      { numRuns: Math.max(100, runs() / 5) },
    );
  });

  test("a hide-living viewer ends on the privacy view and never receives living details", () => {
    fc.assert(
      fc.property(
        fc.array(arbOp(ALL_KINDS, TIES), { maxLength: 10 }),
        fc.array(arbStep, { maxLength: 60 }),
        (ops, steps) => {
          const start = buildFamily(ops);
          const sim = run(start, [{ role: "owner" }, { role: "view", hideLiving: true }], steps);
          const viewer = sim.clients[1]!;
          const server = sim.serverDoc();
          expect(canonicalDoc(viewer.sync.view)).toBe(canonicalDoc(applyPrivacy(server)));
          for (const text of viewer.received) {
            for (const p of peopleIn(JSON.parse(text))) {
              if (p.isLiving && p.death === undefined) {
                expect([p.birth, p.notes, p.photoId]).toEqual([undefined, undefined, undefined]);
              }
            }
          }
        },
      ),
      { numRuns: Math.max(100, runs() / 5) },
    );
  });
});
