import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { prefersReducedMotion } from "@/site/motion/env";

// The landing page follows the app's "Reduce motion" setting (cached as `stam:motion`, applied as
// <html data-motion>) as well as the OS: `reduce` stills it, `full` animates even under the OS
// setting, and `system` (no attribute) follows the OS.

const root = () => document.documentElement;
const realMatchMedia = globalThis.matchMedia;

function osReduces(reduce: boolean) {
  globalThis.matchMedia = ((query: string) =>
    ({
      matches: reduce && query.includes("prefers-reduced-motion: reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList) as typeof matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute("data-motion");
  root().className = "";
});

afterEach(() => {
  globalThis.matchMedia = realMatchMedia;
  localStorage.clear();
  root().removeAttribute("data-motion");
  root().className = "";
});

describe("prefersReducedMotion (the landing's motion engine)", () => {
  test("no choice: the OS decides", () => {
    osReduces(true);
    expect(prefersReducedMotion()).toBe(true);
    osReduces(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  test("the app's choice wins over the OS", () => {
    osReduces(false);
    root().setAttribute("data-motion", "reduce");
    expect(prefersReducedMotion()).toBe(true);
    osReduces(true);
    root().setAttribute("data-motion", "full");
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("flags.js (before first paint)", () => {
  // The classic script, run as the page runs it (our own source file).
  const source = readFileSync(`${import.meta.dir}/../../src/site/flags.js`, "utf8");
  const flags = () => new Function(source)();

  test("a cached 'reduce' sets data-motion and leaves the page still", () => {
    osReduces(false);
    localStorage.setItem("stam:motion", "reduce");
    flags();
    expect(root().getAttribute("data-motion")).toBe("reduce");
    expect(root().classList.contains("motion")).toBe(false);
  });

  test("a cached 'full' animates even when the OS asks for less", () => {
    osReduces(true);
    localStorage.setItem("stam:motion", "full");
    flags();
    expect(root().getAttribute("data-motion")).toBe("full");
    expect(root().classList.contains("motion")).toBe(true);
  });

  test("no choice, or a broken one: no attribute, and the OS decides", () => {
    osReduces(false);
    localStorage.setItem("stam:motion", "sideways");
    flags();
    expect(root().hasAttribute("data-motion")).toBe(false);
    expect(root().classList.contains("motion")).toBe(true);
  });
});

/** Each rule with `prefix` taken off every selector (and whitespace evened out), to compare. */
function unscoped(rules: string, prefix: string): string[] {
  return rules
    .split(/\n\s*\n/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const brace = r.indexOf("{");
      const selectors = r
        .slice(0, brace)
        .split(",")
        .map((s) => s.trim());
      expect(selectors.every((s) => s.startsWith(prefix))).toBe(true);
      const body = r.slice(brace).replace(/\s+/g, " ");
      return `${selectors.map((s) => s.slice(prefix.length).trim()).join(",")} ${body}`;
    });
}

describe("site.css", () => {
  const css = readFileSync(`${import.meta.dir}/../../src/site/site.css`, "utf8");

  /** The rules inside the block that starts at `head`, up to its matching brace. */
  function inside(head: string): string {
    const open = css.indexOf("{", css.indexOf(head));
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    throw new Error(`unclosed ${head}`);
  }

  test("data-motion=reduce applies exactly the OS's reduced-motion rules; data-motion=full turns those off", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    const os = inside("@media (prefers-reduced-motion: reduce)");
    const marker = "/* reduced motion: chosen in the app */";
    const from = css.indexOf(marker) + marker.length;
    const chosen = css.slice(from, css.indexOf("/* ----", from));
    expect(unscoped(chosen, ':root[data-motion="reduce"]')).toEqual(
      unscoped(os, ':root:not([data-motion="full"])'),
    );
  });
});
