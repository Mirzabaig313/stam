import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { injectHeadScript } from "../../scripts/headScript";

const root = () => document.documentElement;
const ATTRS = ["data-theme", "data-color-mode", "data-motion", "lang", "dir"];

/** Runs a classic script the way the browser does before first paint. */
const run = (file: string) => new Function(readFileSync(file, "utf8"))();

beforeEach(() => {
  localStorage.clear();
  for (const a of ATTRS) root().removeAttribute(a);
});
afterEach(() => {
  localStorage.clear();
  for (const a of ATTRS) root().removeAttribute(a);
  root().lang = "en";
  root().dir = "ltr";
});

describe("app boot script (before first paint)", () => {
  test("applies the cached settings and the motion choice", () => {
    localStorage.setItem(
      "stam:settings",
      JSON.stringify({ language: "ar", theme: "dark", colorMode: "branch", treeDirection: "auto" }),
    );
    localStorage.setItem("stam:motion", "reduce");
    run("src/app/boot.js");
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().getAttribute("data-color-mode")).toBe("branch");
    expect(root().getAttribute("data-motion")).toBe("reduce");
    expect(root().lang).toBe("ar");
    expect(root().dir).toBe("rtl");
  });

  test("ignores unknown or hostile values and survives broken or refused storage", () => {
    localStorage.setItem("stam:settings", JSON.stringify({ theme: '"><script>', language: "xx" }));
    run("src/app/boot.js");
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(root().getAttribute("lang") ?? "").not.toBe("xx");
    localStorage.setItem("stam:settings", "{broken");
    expect(() => run("src/app/boot.js")).not.toThrow();
  });
});

describe("landing flags script", () => {
  test("takes the user's chosen theme, as light or dark only", () => {
    localStorage.setItem("stam:settings", JSON.stringify({ theme: "dark", themeChosen: true }));
    run("src/site/flags.js");
    expect(root().getAttribute("data-theme")).toBe("dark");
    localStorage.setItem("stam:settings", JSON.stringify({ theme: "classic", themeChosen: true }));
    run("src/site/flags.js");
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  test("a cached theme nobody chose (the app's default) leaves the page to the OS", () => {
    localStorage.setItem("stam:settings", JSON.stringify({ theme: "light" }));
    run("src/site/flags.js");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  test("no choice: no attribute, so the page follows prefers-color-scheme", () => {
    run("src/site/flags.js");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });
});

describe("injectHeadScript", () => {
  test("puts a blocking script before the first stylesheet and module", () => {
    const html =
      '<html><head><meta charset="UTF-8"><link rel="stylesheet" href="/a.css"><script type="module" src="/m.js"></script></head></html>';
    const out = injectHeadScript(html, "/boot.1234.js");
    expect(out).toContain('<script src="/boot.1234.js"></script><link rel="stylesheet"');
    expect(out.indexOf("boot.1234")).toBeLessThan(out.indexOf("/m.js"));
  });

  test("refuses a page without a head", () => {
    expect(() => injectHeadScript("<p>x</p>", "/b.js")).toThrow();
  });
});
