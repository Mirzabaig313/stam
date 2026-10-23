import { afterEach, describe, expect, mock, test } from "bun:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { layoutFamily } from "@/core/layout/family";
import type { LayoutNode } from "@/core/layout/types";
import type { TreeDocument } from "@/core/model/types";
import { PersonCard, type PersonCardProps } from "@/ui/cards/PersonCard";

import { withI18n } from "../i18n";
import { cardFamily } from "./fixtures";

afterEach(cleanup);

function nodeOf(doc: TreeDocument, nodeId: string): LayoutNode {
  const node = layoutFamily(doc, { rootId: "ahmed" }).nodes.find((n) => n.nodeId === nodeId);
  if (!node) throw new Error(`no node ${nodeId}`);
  return node;
}

function renderCard(nodeId: string, props: Partial<PersonCardProps> = {}, doc = cardFamily()) {
  const node = props.node ?? nodeOf(doc, nodeId);
  return render(
    withI18n(
      <svg>
        <PersonCard doc={doc} node={node} {...props} />
      </svg>,
    ),
  );
}

const yOf = (container: HTMLElement, selector: string) =>
  Number(container.querySelector(selector)?.getAttribute("y"));

function withBirth(doc: TreeDocument, personId: string): TreeDocument {
  const person = { ...doc.persons[personId]!, birth: { date: { year: 1970 } } };
  return { ...doc, persons: { ...doc.persons, [personId]: person } };
}

describe("PersonCard", () => {
  test("card isolates native-script name", () => {
    const { container } = renderCard("ali");
    const native = [...container.querySelectorAll("text")].find(
      (el) => el.textContent === "علی خان",
    );
    expect(native).toBeDefined();
    expect(native!.getAttribute("unicode-bidi")).toBe("isolate");
    const name = [...container.querySelectorAll("text")].find(
      (el) => el.textContent === "Ali Khan",
    );
    expect(name!.getAttribute("unicode-bidi")).toBe("isolate");
  });

  describe("vertical placement of the text lines", () => {
    test("a name with no dates sits on the card's middle line", () => {
      const { container } = renderCard("sara");
      expect(container.querySelector(".stam-card__years")).toBeNull();
      expect(yOf(container, ".stam-card__name")).toBe(36);
      expect(container.querySelector(".stam-card__name")?.getAttribute("dominant-baseline")).toBe(
        "central",
      );
    });

    test("a name with dates keeps the two-line layout", () => {
      const { container } = renderCard("omar", {}, withBirth(cardFamily(), "omar"));
      expect(yOf(container, ".stam-card__name")).toBe(31);
      expect(yOf(container, ".stam-card__years")).toBe(49);
    });

    test("a name and native name with no dates are centred as a pair", () => {
      const doc = cardFamily();
      const sara = { ...doc.persons.sara!, nativeName: "سارہ" };
      const { container } = renderCard("sara", {}, { ...doc, persons: { ...doc.persons, sara } });
      expect(yOf(container, ".stam-card__name")).toBe(31);
      expect(yOf(container, ".stam-card__native")).toBe(47);
    });

    test("name, native name and dates keep the three-line layout", () => {
      const { container } = renderCard("ali");
      expect(yOf(container, ".stam-card__name")).toBe(25);
      expect(yOf(container, ".stam-card__native")).toBe(41);
      expect(yOf(container, ".stam-card__years")).toBe(57);
    });
  });

  test("is a button labelled by describePerson", () => {
    renderCard("ali");
    const card = screen.getByRole("button", {
      name: "Ali Khan, born 1950, son of Ahmed Khan and Sara Khan",
    });
    expect(card.getAttribute("tabindex")).toBe("-1");
  });

  test("is the roving tab stop when tabbable", () => {
    renderCard("ali", { tabbable: true });
    expect(screen.getByRole("button", { name: /^Ali Khan/ }).getAttribute("tabindex")).toBe("0");
  });

  test("deceased card shows † before the death year and the deceased treatment", () => {
    const { container } = renderCard("zainab");
    const years = container.querySelector(".stam-card__years");
    expect(years?.textContent).toBe("1953 – †2019");
    expect(container.querySelector(".stam-card")!.classList).toContain("stam-card--deceased");
  });

  test("living card shows the birth year only and no deceased treatment", () => {
    const { container } = renderCard("ali");
    expect(container.querySelector(".stam-card__years")?.textContent).toBe("1950");
    expect(container.querySelector(".stam-card")!.classList).not.toContain("stam-card--deceased");
  });

  test("placeholder shows 'Unknown mother' in the muted italic style with a dashed border", () => {
    const doc = cardFamily();
    const node: LayoutNode = {
      ...nodeOf(doc, "ali"),
      nodeId: "unknownMom",
      personId: "unknownMom",
    };
    const { container } = renderCard("unknownMom", { node }, doc);
    const label = container.querySelector(".stam-card__name");
    expect(label?.textContent).toBe("Unknown mother");
    expect(label?.classList).toContain("stam-card__name--placeholder");
    expect(container.querySelector(".stam-card")!.classList).toContain("stam-card--placeholder");
  });

  test("gender glyph is hidden from assistive technology", () => {
    const { container } = renderCard("ali");
    const glyph = container.querySelector(".stam-card__gender");
    expect(glyph?.textContent).toBe("♂");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
  });

  test("selected card gets the selection outline", () => {
    const { container } = renderCard("ali", { selected: true });
    expect(container.querySelector(".stam-card")!.classList).toContain("stam-card--selected");
    expect(container.querySelector(".stam-card")!.getAttribute("aria-current")).toBe("true");
  });

  test("click and Enter select the person", () => {
    const onSelect = mock((_id: string) => {});
    renderCard("ali", { onSelect });
    const card = screen.getByRole("button", { name: /^Ali Khan/ });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onSelect.mock.calls).toEqual([["ali"], ["ali"], ["ali"]]);
  });

  test("collapse chevron shows when the person has children and toggles collapse", () => {
    const onToggleCollapse = mock((_id: string) => {});
    renderCard("ali", { onToggleCollapse });
    const chevron = screen.getByRole("button", { name: "Collapse the branch of Ali Khan" });
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chevron);
    expect(onToggleCollapse.mock.calls).toEqual([["ali"]]);
  });

  test("collapsed card shows the +N badge and an expand chevron", () => {
    const doc = cardFamily();
    const node: LayoutNode = { ...nodeOf(doc, "ali"), hiddenCount: 12 };
    const { container } = renderCard("ali", { node, collapsed: true }, doc);
    expect(container.querySelector(".stam-card__badge")?.textContent).toBe("+12");
    const chevron = screen.getByRole("button", { name: "Expand the branch of Ali Khan" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /12 hidden descendants$/ })).toBeDefined();
  });

  test("no chevron and no badge on a person without children", () => {
    const { container } = renderCard("zainab");
    expect(screen.queryByRole("button", { name: /branch of/ })).toBeNull();
    expect(container.querySelector(".stam-card__badge")).toBeNull();
  });

  test("spouse with biological parents shows 'View family', which opens the topmost ancestor", () => {
    const onViewFamily = mock((_id: string) => {});
    renderCard("hina", { onViewFamily });
    const button = screen.getByRole("button", { name: "View the family of Hina Raza" });
    expect(button.textContent).toBe("↑ View family");
    fireEvent.click(button);
    expect(onViewFamily.mock.calls).toEqual([["imran"]]);
  });

  test("no 'View family' on a spouse without parents or on a blood relative", () => {
    renderCard("sara");
    expect(screen.queryByRole("button", { name: /View the family/ })).toBeNull();
    cleanup();
    renderCard("ali");
    expect(screen.queryByRole("button", { name: /View the family/ })).toBeNull();
  });

  test("linked copy has a dashed outline and a 'see original' link", () => {
    const doc = cardFamily();
    const node: LayoutNode = { ...nodeOf(doc, "zainab"), nodeId: "zainab~1", kind: "linked" };
    const onSeeOriginal = mock((_id: string) => {});
    const { container } = renderCard("zainab~1", { node, onSeeOriginal }, doc);
    expect(container.querySelector(".stam-card")!.classList).toContain("stam-card--linked");
    const link = screen.getByRole("link", { name: "Go to the original card of Zainab Khan" });
    expect(link.textContent).toBe("see original →");
    fireEvent.click(link);
    expect(onSeeOriginal.mock.calls).toEqual([["zainab"]]);
    expect(screen.getByRole("button", { name: /linked copy$/ })).toBeDefined();
  });

  test("shows the photo when a URL is given, initials otherwise", () => {
    const { container } = renderCard("ali", { photoUrl: "blob:photo-1" });
    expect(container.querySelector("image")?.getAttribute("href")).toBe("blob:photo-1");
    cleanup();
    const plain = renderCard("ali");
    expect(plain.container.querySelector("image")).toBeNull();
    expect(plain.container.querySelector(".stam-card__initials")?.textContent).toBe("AK");
  });

  test("'name' detail drops the avatar and years; 'dot' keeps only a dot", () => {
    const named = renderCard("ali", { lod: "name" });
    expect(named.container.querySelector(".stam-card__name")?.textContent).toBe("Ali Khan");
    expect(named.container.querySelector(".stam-card__years")).toBeNull();
    expect(named.container.querySelector(".stam-card__avatar")).toBeNull();
    cleanup();
    const dot = renderCard("ali", { lod: "dot" });
    expect(dot.container.querySelector("text")).toBeNull();
    expect(dot.container.querySelector("circle.stam-card__dot")).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Ali Khan, born 1950/ })).toBeDefined();
  });

  test("forwards pointer-down and context-menu with the node", () => {
    const onPointerDown = mock((_n: LayoutNode, _e: unknown) => {});
    const onContextMenu = mock((_n: LayoutNode, _e: unknown) => {});
    renderCard("ali", { onPointerDown, onContextMenu });
    const card = screen.getByRole("button", { name: /^Ali Khan/ });
    fireEvent.pointerDown(card);
    fireEvent.contextMenu(card);
    expect(onPointerDown.mock.calls[0]![0].nodeId).toBe("ali");
    expect(onContextMenu.mock.calls[0]![0].nodeId).toBe("ali");
  });

  test("is placed at the node position and dimmed in focus mode", () => {
    const doc = cardFamily();
    const node: LayoutNode = { ...nodeOf(doc, "ali"), x: 120, y: 336 };
    const { container } = renderCard("ali", { node, dimmed: true }, doc);
    const root = container.querySelector("[data-node-id='ali']")!;
    expect(root.getAttribute("transform")).toBe("translate(120 336)");
    expect(root.classList).toContain("stam-node--dimmed");
  });

  describe("static (exports)", () => {
    test("draws the card without interaction, controls or hover and focus shapes", () => {
      const { container } = renderCard("ali", { static: true });
      expect(container.querySelector("[role]")).toBeNull();
      expect(container.querySelector("[tabindex]")).toBeNull();
      expect(container.querySelector("[aria-label]")).toBeNull();
      expect(container.querySelector(".stam-card__control")).toBeNull();
      expect(container.querySelector(".stam-card__focus")).toBeNull();
      expect(container.querySelector(".stam-card__lift")).toBeNull();
      expect(container.querySelector(".stam-card__bg")).not.toBeNull();
      expect(container.querySelector(".stam-card__name")?.textContent).toBe("Ali Khan");
    });

    test("marks the card with its person id and leaves the drawn text readable", () => {
      const { container } = renderCard("hina", { static: true });
      const root = container.querySelector("[data-node-id]")!;
      expect(root.getAttribute("data-person-id")).toBe("hina");
      expect(container.querySelector(".stam-card__decor")?.getAttribute("aria-hidden")).toBeNull();
      expect(container.querySelector(".stam-card__family")).toBeNull();
    });

    test("a linked copy has no 'see original' line, so a lone name sits on the middle", () => {
      const doc = cardFamily();
      const node: LayoutNode = { ...nodeOf(doc, "sara"), nodeId: "sara~1", kind: "linked" };
      const { container } = renderCard("sara", { node, static: true }, doc);
      expect(container.querySelector(".stam-card__link")).toBeNull();
      expect(yOf(container, ".stam-card__name")).toBe(36);
    });

    test("draws the gender mark as a path, so exports need no font with ♂ or ♀", () => {
      for (const [id, gender] of [
        ["ali", "male"],
        ["hina", "female"],
      ] as const) {
        const { container, unmount } = renderCard(id, { static: true });
        expect(container.querySelector("text.stam-card__gender")).toBeNull();
        expect(container.textContent).not.toMatch(/[♂♀]/);
        const mark = container.querySelector("path.stam-card__gender-mark");
        expect(mark?.getAttribute("data-gender")).toBe(gender);
        expect(mark?.getAttribute("d")).toMatch(/^M[\d.\s-]+a/);
        unmount();
      }
    });

    test("the editor card has no person id attribute", () => {
      const { container } = renderCard("ali");
      expect(container.querySelector("[data-person-id]")).toBeNull();
    });
  });
});
