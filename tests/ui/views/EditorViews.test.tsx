import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useImperativeHandle } from "react";
import { Route, Routes } from "react-router";

import type { Relationship } from "@/core/kinship/types";
import { layoutFamily } from "@/core/layout/family";
import type { FanLayout, TimelineLayout } from "@/core/views/types";
import { EditorPage, type EditorPageProps } from "@/ui/app/EditorPage";
import type { KinshipFns } from "@/ui/kinship/explain";
import type { ViewLayoutFns } from "@/ui/store/viewLayouts";
import type { ViewRenderers } from "@/ui/views/renderers";
import type { ViewHandle } from "@/ui/views/useViewCamera";

import { makeEditorEnv } from "../../fixtures/editorEnv";
import { docOf, famSimple, person, union } from "../../fixtures/families";
import { renderApp } from "../../fixtures/renderApp";
import { reduceMotion } from "../i18n";

const SCREEN = { width: 1600, height: 1000 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("stam-canvas")) return DOMRect.fromRect({ x: 0, y: 0, ...SCREEN });
    return originalRect.call(this);
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});

type Env = Awaited<ReturnType<typeof makeEditorEnv>>;
let env: Env;
let layoutCalls: string[];

beforeEach(async () => {
  env = await makeEditorEnv();
  layoutCalls = [];
  viewCalls = [];
  relateCalls = 0;
  Object.defineProperty(navigator, "storage", { value: {}, configurable: true });
  reduceMotion(true);
});
afterEach(() => {
  cleanup();
  reduceMotion(false);
});

const FAN = { segments: [], radius: 100, generations: 5 };
const TIMELINE: TimelineLayout = {
  bars: [],
  minYear: 1900,
  maxYear: 2000,
  rows: 0,
  generationRows: [],
};

const layouts: ViewLayoutFns = {
  family: layoutFamily,
  pedigree: (doc, o) => (
    layoutCalls.push(`pedigree:${o.focusId}`),
    layoutFamily(doc, { rootId: o.focusId })
  ),
  descendants: (doc, o) => (
    layoutCalls.push(`descendants:${o.rootId}`),
    layoutFamily(doc, { rootId: o.rootId })
  ),
  hourglass: (doc, o) => (
    layoutCalls.push(`hourglass:${o.focusId}`),
    layoutFamily(doc, { rootId: o.focusId })
  ),
  fan: (_doc, o): FanLayout => (
    layoutCalls.push(`fan:${o.focusId}`),
    { ...FAN, focusId: o.focusId }
  ),
  timeline: () => (layoutCalls.push("timeline"), TIMELINE),
};

/** What the toolbar and search asked the fan or timeline to do, through its handle. */
let viewCalls: string[] = [];
const handle = (): ViewHandle => ({
  zoomIn: () => viewCalls.push("zoomIn"),
  zoomOut: () => viewCalls.push("zoomOut"),
  fit: () => viewCalls.push("fit"),
  centerOnPerson: (id) => viewCalls.push(`center:${id}`),
});

const renderers: ViewRenderers = {
  FanChart: ({ layout, onSelect, onFocus, ref }) => (
    useImperativeHandle(ref, handle),
    (
      <div data-testid="fan">
        <span>fan of {layout.focusId}</span>
        <button type="button" onClick={() => onSelect("c3")}>
          pick c3
        </button>
        <button type="button" onClick={() => onFocus("c2")}>
          focus c2
        </button>
      </div>
    )
  ),
  Timeline: ({ ref }) => (useImperativeHandle(ref, handle), (<div data-testid="timeline" />)),
};

const rel = (a: string, b: string, kind: Relationship["kind"] = "sibling"): Relationship => ({
  kind,
  greats: 0,
  half: false,
  sexOfA: "male",
  path: [a, "dad", b],
});
let relateCalls = 0;
const MANY: Relationship["kind"][] = ["sibling", "cousin", "auncle", "nibling", "grandparent"];
const kinship: KinshipFns = {
  relate: (_doc, a, b) => {
    relateCalls++;
    if (a === "c1" && b === "c3") return [];
    if (a === "c2" && b === "c3") return MANY.map((kind) => rel(a, b, kind));
    return [rel(a, b), rel(a, b, "cousin")];
  },
  describeRelationship: (r, a, b) => `${a} is ${b}'s ${r.kind}`,
  urduTerm: (r) => (r.kind === "sibling" ? "بھائی" : null),
};

const TODAY = new Date(2026, 9, 23, 12);

async function openEditor(extra: Partial<EditorPageProps> = {}, doc = famSimple()) {
  await env.repo.saveTree({ ...doc, id: "t1" });
  const view = renderApp(
    <Routes>
      <Route
        path="/app/t/:treeId"
        element={
          <EditorPage
            layouts={layouts}
            renderers={renderers}
            kinship={kinship}
            today={() => TODAY}
            {...extra}
          />
        }
      />
    </Routes>,
    { repo: env.repo, route: "/app/t/t1" },
  );
  await screen.findByRole("group", { name: "View" });
  return { ...view, user: userEvent.setup() };
}

const card = (id: string) =>
  document.querySelector(`[data-node-id="${id}"] > .stam-card`) as Element;
const pressed = () =>
  within(screen.getByRole("group", { name: "View" }))
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);
const altDigit = (n: number) =>
  fireEvent.keyDown(document.body, { key: "x", code: `Digit${n}`, altKey: true });

/** Matches a whole relationship sentence, whose names are separate `<bdi>` elements. */
const sentence = (text: string) => (_: string, el: Element | null) =>
  el?.classList.contains("relation-sentence") === true && el.textContent === text;

function dimmed() {
  return [...document.querySelectorAll(".stam-node--dimmed")].map((n) =>
    n.getAttribute("data-node-id"),
  );
}

describe("view switcher", () => {
  test("lists the six views, family pressed, and switches by click", async () => {
    const { user } = await openEditor();
    const buttons = within(screen.getByRole("group", { name: "View" })).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Family",
      "Pedigree",
      "Descendants",
      "Hourglass",
      "Fan",
      "Timeline",
    ]);
    expect(pressed()).toEqual(["Family"]);
    await user.click(screen.getByRole("button", { name: /^Hourglass/ }));
    expect(pressed()).toEqual(["Hourglass"]);
    expect(layoutCalls).toEqual(["hourglass:dad"]);
  });

  test("Alt+1 … Alt+6 switch the view, by key code", async () => {
    await openEditor();
    const order = ["Family", "Pedigree", "Descendants", "Hourglass", "Fan", "Timeline"];
    for (const n of [3, 5, 6, 2, 1, 4]) {
      act(() => altDigit(n));
      expect(pressed()).toEqual([order[n - 1]!]);
    }
  });

  test("Alt+digit is left alone while typing in a field", async () => {
    await openEditor();
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "x", code: "Digit2", altKey: true });
    expect(pressed()).toEqual(["Family"]);
    field.remove();
  });

  test("entering a focus view focuses the selected person; moving between focus views keeps it", async () => {
    const { user } = await openEditor();
    expect(screen.queryByText(/^Focus:/)).toBeNull();
    await user.click(card("c2"));
    await user.click(screen.getByRole("button", { name: /^Pedigree/ }));
    expect(screen.getByText(/Focus:/).textContent).toBe("Focus: Zainab Khan");
    expect(layoutCalls).toEqual(["pedigree:c2"]);
    await user.click(screen.getByRole("button", { name: /^Descendants/ }));
    expect(screen.getByText(/Focus:/).textContent).toBe("Focus: Zainab Khan");
    await user.click(screen.getByRole("button", { name: /^Family/ }));
    expect(screen.queryByText(/^Focus:/)).toBeNull();
  });

  test("the focus button offers the selected person and moves the focus to them", async () => {
    const { user } = await openEditor();
    await user.click(screen.getByRole("button", { name: /^Hourglass/ }));
    expect(screen.getByText(/Focus:/).textContent).toBe("Focus: Ahmed Khan");
    expect(screen.queryByRole("button", { name: /^Focus on/ })).toBeNull();
    await user.click(card("c1"));
    layoutCalls = [];
    await user.click(screen.getByRole("button", { name: "Focus on Ali Khan" }));
    expect(screen.getByText(/Focus:/).textContent).toBe("Focus: Ali Khan");
    expect(layoutCalls).toEqual(["hourglass:c1"]);
    expect(screen.queryByRole("button", { name: /^Focus on/ })).toBeNull();
  });
});

describe("fan and timeline", () => {
  test("draw their own renderer, with no tree canvas, and Alt+1 returns to the tree", async () => {
    await openEditor();
    act(() => altDigit(5));
    expect(screen.getByTestId("fan").textContent).toContain("fan of dad");
    expect(document.querySelector(".stam-canvas")).toBeNull();
    act(() => altDigit(6));
    expect(screen.getByTestId("timeline")).toBeTruthy();
    act(() => altDigit(1));
    expect(document.querySelector(".stam-canvas")).not.toBeNull();
    expect(screen.queryByTestId("timeline")).toBeNull();
  });

  test("selecting works and the panel is read-only; undo is off", async () => {
    const { user } = await openEditor();
    act(() => altDigit(5));
    await user.click(screen.getByRole("button", { name: "pick c3" }));
    const name = await screen.findByLabelText("First name");
    expect(name.closest("[inert]")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test.each([5, 6])("the toolbar zooms and fits the view (Alt+%i)", async (n) => {
    const { user } = await openEditor();
    act(() => altDigit(n));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: /^Fit/ }));
    expect(viewCalls).toEqual(["zoomIn", "zoomOut", "fit"]);
  });

  test("search centres the person in the timeline", async () => {
    const { user } = await openEditor();
    act(() => altDigit(6));
    await user.click(screen.getByRole("button", { name: "Search people" }));
    await user.type(screen.getByRole("searchbox"), "Zainab{Enter}");
    expect(viewCalls).toEqual(["center:c2"]);
    expect(await screen.findByLabelText("First name")).toBeTruthy();
  });

  test("search in the fan centres a person in it, else makes them the focus first", async () => {
    const { user } = await openEditor();
    act(() => altDigit(5));
    await user.click(screen.getByRole("button", { name: "Search people" }));
    await user.type(screen.getByRole("searchbox"), "Omar{Enter}");
    // The fake fan draws only its focus: Omar becomes the focus, then is centred.
    expect(screen.getByTestId("fan").textContent).toContain("fan of c3");
    expect(viewCalls).toEqual(["center:c3"]);
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });

  test("the birthdays panel shows a person in the fan", async () => {
    const doc = famSimple();
    doc.persons.c2 = { ...doc.persons.c2!, birth: { date: { year: 1983, month: 10, day: 25 } } };
    const { user } = await openEditor({}, doc);
    act(() => altDigit(5));
    await user.click(screen.getByRole("button", { name: /^Birthdays/ }));
    await user.click(screen.getByRole("button", { name: /^Show Zainab Khan/ }));
    expect(viewCalls).toEqual(["center:c2"]);
  });

  test("the renderer's focus request moves the focus", async () => {
    const { user } = await openEditor();
    act(() => altDigit(5));
    await user.click(screen.getByRole("button", { name: "focus c2" }));
    expect(screen.getByTestId("fan").textContent).toContain("fan of c2");
  });

  test("Delete does nothing and the delete dialog never opens", async () => {
    await openEditor();
    act(() => altDigit(5));
    fireEvent.click(screen.getByRole("button", { name: "pick c3" }));
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  test("the export dialog says fan and timeline can't be exported yet", async () => {
    await openEditor();
    act(() => altDigit(6));
    fireEvent.keyDown(document.body, { key: "e", ctrlKey: true });
    expect(await screen.findByText(/can't be exported yet/)).toBeTruthy();
  });

  test("the tree-shaped views stay editable, with the handles the view can draw", async () => {
    const { user } = await openEditor();
    await user.click(screen.getByRole("button", { name: /^Pedigree/ }));
    fireEvent.pointerOver(card("dad"));
    expect(screen.getByRole("button", { name: "Add parent of Ahmed Khan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add child of Ahmed Khan" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Descendants/ }));
    fireEvent.pointerOver(card("dad"));
    expect(screen.getByRole("button", { name: "Add child of Ahmed Khan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add parent of Ahmed Khan" })).toBeNull();
  });

  test("View family on a card in a focus view moves the focus, not the family view's root", async () => {
    const doc = docOf(
      [
        ...Object.values(famSimple().persons),
        person("gp", "Gul", "Shah", "male"),
        person("sp", "Hina", "Shah", "female"),
      ],
      [
        ...Object.values(famSimple().unions),
        union("ugp", ["gp"], ["sp"]),
        union("usp", ["c1", "sp"]),
      ],
      "dad",
    );
    const { user } = await openEditor({}, doc);
    await user.click(card("c1"));
    await user.click(screen.getByRole("button", { name: /^Descendants/ }));
    layoutCalls = [];
    await user.click(screen.getByRole("button", { name: "View the family of Hina Shah" }));
    expect(layoutCalls).toEqual(["descendants:gp"]);
    await user.click(screen.getByRole("button", { name: /^Family/ }));
    expect(card("dad")).toBeTruthy();
  });

  test("fan and timeline offer no add handles", async () => {
    await openEditor();
    fireEvent.pointerOver(card("dad"));
    expect(screen.getByRole("button", { name: "Add child of Ahmed Khan" })).toBeTruthy();
    act(() => altDigit(5));
    expect(screen.queryByRole("button", { name: /^Add child/ })).toBeNull();
  });
});

describe("relationship calculator", () => {
  test("Shift+click a second card opens the panel with every sentence and the Urdu term", async () => {
    const { user } = await openEditor();
    await user.click(card("c1"));
    fireEvent.click(card("c2"), { shiftKey: true });
    const panel = await screen.findByRole("complementary", { name: "How are we related?" });
    const items = within(panel).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".relation-sentence")?.textContent)).toEqual([
      "Ali Khan is Zainab Khan's sibling",
      "Ali Khan is Zainab Khan's cousin",
    ]);
    expect(items[0]?.textContent).toContain("In Urdu: بھائی");
    expect(items[1]?.textContent).not.toContain("In Urdu");
    // The selection did not move.
    expect(card("c1").getAttribute("aria-current")).toBe("true");
  });

  test("the path is highlighted: its people stay, the rest dim; Esc clears it and closes the panel", async () => {
    const { user } = await openEditor();
    await user.click(card("c1"));
    fireEvent.click(card("c2"), { shiftKey: true });
    await screen.findByRole("complementary", { name: "How are we related?" });
    expect(dimmed().toSorted()).toEqual(["c3", "mom"]);
    expect(document.querySelector(".stam-edges--path")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "How are we related?" })).toBeNull();
    expect(dimmed()).toEqual([]);
    // The selection survives the first Escape and goes with the second.
    expect(card("c1").getAttribute("aria-current")).toBe("true");
  });

  test("with nothing selected, Shift+click starts the pair", async () => {
    await openEditor();
    fireEvent.click(card("c1"), { shiftKey: true });
    const panel = await screen.findByRole("complementary", { name: "How are we related?" });
    expect(within(panel).getByRole("button", { name: /First person: Ali Khan/ })).toBeTruthy();
    expect(within(panel).getByText(/Choose two people/)).toBeTruthy();
    fireEvent.click(card("c2"), { shiftKey: true });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
  });

  test("the toolbar button opens it with the selection; the pickers choose people", async () => {
    const { user } = await openEditor();
    await user.click(card("c1"));
    await user.click(screen.getByRole("button", { name: "How are we related?" }));
    const panel = await screen.findByRole("complementary", { name: "How are we related?" });
    await user.click(within(panel).getByRole("button", { name: /Second person/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("searchbox"), "Zainab");
    await user.click(within(dialog).getByRole("button", { name: /Zainab Khan/ }));
    await waitFor(() => expect(within(panel).getAllByRole("listitem")).toHaveLength(2));
    expect(within(panel).getByText(sentence("Ali Khan is Zainab Khan's sibling"))).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Swap people" }));
    expect(
      await within(panel).findByText(sentence("Zainab Khan is Ali Khan's sibling")),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "How are we related?" })).toBeNull();
  });

  test("unrelated people, and the same person twice, are said plainly", async () => {
    const { user } = await openEditor();
    await user.click(card("c1"));
    fireEvent.click(card("c3"), { shiftKey: true }); // the fake says: unrelated
    const panel = await screen.findByRole("complementary", { name: "How are we related?" });
    expect(
      within(panel).getByText("Ali Khan and Omar Khan aren't related in this tree."),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Swap people" }));
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
  });

  test('the closest three show; the rest wait behind "N more distant…"', async () => {
    const { user } = await openEditor();
    await user.click(card("c2"));
    fireEvent.click(card("c3"), { shiftKey: true });
    const panel = await screen.findByRole("complementary", { name: "How are we related?" });
    const sentences = () =>
      within(panel)
        .getAllByRole("listitem")
        .map((li) => li.querySelector(".relation-sentence")?.textContent);
    expect(sentences()).toEqual([
      "Zainab Khan is Omar Khan's sibling",
      "Zainab Khan is Omar Khan's cousin",
      "Zainab Khan is Omar Khan's auncle",
    ]);
    await user.click(within(panel).getByRole("button", { name: "2 more distant…" }));
    expect(sentences()).toHaveLength(5);
    expect(within(panel).queryByRole("button", { name: /more distant/ })).toBeNull();
  });

  test("results are announced politely and names are isolated", async () => {
    const { user } = await openEditor();
    await user.click(card("c1"));
    fireEvent.click(card("c2"), { shiftKey: true });
    const panel = await screen.findByRole("complementary", { name: "How are we related?" });
    const list = within(panel).getByRole("list", { name: "Relationships" });
    expect(list.closest('[aria-live="polite"]')).not.toBeNull();
    const names = [...list.querySelectorAll(".relation-sentence bdi")].map((b) => b.textContent);
    expect(names.slice(0, 2)).toEqual(["Ali Khan", "Zainab Khan"]);
  });

  test("an edit that changes no one's family does not work the relationships out again", async () => {
    const { user } = await openEditor();
    await user.click(card("c1"));
    fireEvent.click(card("c2"), { shiftKey: true });
    await screen.findByRole("complementary", { name: "How are we related?" });
    const before = relateCalls;
    await user.click(screen.getByRole("button", { name: /^Rename tree/ }));
    await user.keyboard("{Control>}a{/Control}Shahs{Enter}");
    expect(screen.getByRole("button", { name: /^Rename tree/ }).textContent).toBe("Shahs");
    expect(relateCalls).toBe(before);
  });

  test("a calculator that throws shows an error, not a crash", async () => {
    const broken: KinshipFns = {
      ...kinship,
      relate: () => {
        throw new Error("not built yet");
      },
    };
    await openEditor({ kinship: broken });
    fireEvent.click(card("c1"), { shiftKey: true });
    fireEvent.click(card("c2"), { shiftKey: true });
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

function withBirthdays() {
  const doc = famSimple();
  doc.persons.c2 = { ...doc.persons.c2!, birth: { date: { year: 1983, month: 10, day: 25 } } };
  doc.persons.c3 = { ...doc.persons.c3!, birth: { date: { year: 1990, month: 11, day: 20 } } };
  doc.persons.c1 = { ...doc.persons.c1!, birth: { date: { year: 1980, month: 10, day: 23 } } };
  return doc;
}

describe("birthdays", () => {
  test("the badge counts the next 7 days; the panel lists name, date, age and distance", async () => {
    const { user } = await openEditor({}, withBirthdays());
    const button = screen.getByRole("button", { name: "Birthdays: 2 in the next 7 days" });
    expect(button.textContent).toBe("2");
    await user.click(button);
    const rows = within(screen.getByRole("region", { name: "Upcoming birthdays" })).getAllByRole(
      "button",
    );
    expect(rows.map((r) => r.textContent)).toEqual([
      "Ali Khan Oct 23, turns 46, today",
      "Zainab Khan Oct 25, turns 43, in 2 days",
      "Omar Khan Nov 20, turns 36, in 28 days",
      "Ali Khan was born in 1980",
    ]);
  });

  test("clicking a row selects the person and closes the panel", async () => {
    const { user } = await openEditor({}, withBirthdays());
    await user.click(screen.getByRole("button", { name: /^Birthdays/ }));
    await user.click(
      screen.getByRole("button", { name: "Show Omar Khan, Nov 20, turns 36, in 28 days" }),
    );
    expect(screen.queryByRole("region", { name: "Upcoming birthdays" })).toBeNull();
    expect(card("c3").getAttribute("aria-current")).toBe("true");
  });

  test("no badge and a plain message when nobody has a birthday soon", async () => {
    const { user } = await openEditor();
    const button = screen.getByRole("button", { name: "Birthdays" });
    expect(button.textContent).toBe("");
    await user.click(button);
    expect(screen.getByText("No birthdays in the next 30 days.")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Upcoming birthdays" })).toBeNull();
  });
});
