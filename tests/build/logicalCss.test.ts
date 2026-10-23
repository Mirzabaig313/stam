import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findLoweredLogical,
  logicalCssPlugin,
  protectLogical,
  restoreLogical,
} from "../../scripts/logical-css";

describe("protectLogical / restoreLogical", () => {
  test("hides the inline insets and logical corners from the bundler, and brings them back", () => {
    const css =
      ".a{inset-inline-start:0;inset-inline-end:4px}\n" +
      ".b { inset-inline: 0 auto; border-start-end-radius: 3px }\n" +
      ".c{transition:inset-inline-start .2s}";
    const hidden = protectLogical(css);
    expect(hidden).not.toMatch(/(^|[^-])inset-inline/);
    expect(hidden).not.toMatch(/(^|[^-])border-start-end-radius/);
    expect(restoreLogical(hidden)).toBe(css);
  });

  test("hides :dir() too, which the bundler would also turn into :lang()", () => {
    const css = ".icon:dir(rtl){scale:-1 1}.x:dir(ltr) .y{scale:none}";
    const hidden = protectLogical(css);
    expect(hidden).not.toContain(":dir(");
    expect(restoreLogical(hidden)).toBe(css);
  });

  test("leaves everything else alone", () => {
    const css = ".a{margin-inline-start:4px;padding-inline:2px;inset-block-start:0;left:0}";
    expect(protectLogical(css)).toBe(css);
  });

  test("does not touch names that only contain the words", () => {
    const css =
      ".x-inset-inline-start{--my-inset-inline-start:1px;color:var(--my-inset-inline-start)}";
    expect(protectLogical(css)).toBe(css);
  });
});

describe("findLoweredLogical", () => {
  test("finds the right-to-left :lang() list that lowering emits", () => {
    const lowered =
      ".a:not(:is(:lang(ae),:lang(ar),:lang(arc),:lang(bcc),:lang(he))){left:0}" +
      ".a:is(:lang(ae),:lang(ar),:lang(arc),:lang(bcc),:lang(he)){right:0}";
    expect(findLoweredLogical(lowered).length).toBeGreaterThan(0);
  });

  test("accepts hand-written :lang() rules and logical properties", () => {
    const css = ':lang(ur){font-family:"Noto Nastaliq Urdu"}.a{inset-inline-start:0}';
    expect(findLoweredLogical(css)).toEqual([]);
  });
});

test("no stylesheet rule mixes physical and inline insets (the bundler may reorder them)", async () => {
  const mixed: string[] = [];
  for await (const file of new Bun.Glob("src/**/*.css").scan(join(import.meta.dir, "../.."))) {
    const css = (await readFile(join(import.meta.dir, "../..", file), "utf8")).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const props = new Set([...body!.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map((m) => m[1]));
      const physical = props.has("left") || props.has("right");
      const inline = [...props].some((p) => p!.startsWith("inset-inline"));
      if (physical && inline) mixed.push(`${file}: ${selector!.trim()}`);
    }
  }
  expect(mixed).toEqual([]);
});

describe("a real Bun build with the plugin", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "stam-logical-"));
    await writeFile(
      join(dir, "a.css"),
      '@import "./b.css";\n.tip{position:absolute;inset-inline-start:50%;border-start-start-radius:4px}\n' +
        ".icon:dir(rtl){scale:-1 1}\n",
    );
    await writeFile(join(dir, "b.css"), ".end{inset-inline-end:var(--gutter)}\n");
    await writeFile(join(dir, "entry.ts"), 'import "./a.css";\nconsole.log(1);\n');
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function build(plugins: Bun.BunPlugin[]): Promise<string> {
    const outdir = join(dir, `out-${plugins.length}`);
    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir,
      minify: true,
      plugins,
    });
    expect(result.success).toBe(true);
    const css = (await readdir(outdir)).find((f) => f.endsWith(".css"))!;
    return readFile(join(outdir, css), "utf8");
  }

  test("without it, Bun lowers the insets to left/right keyed on :lang()", async () => {
    expect(findLoweredLogical(await build([]))).not.toEqual([]);
  });

  test("with it, the emitted CSS keeps the logical properties", async () => {
    const css = restoreLogical(await build([logicalCssPlugin]));
    expect(findLoweredLogical(css)).toEqual([]);
    expect(css).toContain("inset-inline-start:50%");
    expect(css).toContain("inset-inline-end:var(--gutter)");
    expect(css).toContain("border-start-start-radius:4px");
    expect(css).toContain(".icon:dir(rtl){");
    expect(css).not.toContain("--stam-logical-");
  });
});
