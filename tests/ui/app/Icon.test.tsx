import { afterEach, expect, test } from "bun:test";

import { cleanup, render } from "@testing-library/react";

import { Icon, type IconName } from "@/ui/app/Icon";

afterEach(cleanup);

const mirrored = (name: IconName) => {
  const { container } = render(<Icon name={name} />);
  const flips = container.querySelector("svg")!.classList.contains("icon--mirror");
  cleanup();
  return flips;
};

test("icons that point along the reading direction mirror in RTL; the rest never do", () => {
  for (const name of ["undo", "redo", "viewDescendants", "viewTimeline"] as const) {
    expect(mirrored(name)).toBe(true);
  }
  for (const name of ["zoomIn", "zoomOut", "fit", "search", "close", "menu", "viewFan"] as const) {
    expect(mirrored(name)).toBe(false);
  }
});
