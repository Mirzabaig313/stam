import { afterEach, describe, expect, mock, test } from "bun:test";

import { cleanup, fireEvent, render } from "@testing-library/react";

import { Minimap, minimapTransform } from "@/ui/canvas/Minimap";

afterEach(cleanup);

describe("minimapTransform", () => {
  test("fits the bounds inside 160×120 with padding, centred", () => {
    // 1440 × 360 world → limited by width: (160 - 16) / 1440 = 0.1.
    const m = minimapTransform({ x: -100, y: 0, width: 1440, height: 360 });
    expect(m.scale).toBeCloseTo(0.1, 10);
    expect(m.x).toBeCloseTo(8 + 10, 10);
    expect(m.y).toBeCloseTo((120 - 36) / 2, 10);
  });

  test("survives empty bounds", () => {
    const m = minimapTransform({ x: 0, y: 0, width: 0, height: 0 });
    expect(Number.isFinite(m.scale)).toBe(true);
  });
});

describe("Minimap", () => {
  const nodes = [
    { nodeId: "a", x: 0, y: 0 },
    { nodeId: "b", x: 1260, y: 288 },
  ];
  const bounds = { x: 0, y: 0, width: 1440, height: 360 };

  test("draws every node as a dot and the viewport as a rectangle", () => {
    const { container } = render(
      <Minimap
        nodes={nodes}
        bounds={bounds}
        viewport={{ x: 0, y: 0, k: 1 }}
        screen={{ width: 720, height: 360 }}
        onCenter={() => {}}
      />,
    );
    const dots = container.querySelector(".stam-minimap__dots")!.getAttribute("d")!;
    expect(dots.match(/M/g)).toHaveLength(2);
    const view = container.querySelector(".stam-minimap__view")!;
    expect(Number(view.getAttribute("width"))).toBeCloseTo(72, 6);
    expect(Number(view.getAttribute("height"))).toBeCloseTo(36, 6);
  });

  test("click and drag recentre on the world point under the pointer", () => {
    const onCenter = mock((_p: [number, number]) => {});
    const { container } = render(
      <Minimap
        nodes={nodes}
        bounds={bounds}
        viewport={{ x: 0, y: 0, k: 1 }}
        screen={{ width: 720, height: 360 }}
        onCenter={onCenter}
      />,
    );
    const svg = container.querySelector("svg")!;
    const m = minimapTransform(bounds);
    fireEvent.pointerDown(svg, { clientX: m.x + 72, clientY: m.y + 18, pointerId: 1, button: 0 });
    fireEvent.pointerMove(svg, { clientX: m.x + 144, clientY: m.y + 36, pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: m.x, clientY: m.y, pointerId: 1 });
    expect(onCenter.mock.calls.map(([p]) => p.map((n) => Math.round(n)))).toEqual([
      [720, 180],
      [1440, 360],
    ]);
  });
});
