import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { cleanup, render } from "@testing-library/react";

import { layoutFamily } from "@/core/layout/family";
import { Canvas } from "@/ui/canvas/Canvas";
import { PersonCard } from "@/ui/cards/PersonCard";

import { cardFamily } from "../cards/fixtures";
import { reduceMotion, withI18n } from "../i18n";

const originalRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-canvas")) {
      return DOMRect.fromRect({ x: 0, y: 0, width: 2000, height: 1200 });
    }
    return originalRect.call(this);
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});
beforeEach(() => reduceMotion(true));
afterEach(() => {
  cleanup();
  reduceMotion(false);
});

function cardOf(container: HTMLElement, personId: string): Element {
  const layout = layoutFamily(cardFamily(), { rootId: "ahmed" });
  const nodeId = layout.primaryNode[personId]!;
  const card = container.querySelector(`[data-node-id="${nodeId}"] .stam-card`);
  if (!card) throw new Error(`no card for ${personId}`);
  return card;
}

function renderCanvas() {
  const doc = cardFamily();
  const layout = layoutFamily(doc, { rootId: "ahmed" });
  return render(
    withI18n(
      <Canvas
        doc={doc}
        layout={layout}
        selectedId={null}
        focusMode={false}
        dir="ltr"
        onSelect={() => {}}
        onToggleCollapse={() => {}}
        onViewFamily={() => {}}
        photoUrl={() => undefined}
      />,
    ),
  );
}

describe("card colour data on the canvas", () => {
  test("every card says its gender, generation hue and branch; CSS picks by data-color-mode", () => {
    const { container } = renderCanvas();
    const ali = cardOf(container, "ali");
    expect(ali.getAttribute("data-gender")).toBe("male");
    expect(ali.getAttribute("data-generation")).toBe("1");
    expect(ali.getAttribute("data-branch")).toBe("0");
    expect(cardOf(container, "zainab").getAttribute("data-branch")).toBe("1");
    expect(cardOf(container, "omar").getAttribute("data-branch")).toBe("2");
    // Ali's wife and son wear Ali's branch.
    expect(cardOf(container, "hina").getAttribute("data-branch")).toBe("0");
    expect(cardOf(container, "bilal").getAttribute("data-branch")).toBe("0");
    expect(cardOf(container, "bilal").getAttribute("data-generation")).toBe("2");
    // The root couple has no branch.
    const ahmed = cardOf(container, "ahmed");
    expect(ahmed.hasAttribute("data-branch")).toBe(false);
    expect(ahmed.getAttribute("data-generation")).toBe("0");
    expect(cardOf(container, "sara").getAttribute("data-gender")).toBe("female");
  });
});

describe("PersonCard", () => {
  test("a static (export) card carries the same data", () => {
    const doc = cardFamily();
    const node = layoutFamily(doc, { rootId: "ahmed" }).nodes.find((n) => n.personId === "ali")!;
    const { container } = render(
      withI18n(
        <svg>
          <PersonCard doc={doc} node={node} branch={4} static />
        </svg>,
      ),
    );
    const card = container.querySelector(".stam-card")!;
    expect(card.getAttribute("data-branch")).toBe("4");
    expect(card.getAttribute("data-gender")).toBe("male");
  });
});
