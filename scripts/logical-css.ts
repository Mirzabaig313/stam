/**
 * Bun's CSS bundler (Lightning CSS) lowers `inset-inline-*` and the logical corner radii to
 * `left`/`right`, choosing the side with `:lang(ar, he, ur, …)` instead of `dir`. That breaks
 * whenever the language and the direction disagree (`dir="rtl"` on an English page, a `dir="ltr"`
 * island in Arabic, a language missing from its list), and Bun has no option for CSS targets.
 *
 * `:dir()` is lowered the same way, so it is hidden too.
 *
 * So the build hides those properties from the bundler as custom properties
 * (`--stam-logical-inset-inline-start`), which it copies verbatim, and turns them back afterwards.
 * Every browser Stam supports has had them natively since 2021.
 *
 * Caveat: the bundler may move a custom property within its rule, so a rule must not set both
 * a physical inset (`left`, `right`) and an inline one (`tests/build/logicalCss.test.ts` checks).
 */
import type { BunPlugin } from "bun";

const PREFIX = "--stam-logical-";

/** The properties Lightning CSS lowers by `:lang()`. Names inside other names are left alone. */
const LOWERED =
  /(?<![\w.#-])(inset-inline(?:-start|-end)?|border-(?:start|end)-(?:start|end)-radius)(?![\w-])/g;

/** `:dir(rtl)` is lowered to the same `:lang()` list; an attribute selector passes untouched. */
const DIR_PSEUDO = /:dir\((ltr|rtl)\)/g;
const DIR_STANDIN = /\[data-stam-logical-dir="?(ltr|rtl)"?\]/g;

export function protectLogical(css: string): string {
  return css.replace(LOWERED, `${PREFIX}$1`).replace(DIR_PSEUDO, '[data-stam-logical-dir="$1"]');
}

export function restoreLogical(css: string): string {
  return css.replaceAll(PREFIX, "").replace(DIR_STANDIN, ":dir($1)");
}

/**
 * Lowering emits the same list of right-to-left languages every time; nobody writes
 * `:lang(ae)` (Avestan) or `:lang(bcc)` by hand. Returns a snippet around each hit.
 */
export function findLoweredLogical(css: string): string[] {
  const hits: string[] = [];
  for (const m of css.matchAll(/:lang\(ae\),\s*:lang\(ar\),\s*:lang\(arc\)/g)) {
    hits.push(css.slice(Math.max(0, m.index - 60), m.index + 40));
  }
  return hits;
}

/** Applies `protectLogical` to every stylesheet the build bundles (not to CSS read as text). */
export const logicalCssPlugin: BunPlugin = {
  name: "stam-logical-css",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      if (args.loader !== "css") return undefined;
      return { contents: protectLogical(await Bun.file(args.path).text()), loader: "css" };
    });
  },
};
