import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { PALETTES } from "@/export/render/theme";
import type { ExportTheme } from "@/export/types";
import { type Theme, THEME_GROUND, THEMES } from "@/ui/settings/settings";

// ---- Colour maths (WCAG 2.x) ------------------------------------------------------------------

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v)?.[1];
  if (fn) {
    const parts = fn
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
  }
  throw new Error(`not a colour: ${value}`);
}

/** `top` composited over the opaque `bottom`. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1) as Rgba;
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgba) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- Token sets from a stylesheet ------------------------------------------------------------

type Tokens = Record<string, string>;

/** The custom properties declared in the first rule whose selector list contains `selector`. */
function block(css: string, selector: string): Tokens {
  const rule = new RegExp(
    `(^|[},])\\s*[^{}]*${selector.replace(/[[\]()"]/g, "\\$&")}[^{}]*\\{([^}]*)\\}`,
    "m",
  );
  const body = rule.exec(css)?.[2];
  if (body === undefined) throw new Error(`no rule for ${selector}`);
  const out: Tokens = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    out[name!] = value!.trim();
  return out;
}

function color(tokens: Tokens, name: string): Rgba {
  const value = tokens[name];
  if (value === undefined) throw new Error(`missing ${name}`);
  return parseColor(value);
}

const AA = 4.5;
const NON_TEXT = 3;

// ---- The app's themes --------------------------------------------------------------------------

const appCss = readFileSync("src/ui/styles/tokens.css", "utf8");
const light = block(appCss, ':root[data-theme="light"]');
const themes: Record<Theme, Tokens> = {
  light,
  dark: { ...light, ...block(appCss, ':root[data-theme="dark"]') },
  classic: { ...light, ...block(appCss, ':root[data-theme="classic"]') },
  print: { ...light, ...block(appCss, ':root[data-theme="print"]') },
};

const TEXTS = ["--ink", "--muted"];
const SURFACES = [
  "--ground",
  "--card",
  "--card-hover",
  "--deceased",
  "--deceased-hover",
  "--field",
  "--surface",
];
const HUES = Array.from({ length: 6 }, (_, i) => `--hue-${i}`);
const WASHES = ["--hover", "--pressed"];

describe.each(THEMES.map((name) => [name]))("theme %s", (name) => {
  const tokens = themes[name];
  const ground = color(tokens, "--ground");

  test("the ground matches the browser theme colour", () => {
    expect(color(tokens, "--ground")).toEqual(parseColor(THEME_GROUND[name]));
  });

  const surfaces = [...SURFACES, ...HUES];
  if (name === "classic")
    surfaces.push("--male", "--female", "--male-deceased", "--female-deceased");
  for (const text of TEXTS) {
    for (const surface of surfaces) {
      test(`${text} on ${surface} passes AA`, () => {
        expect(contrast(color(tokens, text), color(tokens, surface))).toBeGreaterThanOrEqual(AA);
      });
    }
    for (const wash of WASHES) {
      test(`${text} on ${wash} over the ground passes AA`, () => {
        const bg = over(color(tokens, wash), ground);
        expect(contrast(color(tokens, text), bg)).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  test("ground-coloured text on ink (primary buttons, tooltips, badges) passes AA", () => {
    expect(contrast(ground, color(tokens, "--ink"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(ground, color(tokens, "--primary-hover"))).toBeGreaterThanOrEqual(AA);
  });

  test("the accent (selection) stands out 3:1 from the ground and the cards", () => {
    for (const surface of ["--ground", "--card", ...HUES]) {
      expect(contrast(color(tokens, "--accent"), color(tokens, surface))).toBeGreaterThanOrEqual(
        NON_TEXT,
      );
    }
  });

  // ---- M6 design foundation: surfaces, ink levels, accent and danger families, deep hues ----

  for (const surface of ["--surface-raised", "--surface-sunken", "--surface-overlay"]) {
    for (const text of ["--ink", "--ink-2"]) {
      test(`${text} on ${surface} passes AA`, () => {
        expect(contrast(color(tokens, text), color(tokens, surface))).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  test("--ink-2 is the same as --muted (one secondary ink, two names)", () => {
    expect(color(tokens, "--ink-2")).toEqual(color(tokens, "--muted"));
  });

  test("--ink-3 (icons and strokes only) is 3:1 on the ground, the raised and the sunken surface", () => {
    for (const surface of ["--ground", "--surface-raised", "--surface-sunken"]) {
      expect(contrast(color(tokens, "--ink-3"), color(tokens, surface))).toBeGreaterThanOrEqual(
        NON_TEXT,
      );
    }
  });

  test("text on the accent and on danger (filled buttons) passes AA, hovered too", () => {
    for (const [text, fill] of [
      ["--on-accent", "--accent"],
      ["--on-accent", "--accent-hover"],
      ["--on-danger", "--danger"],
      ["--on-danger", "--danger-hover"],
    ] as const) {
      expect(contrast(color(tokens, text), color(tokens, fill))).toBeGreaterThanOrEqual(AA);
    }
  });

  test("accent and danger text read AA on the ground, the raised surface and their soft fills", () => {
    for (const [text, bgs] of [
      ["--accent-ink", ["--ground", "--surface-raised", "--accent-soft", "--surface-overlay"]],
      ["--danger", ["--ground", "--surface-raised", "--danger-soft", "--surface-overlay"]],
      ["--ink", ["--accent-soft", "--danger-soft"]],
    ] as const) {
      for (const bg of bgs) {
        expect(contrast(color(tokens, text), color(tokens, bg))).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  test("the deep hues (dots, keys, bands) are 3:1 against a card and the ground", () => {
    for (let i = 0; i < 6; i++) {
      for (const surface of ["--card", "--ground"]) {
        expect(
          contrast(color(tokens, `--hue-${i}-deep`), color(tokens, surface)),
        ).toBeGreaterThanOrEqual(NON_TEXT);
      }
    }
  });

  test("ink on --hover and --pressed over the raised surface passes AA (menus, list rows)", () => {
    const raised = color(tokens, "--surface-raised");
    for (const wash of WASHES) {
      const bg = over(color(tokens, wash), raised);
      expect(contrast(color(tokens, "--ink"), bg)).toBeGreaterThanOrEqual(AA);
    }
  });

  test("connectors at the edge opacity are 3:1 against the ground (R32)", () => {
    const opacity = Number(tokens["--edge-opacity"]);
    expect(opacity).toBeGreaterThan(0);
    const ink = color(tokens, "--ink");
    expect(
      contrast(over([ink[0], ink[1], ink[2], opacity], ground), ground),
    ).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

test("the check can fail: the old faint line strength is under 3:1", () => {
  const ink = color(light, "--ink");
  const ground = color(light, "--ground");
  expect(contrast(over([ink[0], ink[1], ink[2], 0.14], ground), ground)).toBeLessThan(NON_TEXT);
});

test("the hues differ from each other and from the plain card", () => {
  for (const name of ["light", "dark"] as const) {
    const values = [...HUES, "--card"].map((h) => themes[name][h]);
    expect(new Set(values).size).toBe(values.length);
  }
});

test("every theme declares every colour token the light theme has (no silent fallthrough)", () => {
  for (const name of ["dark", "print"] as const) {
    const own = block(appCss, `:root[data-theme="${name}"]`);
    const colours = Object.keys(light).filter((k) => /^(#|rgba?\()/.test(light[k]!));
    expect(colours.filter((k) => !(k in own))).toEqual([]);
  }
});

test("each theme block also applies to any element with data-theme (the design showcase)", () => {
  for (const name of THEMES) {
    expect(appCss).toMatch(new RegExp(`\\n\\[data-theme="${name}"\\]\\s*\\{`));
  }
});

// ---- The landing page (light and dark) --------------------------------------------------------

const siteCss = readFileSync("src/site/site.css", "utf8");
const siteLight = block(siteCss, ":root");
const siteDark = { ...siteLight, ...block(siteCss, ':root[data-theme="dark"]') };

describe.each([
  ["light", siteLight],
  ["dark", siteDark],
] as const)("landing %s", (_, tokens) => {
  const pairs: [string, string][] = [
    ["--ink", "--ground"],
    ["--muted", "--ground"],
    ["--ink", "--card"],
    ["--muted", "--card"],
    ["--ink", "--paper"],
    ["--muted", "--paper"],
    ["--ink", "--avatar"],
    ["--ground", "--ink"],
    ["--on-curtain", "--curtain"],
    ["--on-curtain-muted", "--curtain"],
    ["--inverse-muted", "--ink"],
    ["--inverse-soft", "--ink"],
    ["--ink", "--accent-tint"],
    ["--ink", "--accent-tint-strong"],
    ["--on-accent", "--accent"],
  ];
  for (const [text, bg] of pairs) {
    test(`${text} on ${bg} passes AA`, () => {
      expect(contrast(color(tokens, text), color(tokens, bg))).toBeGreaterThanOrEqual(AA);
    });
  }

  test("the dark set is the same under prefers-color-scheme as under data-theme", () => {
    const media =
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/.exec(
        siteCss,
      )?.[1];
    expect(media).toBeDefined();
    const fromMedia: Tokens = {};
    for (const [, n, v] of media!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) fromMedia[n!] = v!.trim();
    expect(fromMedia).toEqual(block(siteCss, ':root[data-theme="dark"]'));
  });
});

// ---- Export palettes -------------------------------------------------------------------------

describe.each(Object.keys(PALETTES).map((k) => [k as ExportTheme]))("export %s", (name) => {
  const p = PALETTES[name];
  const fills = [p.ground, p.card, p.deceased].filter((c) => c !== "none");
  for (const text of [p.ink, p.muted]) {
    for (const fill of fills) {
      test(`${text} on ${fill} passes AA`, () => {
        expect(contrast(parseColor(text), parseColor(fill))).toBeGreaterThanOrEqual(AA);
      });
    }
  }
  test("connectors are 3:1 against the ground", () => {
    const ink = parseColor(p.ink);
    const ground = parseColor(p.ground);
    expect(
      contrast(over([ink[0], ink[1], ink[2], p.edgeOpacity], ground), ground),
    ).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
