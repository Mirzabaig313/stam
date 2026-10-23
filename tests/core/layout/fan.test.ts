import { describe, expect, test } from "bun:test";

import { FAN_CENTRE_RADIUS, FAN_RING, layoutFan } from "@/core/layout/fan";

import {
  docOf,
  famAdoptedOnly,
  famAdoption,
  famCousinMarriage,
  person,
  union,
} from "../../fixtures/families";

const PI = Math.PI;

describe("layoutFan", () => {
  test("famCousinMarriage: slots in Ahnentafel order, paternal side first", () => {
    const fan = layoutFan(famCousinMarriage(), { focusId: "kid", generations: 3 });
    expect(fan.focusId).toBe("kid");
    expect(fan.generations).toBe(3);
    expect(fan.radius).toBe(FAN_CENTRE_RADIUS + 3 * FAN_RING);
    expect(fan.segments.map((s) => [s.personId, s.generation, s.index])).toEqual([
      ["cousin1", 1, 0],
      ["cousin2", 1, 1],
      ["p1", 2, 0],
      ["s1", 2, 1],
      ["s2", 2, 2],
      ["p2", 2, 3],
      // s1 and s2 have no parents: slots 2–5 stay empty. g1 and g2 appear twice (collapse).
      ["g1", 3, 0],
      ["g2", 3, 1],
      ["g1", 3, 6],
      ["g2", 3, 7],
    ]);
  });

  test("each ancestor spans half their child's arc, rings stack outwards", () => {
    const fan = layoutFan(famCousinMarriage(), { focusId: "kid", generations: 3 });
    for (const s of fan.segments) {
      const span = PI / 2 ** s.generation;
      expect(s.endAngle - s.startAngle).toBeCloseTo(span, 12);
      expect(s.startAngle).toBeCloseTo(PI + s.index * span, 12);
      expect(s.innerRadius).toBe(FAN_CENTRE_RADIUS + (s.generation - 1) * FAN_RING);
      expect(s.outerRadius).toBe(s.innerRadius + FAN_RING);
    }
    const at = (id: string, gen: number) =>
      fan.segments.find((s) => s.personId === id && s.generation === gen)!;
    // The father takes the first half of the child's arc, the mother the second.
    expect(at("p1", 2).startAngle).toBe(at("cousin1", 1).startAngle);
    expect(at("s1", 2).endAngle).toBeCloseTo(at("cousin1", 1).endAngle, 12);
    expect(at("cousin1", 1).startAngle).toBe(PI);
    expect(at("cousin2", 1).endAngle).toBeCloseTo(2 * PI, 12);
  });

  test("generations are clamped to 2–7 and limit the depth", () => {
    const doc = famCousinMarriage();
    expect(layoutFan(doc, { focusId: "kid", generations: 1 }).generations).toBe(2);
    expect(layoutFan(doc, { focusId: "kid", generations: 0 }).generations).toBe(2);
    expect(layoutFan(doc, { focusId: "kid", generations: 12 }).generations).toBe(7);
    expect(layoutFan(doc, { focusId: "kid", generations: Number.NaN }).generations).toBe(2);
    expect(layoutFan(doc, { focusId: "kid", generations: 3.7 }).generations).toBe(3);
    const two = layoutFan(doc, { focusId: "kid", generations: 2 });
    expect(Math.max(...two.segments.map((s) => s.generation))).toBe(2);
    expect(two.radius).toBe(FAN_CENTRE_RADIUS + 2 * FAN_RING);
  });

  test("a lone mother takes the maternal slot; the paternal arc stays empty", () => {
    const doc = docOf(
      [person("m", "Sara", "", "female"), person("k", "K", "", "male")],
      [union("u", ["m"], ["k"])],
      "m",
    );
    const fan = layoutFan(doc, { focusId: "k", generations: 2 });
    expect(fan.segments.map((s) => [s.personId, s.index])).toEqual([["m", 1]]);
    expect(fan.segments[0]!.startAngle).toBeCloseTo(1.5 * PI, 12);
  });

  test("biological parents first; the focus is not a segment", () => {
    const fan = layoutFan(famAdoption(), { focusId: "k2", generations: 2 });
    expect(fan.segments.map((s) => s.personId)).toEqual(["n1", "n2"]);
  });

  test("someone with only adoptive parents has them in the fan", () => {
    const fan = layoutFan(famAdoptedOnly(), { focusId: "k2", generations: 3 });
    expect(fan.segments.map((s) => [s.personId, s.generation, s.index])).toEqual([
      ["a", 1, 0],
      ["b", 1, 1],
      ["ga", 2, 0],
      ["gb", 2, 1],
    ]);
  });

  test("an unknown focus has no segments", () => {
    const fan = layoutFan(famAdoption(), { focusId: "nobody", generations: 4 });
    expect(fan.segments).toEqual([]);
    expect(fan.generations).toBe(4);
  });
});
