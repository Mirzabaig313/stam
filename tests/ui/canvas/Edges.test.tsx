import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render } from "@testing-library/react";

import type { LayoutEdge } from "@/core/layout/types";
import { Edges, edgeStyle, offsetPolyline } from "@/ui/canvas/Edges";

afterEach(cleanup);

const unionEdge = (status: LayoutEdge["status"]): LayoutEdge => ({
  id: `union:${status}`,
  kind: "union",
  unionId: "u",
  status,
  points: [
    [180, 36],
    [212, 36],
  ],
});

const childEdge = (childType: LayoutEdge["childType"]): LayoutEdge => ({
  id: `child:u:${childType}`,
  kind: "child",
  unionId: "u",
  childType,
  points: [
    [196, 36],
    [196, 96],
    [90, 96],
    [90, 168],
  ],
});

function paths(edges: LayoutEdge[], lod: "full" | "name" | "dot" = "full") {
  const { container } = render(
    <svg>
      <Edges edges={edges} lod={lod} />
    </svg>,
  );
  return [...container.querySelectorAll("path")];
}

describe("edgeStyle", () => {
  test("married and widowed unions are double, partner and engaged single, divorced dashed", () => {
    expect(edgeStyle(unionEdge("married"))).toEqual({ double: true, dash: undefined });
    expect(edgeStyle(unionEdge("widowed"))).toEqual({ double: true, dash: undefined });
    expect(edgeStyle(unionEdge("partner"))).toEqual({ double: false, dash: undefined });
    expect(edgeStyle(unionEdge("engaged"))).toEqual({ double: false, dash: undefined });
    expect(edgeStyle(unionEdge("divorced"))).toEqual({ double: false, dash: "6 4" });
    expect(edgeStyle(unionEdge("separated"))).toEqual({ double: false, dash: "6 4" });
  });

  test("biological child lines are solid; adopted, foster and step are dotted", () => {
    expect(edgeStyle(childEdge("biological"))).toEqual({ double: false, dash: undefined });
    for (const type of ["adopted", "foster", "step"] as const) {
      expect(edgeStyle(childEdge(type))).toEqual({ double: false, dash: "2 3" });
    }
  });
});

describe("offsetPolyline", () => {
  test("shifts a horizontal line to either side", () => {
    const line: [number, number][] = [
      [0, 10],
      [100, 10],
    ];
    expect(offsetPolyline(line, 1.5)).toEqual([
      [0, 11.5],
      [100, 11.5],
    ]);
    expect(offsetPolyline(line, -1.5)).toEqual([
      [0, 8.5],
      [100, 8.5],
    ]);
  });

  test("keeps right-angle corners mitred, so the two lines stay 3 px apart", () => {
    // A bracket: up, across, down.
    const bracket: [number, number][] = [
      [0, 100],
      [0, 80],
      [50, 80],
      [50, 100],
    ];
    const outer = offsetPolyline(bracket, -1.5);
    const inner = offsetPolyline(bracket, 1.5);
    expect(outer).toEqual([
      [-1.5, 100],
      [-1.5, 78.5],
      [51.5, 78.5],
      [51.5, 100],
    ]);
    expect(inner).toEqual([
      [1.5, 100],
      [1.5, 81.5],
      [48.5, 81.5],
      [48.5, 100],
    ]);
  });

  test("ignores zero-length segments", () => {
    const pts: [number, number][] = [
      [0, 0],
      [0, 0],
      [10, 0],
    ];
    expect(offsetPolyline(pts, 1)).toEqual([
      [0, 1],
      [10, 1],
    ]);
  });
});

describe("Edges", () => {
  test("a married union draws two parallel 1.5 px lines 3 px apart", () => {
    const drawn = paths([unionEdge("married")]);
    expect(drawn).toHaveLength(2);
    expect(drawn.map((p) => p.getAttribute("d"))).toEqual([
      "M180 34.5L212 34.5",
      "M180 37.5L212 37.5",
    ]);
    for (const p of drawn) expect(p.getAttribute("stroke-width")).toBe("1.5");
  });

  test("a partner union draws one solid line; divorced is dashed 6 4", () => {
    const [partner] = paths([unionEdge("partner")]);
    expect(partner!.getAttribute("stroke-dasharray")).toBeNull();
    cleanup();
    const [divorced] = paths([unionEdge("divorced")]);
    expect(divorced!.getAttribute("stroke-dasharray")).toBe("6 4");
  });

  test("an adopted child line is dotted 2 3 and follows the routed points", () => {
    const [line] = paths([childEdge("adopted")]);
    expect(line!.getAttribute("stroke-dasharray")).toBe("2 3");
    expect(line!.getAttribute("d")).toBe("M196 36L196 96L90 96L90 168");
  });

  test("below full detail, lines keep a 1 px screen width and married unions turn single", () => {
    const drawn = paths([unionEdge("married")], "dot");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(drawn[0]!.getAttribute("stroke-width")).toBe("1");
  });

  test("dims edges listed in dimmedIds", () => {
    const { container } = render(
      <svg>
        <Edges
          edges={[unionEdge("partner"), childEdge("biological")]}
          lod="full"
          dimmedIds={new Set(["union:partner"])}
        />
      </svg>,
    );
    const dimmed = container.querySelectorAll(".stam-edge--dimmed");
    expect(dimmed).toHaveLength(1);
    expect(dimmed[0]!.getAttribute("data-edge-id")).toBe("union:partner");
  });
});
