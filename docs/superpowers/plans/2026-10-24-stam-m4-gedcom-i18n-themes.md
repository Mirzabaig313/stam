# Stam M4: GEDCOM, Urdu/Arabic + RTL, Themes, Offline: Implementation Plan

> **For agentic workers:** five lanes run in parallel git worktrees from `feat/m4`. Every lane builds against the **shared contract** below. After the lanes: merge, integrate, run a final review and one fix wave.

**Goal:** finish v1:
- GEDCOM import and export;
- an Urdu and Arabic interface with a full right-to-left layout and proper fonts, including in exports;
- light, dark, classic and print themes, with card colour modes;
- offline support through a service worker;
- the accessibility, robustness and polish items carried over from M1–M3.

**Spec:** `docs/superpowers/specs/2026-10-22-stam-prd.md`:
- §7.9 (FR-I2, I3, I4)
- §7.12 (FR-L1–L5)
- §8 (offline, accessibility, browsers)
- §14 (GEDCOM round trip)

## Global constraints (as in M1–M3)

- Bun only, latest versions.
- `src/core` stays pure.
- All strings through `t()`.
- Logical CSS only.
- `<bdi>` around names.
- No network calls.
- Tokens:
  - **light:** ground `#F4F5F2`, ink `#111311`, muted `#5A615B`, accent `#2B47F5`.
  - **dark:** ground `#0F110F`, ink `#E8EAE6`, muted `#9AA29B`, accent `#6F84FF`.
- Port 3333 is the owner's preview: never touch it, never `pkill`. No push. No subagents.

## Shared contract: `src/ui/settings/settings.ts` (lane T creates the real one; other lanes copy this verbatim, then run `bun fmt`)

```ts
export type Language = "en" | "ur" | "ar";
export type Theme = "light" | "dark" | "classic" | "print";
export type ColorMode = "gender" | "branch" | "generation";
export type TreeDirection = "auto" | "ltr" | "rtl"; // auto = follow the interface language
export type Settings = { language: Language; theme: Theme; colorMode: ColorMode; treeDirection: TreeDirection };
export const DEFAULT_SETTINGS: Settings = { language: "en", theme: "light", colorMode: "gender", treeDirection: "auto" };
/** Persisted with repo.setSetting("ui", settings); applied to <html lang dir data-theme data-color-mode>. */
export function loadSettings(repo: { getSetting<T>(k: string): Promise<T | undefined> }): Promise<Settings>;
export function saveSettings(repo: { setSetting(k: string, v: unknown): Promise<void> }, s: Settings): Promise<void>;
export function applySettings(s: Settings, doc?: Document): void; // sets lang, dir (via i18n), data-theme, data-color-mode
export function useSettings(): [Settings, (patch: Partial<Settings>) => void];
```

## Lanes

### Lane G: GEDCOM (`src/io/gedcom/*`, plus import and export wiring)

- `parseGedcom(text): { doc: TreeDocument; report: { people: number; families: number; skipped: { line: number; tag: string; reason: string }[]; warnings: string[] } }`
  - A lenient line parser covering CONC/CONT, levels, xrefs, BOM and CRLF.
  - GEDCOM 5.5.1, plus the basic 7.0 tags.
  - INDI: NAME (given and surname split on `/`), SEX (M/F; U or missing → skipped with a warning and defaulting to … see below), BIRT/DEAT DATE and PLAC, NOTE.
  - FAM: HUSB/WIFE/CHIL, MARR/DIV with DATE.
  - PEDI on FAMC → adopted, foster, birth.
  - Dates: ABT, BEF, AFT, BET … AND …, FROM … TO …, and month abbreviations, mapped to `FuzzyDate`.
  - Character sets: UTF-8; ANSEL and ASCII fall back to latin1 with a warning.
  - **Ruling:** the model is male/female only. A SEX of U or missing becomes a **placeholder-free person with `gender` guessed from their family role** (HUSB → male, WIFE → female), otherwise male, and a report warning lists them for the user to check.
  - The output goes through `parseTreeDocument`, so it validates, gets a new tree id and gets a root.
- `writeGedcom(doc): string`
  - GEDCOM 5.5.1 in UTF-8, with a header (SOUR STAM, CHAR UTF-8), INDI/FAM records and xrefs derived from ids.
  - Lines over 248 characters are split with CONC; newlines in notes use CONT.
  - Photos are not exported (a note in the report).
- Wiring:
  - The tree list's Import accepts `.ged`, shows the import report (counts plus a collapsible list of skipped lines) and saves the tree.
  - The export dialog gets a "GEDCOM (.ged)" format, with privacy mode respected.
- Tests:
  - round trip `write → parse` on every fixture, plus `arbFamily` (property): same people, unions, child types and dates;
  - fixture `.ged` files: a hand-written 5.5.1 file covering every supported tag, a 7.0 file, CONC/CONT, BOM and CRLF, and a malformed file (report, no crash);
  - prototype-key xrefs rejected or safe.

### Lane L: languages and fonts (`src/i18n/*`, fonts)

- `ur.json` and `ar.json`, covering **every** key in `en.json` (a test enforces key parity, including plurals).
  - Translate clearly and simply.
  - Add the header comment key `_review: "Machine-assisted translation. Needs review by a native speaker."`, and a visible "Translation in review" note in the language picker.
  - Plurals use i18next's Arabic plural forms (zero, one, two, few, many, other).
- `src/i18n/index.ts` loads all three languages. `applySettings` handles `lang`, `dir` and the document font stack.
- Fonts:
  - self-host Noto Naskh Arabic (Arabic UI and names) and Noto Nastaliq Urdu (the Urdu UI), via `@fontsource` packages loaded only when that language is active (dynamic `import()` of the CSS) or with `unicode-range`, so English first load doesn't grow;
  - name text falls back to these fonts for Arabic-script names in every language.
- Exports:
  - `fontsFor(doc)` in `src/export/render/fonts.ts` adds Noto Naskh Arabic, and Noto Nastaliq Urdu when the doc has Urdu-specific letters, if any name contains Arabic script;
  - the PDF exporter's fontkit outlining then shapes them correctly (lane P built the outlining);
  - the PDF guide and tile labels use Archivo or Noto instead of Helvetica.
- Kinship in Urdu and Arabic: the relation panel shows the sentence in the interface language. Add `describeRelationshipUr` / `describeRelationshipAr` built on `urduTerm` plus an Arabic equivalent `arabicTerm` (عم, عمة, خال, خالة, جد, جدة …), with tests. Flag them for native review too.
- Number and date formatting via `Intl` in the active locale. Arabic-Indic digits only if the locale default uses them.

### Lane R: right-to-left layout (CSS, canvas direction, keyboard)

- **The Lightning CSS trap:** Bun's CSS bundler lowers `inset-inline-*`, `margin-inline-*` and similar to `left`/`right`, choosing the side from `:lang()`, not `dir`.
  - Find a robust fix: configure Bun's CSS targets so logical properties are not lowered (preferred), or use `[dir=rtl]` overrides where lowering is unavoidable.
  - Add a build check that fails when the emitted CSS contains `:lang(` selectors produced by lowering logical properties.
- Audit every screen in RTL (`dir=rtl` plus Arabic text): tree list, toolbar, view switcher, tooltips, side panel, dialogs, export dialog, birthdays, relation panel, search, the drop menu and the landing page.
  - Fix mirroring problems: icons with direction (undo/redo arrows, chevrons) flip; the zoom +/- and the minimap corner don't.
- Canvas: `treeDirection` from settings ("auto" follows the language). Mirror the family layout's x order in RTL, so the first child is on the right. Card internals already isolate names and years.
- Keyboard: shortcuts use `event.code` (`KeyZ`, `KeyF`, `KeyE`, `KeyY`, `Digit1–6`), so they work on Arabic and Urdu layouts. Arrow-key navigation is RTL-aware (already done in the logic; verify it).
- E2E: an RTL project in Playwright (Arabic locale), with screenshots of every screen and the core editor flows (add a person, drag, undo, search, export SVG) in RTL.

### Lane T: themes, colour modes, settings (`src/ui/settings/*`, tokens)

- Create the real `settings.ts` (contract) and a **Settings dialog**, opened from the toolbar menu: language (lane L provides the list), theme, card colour mode, tree direction, plus "Reduce motion" following the OS by default.
- Settings persist through the repo and apply on load before first paint, with no flash of the wrong theme. Apply them in `main.tsx` before `render`, cached in localStorage for a synchronous first read.
- Themes as CSS custom properties under `[data-theme]`:
  - **dark:** the tokens above;
  - **classic:** pink/blue card fills by gender on the light ground;
  - **print:** pure black on white, no fills, thicker lines.
  - Cover the editor, panels, dialogs, canvas, the fan and timeline, and the landing page (light and dark only; it follows `prefers-color-scheme` unless the user chose a theme).
  - Every text/background pair passes WCAG AA in every theme, checked by a token contrast test.
- Card colour modes (`data-color-mode`):
  - gender: the default marker;
  - branch: each child of the root starts a branch hue (6 hues tuned for both light and dark, AA against card text), and descendants inherit it;
  - generation: hue by generation row.
  - Pure helper: `branchOf(doc, layout) → Record<personId, number>`, with tests.
- Exports: the export dialog's theme option offers light, dark and print (`renderTreeSvg` resolves the theme tokens).

### Lane O: offline, accessibility, robustness

- **Service worker** (`src/sw.ts`, built by `scripts/build.ts` to `/sw.js`):
  - precache the app shell (`app.html`, hashed JS/CSS and fonts) with a versioned cache;
  - network-first for HTML and cache-first for hashed assets;
  - no caching of anything else;
  - an update flow: a "New version available, reload" toast.
  - Register it only in production builds and only on `/app`.
  - `_headers`: no-cache for `sw.js`.
  - E2E: load once, go offline (`context.setOffline(true)`), reload `/app`, and the tree list and the editor still work, including opening a tree and editing it.
- **`/app` accessibility** (carried over from the landing critic and M3 review):
  - a skip link;
  - a link back home ("Stam" wordmark → `/`);
  - no colour-only hovers on primary buttons;
  - an axe scan of every view (fan, timeline, the relation and birthday panels, settings, the export dialog) in `e2e/a11y.spec.ts`;
  - fix what axe finds.
- **Performance:**
  - phone LCP of `/app` under 2.5 s: measure, then preload critical fonts or split a chunk if needed;
  - timeline culling of offscreen bars (M3 deferral), so switching at 1k people takes under 200 ms.
- **Firefox:** add a Firefox Playwright project and fix what fails.
- **Robustness:** orphaned photo blobs. Add a "Clean up unused photos" pass that runs after delete and import, deleting photos no tree references, with tests.

## Integration and review

1. Merge in the order T, L, R, G, O.
2. Integration agent:
   - full E2E in en, ur and ar;
   - all themes;
   - offline;
   - GEDCOM import and export through the UI;
   - screenshots of each language, theme and screen.
3. Final review, then one fix wave, then per-area squash onto `main` (the owner pushes).

**Translation note for the owner:** Urdu and Arabic are machine-assisted and must be reviewed by a native speaker before a public launch. The app shows a "Translation in review" note until a reviewer marks them done.
