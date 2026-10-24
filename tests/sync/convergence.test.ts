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
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("tick" as const), c: fc.nat(10) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("restart" as const), c: fc.nat(10) }) },
);

const editors = fc.array(fc.constantFrom<ClientSpec>({ role: "owner" }, { role: "edit" }), {
  minLength: 2,
  maxLength: 5,
});

type Step = typeof arbStep extends fc.Arbitrary<infer T> ? T : never;

function run(start: TreeDocument, specs: ClientSpec[], steps: Step[], catchUp = 1000) {
  const sim = new Simulation(start, specs, catchUp);
  for (const step of steps) {
    const c = sim.clients[step.c % sim.clients.length]!;
    if (step.kind === "edit") sim.edit(c, step.op);
    if (step.kind === "undo") sim.undo(c);
    if (step.kind === "serve") sim.serve(c);
    if (step.kind === "deliver") sim.deliver(c);
    if (step.kind === "drop") sim.disconnect(c);
    if (step.kind === "reconnect") sim.connect(c);
    if (step.kind === "tick") sim.tick();
    if (step.kind === "restart") sim.restart();
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
        fc.array(arbStep, { maxLength: 80 }),
        fc.constantFrom(1000, 3),
        (ops, specs, steps, catchUp) => {
          const sim = run(buildFamily(ops), specs, steps, catchUp);
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

  test("an editor back with 100 offline edits hits busy and still lands them all, in order", () => {
    const sim = new Simulation(buildFamily([]), [{ role: "owner" }, { role: "edit" }]);
    const [, editor] = sim.clients;
    sim.settle();
    sim.disconnect(editor!);
    // Each update needs the person its add creates: applied out of order, it is refused and lost.
    for (let i = 0; i < 50; i++) {
      const [id] = editor!.sync.submit({
        type: "addPerson",
        person: { gender: "male" },
      }).createdIds;
      editor!.sync.submit({ type: "updatePerson", personId: id!, patch: { notes: `n${i}` } });
    }
    sim.connect(editor!);
    sim.serve(editor!); // hello
    for (let i = 0; i < 100; i++) sim.serve(editor!); // the burst: 60 pass, then busy
    expect(editor!.inbox.some((t) => JSON.parse(t).type === "busy")).toBe(true);
    sim.settle();
    const notes = Object.values(sim.serverDoc().persons).flatMap((p) => p.notes ?? []);
    expect(notes).toHaveLength(50);
    expect(sim.room.version()).toBe(100);
    for (const c of sim.clients) {
      expect(c.sync.pendingCount).toBe(0);
      expect(canonicalDoc(c.sync.view)).toBe(canonicalDoc(sim.serverDoc()));
    }
  });

  test("a hide-living viewer ends on the privacy view and never receives living details", () => {
    fc.assert(
      fc.property(
        fc.array(arbOp(ALL_KINDS, TIES), { maxLength: 10 }),
        fc.array(arbStep, { maxLength: 60 }),
        (ops, steps) => {
          const start = buildFamily(ops);
          // The hidden "editor" may try to edit: the room refuses it, so it ends where viewers do.
          const specs: ClientSpec[] = [
            { role: "owner" },
            { role: "view", hideLiving: true },
            { role: "edit", hideLiving: true },
          ];
          const sim = run(start, specs, steps);
          const server = sim.serverDoc();
          for (const viewer of sim.clients.slice(1)) {
            expect(viewer.sync.pendingCount).toBe(0);
            expect(canonicalDoc(viewer.sync.view)).toBe(canonicalDoc(applyPrivacy(server)));
          }
          for (const text of sim.clients.slice(1).flatMap((c) => c.received)) {
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
