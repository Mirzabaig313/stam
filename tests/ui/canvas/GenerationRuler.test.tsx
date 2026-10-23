import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render } from "@testing-library/react";

import { GenerationRuler, rowsOf, toRoman } from "@/ui/canvas/GenerationRuler";

afterEach(cleanup);

describe("toRoman", () => {
  test("writes generation numbers as Roman numerals", () => {
    expect([1, 2, 3, 4, 5, 9, 10, 14, 40, 49, 90, 400, 1994].map(toRoman)).toEqual([
      "I",
      "II",
      "III",
      "IV",
      "V",
      "IX",
      "X",
      "XIV",
      "XL",
      "XLIX",
      "XC",
      "CD",
      "MCMXCIV",
    ]);
  });
});

describe("rowsOf", () => {
  test("gives one row per generation with its top y, in order", () => {
    const nodes = [
      { generation: 1, y: 168 },
      { generation: 0, y: 0 },
      { generation: 1, y: 168 },
      { generation: 2, y: 336 },
    ];
    expect(rowsOf(nodes)).toEqual([
      { generation: 0, y: 0 },
      { generation: 1, y: 168 },
      { generation: 2, y: 336 },
    ]);
  });
});

describe("GenerationRuler", () => {
  test("labels each row I, II, III at the row's vertical centre on screen", () => {
    const rows = [
      { generation: 0, y: 0 },
      { generation: 1, y: 168 },
      { generation: 2, y: 336 },
    ];
    const { container } = render(
      <GenerationRuler rows={rows} viewport={{ x: 500, y: 20, k: 0.5 }} height={600} />,
    );
    const labels = [...container.querySelectorAll(".stam-ruler__label")];
    expect(labels.map((l) => l.textContent)).toEqual(["I", "II", "III"]);
    // Row centre = (y + CARD_H / 2) * k + viewport.y; horizontal pan does not move the ruler.
    expect(labels.map((l) => (l as HTMLElement).style.transform)).toEqual([
      "translateY(38px)",
      "translateY(122px)",
      "translateY(206px)",
    ]);
  });

  test("counts from the top row, so ancestor views (negative generations) read I, II, III", () => {
    const rows = [
      { generation: -2, y: 0 },
      { generation: -1, y: 168 },
      { generation: 0, y: 336 },
    ];
    const { container } = render(
      <GenerationRuler rows={rows} viewport={{ x: 0, y: 0, k: 0.5 }} height={600} />,
    );
    const labels = [...container.querySelectorAll(".stam-ruler__label")];
    expect(labels.map((l) => l.textContent)).toEqual(["I", "II", "III"]);
  });

  test("leaves out rows that are off screen and highlights the active generation", () => {
    const rows = [
      { generation: 0, y: 0 },
      { generation: 1, y: 168 },
    ];
    const { container } = render(
      <GenerationRuler
        rows={rows}
        viewport={{ x: 0, y: -150, k: 1 }}
        height={400}
        activeGeneration={1}
      />,
    );
    const labels = [...container.querySelectorAll(".stam-ruler__label")];
    expect(labels.map((l) => l.textContent)).toEqual(["II"]);
    expect(labels[0]!.classList).toContain("stam-ruler__label--active");
  });
});
