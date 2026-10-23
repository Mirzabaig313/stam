import { afterEach, describe, expect, test } from "bun:test";

import { cleanup, render } from "@testing-library/react";

import { useAnchoredBox } from "@/ui/dnd/PopupMenu";

const originalRect = HTMLElement.prototype.getBoundingClientRect;

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  document.documentElement.removeAttribute("dir");
});

function Box({ at }: { at: [number, number] }) {
  const { ref, style } = useAnchoredBox(at);
  return <div ref={ref} data-testid="box" style={{ position: "fixed", ...style }} />;
}

function placed(at: [number, number]) {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.testid === "box") return DOMRect.fromRect({ width: 200, height: 100 });
    return originalRect.call(this);
  };
  const { getByTestId } = render(<Box at={at} />);
  const box = getByTestId("box");
  return { left: Number.parseFloat(box.style.left), top: Number.parseFloat(box.style.top) };
}

describe("useAnchoredBox", () => {
  test("LTR: the box opens to the right of the point", () => {
    expect(placed([500, 100])).toEqual({ left: 500, top: 100 });
  });

  test("RTL: the box opens to the left of the point, toward the inline end", () => {
    document.documentElement.dir = "rtl";
    expect(placed([500, 100])).toEqual({ left: 300, top: 100 });
  });

  test("RTL near the left edge: kept inside the window", () => {
    document.documentElement.dir = "rtl";
    expect(placed([50, 100]).left).toBe(8);
  });
});
