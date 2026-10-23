import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { toHtml } from "@/export/html/toHtml";

import { fixtureMeta, fixturePeople, fixtureSvg } from "../../fixtures/exportSvg";

/**
 * Loads an exported file into the happy-dom document and runs its inline viewer exactly as
 * written into the file: the script text is evaluated on its own, with no module scope.
 */
function load(html: string): void {
  // happy-dom's HTML parser drops everything after a <style> inside inline SVG (browsers don't;
  // the Playwright spec covers the real file), so the SVG's own stylesheet is left out here.
  const parsed = new DOMParser().parseFromString(
    html.replace(/(<svg[^>]*>)<style>[\s\S]*?<\/style>/, "$1"),
    "text/html",
  );
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const viewer = [...parsed.querySelectorAll("script")].find((s) => !s.hasAttribute("type"));
  // oxlint-disable-next-line no-new-func -- running the exported file's own script is the test
  new Function(viewer!.textContent!)();
}

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const card = (id: string) => $<SVGGElement>(`[data-person-id="${id}"]`);

function search(query: string): void {
  const input = $<HTMLInputElement>("#q");
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(target: Element, name: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

beforeEach(() => load(toHtml(fixtureSvg, fixturePeople, fixtureMeta)));
afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("exported viewer", () => {
  test("makes every card a keyboard-reachable button named after the person", () => {
    const adam = card("p-adam");
    expect(adam.getAttribute("tabindex")).toBe("0");
    expect(adam.getAttribute("role")).toBe("button");
    expect(adam.getAttribute("aria-label")).toContain("Adam Hadžić");
  });

  test("search finds a person, ignoring case and diacritics, and highlights the match", () => {
    search("hana");
    expect(card("p-hana").classList.contains("is-match")).toBe(true);
    expect(card("p-adam").classList.contains("is-match")).toBe(false);
    expect($("#stage").classList.contains("is-searching")).toBe(true);
    expect($("#status").textContent).toBe("1 match");
    expect([...document.querySelectorAll("#results button")].map((b) => b.textContent)).toEqual([
      "Hana Hadžić, b. 1935",
    ]);

    search("HADZIC");
    expect($("#status").textContent).toBe("2 matches");
    search("هانا");
    expect(card("p-hana").classList.contains("is-match")).toBe(true);
    search("nobody");
    expect($("#status").textContent).toBe("No matches");
    search("");
    expect($("#stage").classList.contains("is-searching")).toBe(false);
    expect($("#status").textContent).toBe("");
  });

  test("clicking a card opens that person's details", () => {
    card("p-adam")
      .querySelector("text")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const panel = $("#panel");
    expect(panel.hidden).toBe(false);
    expect($("#panel-name").textContent).toBe("Adam Hadžić");
    expect($("#panel-life").textContent).toBe("1931 – 2004");
    const rows = [...panel.querySelectorAll("dt")].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
    expect(rows).toEqual([
      ["Born", "3 March 1931, Mostar"],
      ["Died", "2004"],
    ]);
    expect(card("p-adam").classList.contains("is-selected")).toBe(true);
  });

  test("hostile names and notes render as text, never as markup", () => {
    card("p-evil").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect($("#panel-name").textContent).toBe(fixturePeople[2]!.name);
    expect($("#panel").querySelector("img, b, script")).toBeNull();
    expect($("#panel dd").textContent).toBe('<b onclick="x()">bold</b> & </SCRIPT>');
  });

  test("Enter on a focused card opens it, and Escape closes the panel and returns focus", () => {
    const hana = card("p-hana");
    hana.focus();
    key(hana, "Enter");
    expect($("#panel").hidden).toBe(false);
    expect($("#panel-name").textContent).toBe("Hana Hadžić");
    expect($("#panel-native").textContent).toBe("هانا");
    key(document.activeElement ?? document.body, "Escape");
    expect($("#panel").hidden).toBe(true);
    expect(document.activeElement).toBe(hana);
  });

  test("Escape or a touch on the tree puts the results list away; focusing search brings it back", () => {
    search("hadzic");
    const input = $<HTMLInputElement>("#q");
    const list = $("#results");
    expect(list.hidden).toBe(false);
    key(input, "Escape");
    expect(list.hidden).toBe(true);
    expect(input.value).toBe("hadzic");
    expect(card("p-adam").classList.contains("is-match")).toBe(true);
    input.dispatchEvent(new FocusEvent("focus"));
    expect(list.hidden).toBe(false);
    $("#stage").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    expect(list.hidden).toBe(true);
  });

  test("choosing a search result opens that person", () => {
    search("adam");
    $<HTMLButtonElement>("#results button").click();
    expect($("#panel-name").textContent).toBe("Adam Hadžić");
  });

  test("zoom buttons and keys change the scale; the fit button resets it", () => {
    const world = $("#world");
    const scale = () => Number(/scale\(([\d.e-]+)\)/.exec(world.style.transform)?.[1]);
    const start = scale();
    $<HTMLButtonElement>('[data-action="zoom-in"]').click();
    expect(scale()).toBeGreaterThan(start);
    key($("#stage"), "-");
    key($("#stage"), "-");
    expect(scale()).toBeLessThan(start * 1.25);
    $<HTMLButtonElement>('[data-action="fit"]').click();
    expect(scale()).toBeCloseTo(start);
  });

  test("0 fits on an Arabic keyboard too, where the key types ٠", () => {
    const world = $("#world");
    const scale = () => Number(/scale\(([\d.e-]+)\)/.exec(world.style.transform)?.[1]);
    const start = scale();
    $<HTMLButtonElement>('[data-action="zoom-in"]').click();
    $("#stage").dispatchEvent(
      new KeyboardEvent("keydown", { key: "٠", code: "Digit0", bubbles: true }),
    );
    expect(scale()).toBeCloseTo(start);
  });
});
