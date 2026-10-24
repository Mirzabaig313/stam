import { describe, expect, test } from "bun:test";

import * as fc from "fast-check";

import { applyPrivacy } from "@/core/model/privacy";
import type { TreeDocument } from "@/core/model/types";

import { ALL_KINDS, arbOp, buildFamily, runs } from "../fixtures/arbitraries";
import { canonicalDoc } from "../fixtures/canonical";
import { loadCore } from "./wasm";

const core = loadCore();

describe("TS and Rust privacy filters agree", () => {
  test("on random families with random living, death, photos and notes", () => {
    fc.assert(
      fc.property(
        fc.array(arbOp(ALL_KINDS), { maxLength: 30 }),
        fc.array(fc.nat(7)),
        (ops, flags) => {
          const doc = structuredClone(buildFamily(ops)) as TreeDocument;
          Object.values(doc.persons).forEach((p, i) => {
            const f = flags[i % Math.max(1, flags.length)] ?? 0;
            p.isLiving = (f & 1) === 1;
            if (f & 2) p.death = { place: "Lahore" };
            if (f & 4) {
              p.notes = "private";
              p.photoId = `ph${i}`;
              p.birth = { date: { year: 1950 }, place: "Delhi" };
            }
          });
          for (const u of Object.values(doc.unions)) u.start = { year: 1970 };
          const rust = JSON.parse(core.apply_privacy_json(JSON.stringify(doc)));
          expect(canonicalDoc(rust)).toBe(canonicalDoc(applyPrivacy(doc)));
        },
      ),
      { numRuns: runs() },
    );
  });
});
