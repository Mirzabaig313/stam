# Stam M3: Views, Relationship Calculator, Birthdays: Implementation Plan

> **For agentic workers:** four lanes run in parallel git worktrees from `feat/m3-views`. Every lane builds against the **shared contract** below. After the lanes: merge, integrate, run one review, then a final review.

**Goal:** add five more views of the same tree (pedigree, descendants only, hourglass, fan chart, timeline), a relationship calculator ("Noor is Adam's first cousin once removed") with path highlighting and Urdu kinship terms, and an upcoming-birthdays panel.

**Spec:** `docs/superpowers/specs/2026-10-22-stam-prd.md` §7.6 (FR-V1–V7), §7.7 (FR-K1–K6), §7.11 (FR-B1), §10.1 ("other views reuse steps 3–4"), §14 (≥ 60 kinship cases).

## Global constraints (carried over from M1/M2)

- **Toolchain:** Bun only, with the latest dependencies.
- **Purity:** `src/core` stays pure TypeScript, with no DOM, React or i18n.
- **Strings:** all strings go through `t()`. New groups: `"views"`, `"kinship"`, `"birthdays"`.
- **Text direction:** logical CSS only; names wrapped in `<bdi>` / `unicode-bidi: isolate`.
- **Gender:** male/female only.
- **Card geometry:** CARD_W 180, CARD_H 72, COUPLE_GAP 32, GAP 40, ROW_H 168.
- **Motion:** expo-out easing; re-flow 450 ms; none under reduced motion.
- **Tokens:** the accent colour (#2B47F5) is for selection and "you" only. Path highlighting uses ink at full strength with dimmed others, not accent.
- **Performance:** every new layout is pure and deterministic, and takes ≤ 300 ms for 5,000 people. Build your own indexes; don't scan all unions per person.
- **Process:**
  - Property tests read `PROPERTY_RUNS`.
  - Port 3333 is the owner's preview: never touch it, never `pkill`.
  - No subagents; commit only, no push.

## Shared contract

### `src/core/views/types.ts` (lane T creates it; other lanes copy it verbatim, then run `bun fmt`)

```ts
export type ViewMode = "family" | "pedigree" | "descendants" | "hourglass" | "fan" | "timeline";
export type FanSegment = {
  personId: string;
  generation: number;      // 1 = parents of focus, 2 = grandparents, ...
  index: number;           // 0-based position within its generation (paternal side first)
  startAngle: number;      // radians, 0 = pointing right, increasing clockwise; the fan spans π..2π (upper half)
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
};
export type FanLayout = { focusId: string; segments: FanSegment[]; radius: number; generations: number };
export type TimelineBar = {
  personId: string;
  row: number;             // 0-based lane, grouped by generation, ordered by birth
  generation: number;
  start: number;           // year (fractional allowed)
  end: number;             // year; for living people = current year
  startKnown: boolean;
  endKnown: boolean;
  living: boolean;
};
export type TimelineLayout = { bars: TimelineBar[]; minYear: number; maxYear: number; rows: number; generationRows: { generation: number; firstRow: number; lastRow: number }[] };
```

### Tree-shaped layouts, all returning the existing `LayoutResult` (lane T)

The canvas renders these unchanged, and editing works in them.
- `layoutPedigree(doc, { focusId, collapsed? }): LayoutResult` in `src/core/layout/pedigree.ts`.
  - The focus is at the **bottom** row; each person's two biological parents sit as a couple on the row above, recursively.
  - Uses `generation` = −k for k generations up.
  - Union edges link the two parents; the child edge runs down to their child.
  - A person reached twice (pedigree collapse) becomes a `linked` copy.
- `layoutDescendants(doc, { rootId, collapsed? }): LayoutResult` in `src/core/layout/descendants.ts`.
  - Blood descendants only, no spouse cards.
  - Each child edge comes from the parent's bottom centre (`unionId` = the union that holds the child).
- `layoutHourglass(doc, { focusId, collapsed? }): LayoutResult` in `src/core/layout/hourglass.ts`.
  - Pedigree above the focus and the family view below it (focus plus spouses plus descendants), joined at the focus row, which is generation 0.
  - Ancestor generations are negative.
- **Normalization:** in all of them the topmost row has y = 0, the leftmost card has x = 0, and `y = (generation − minGeneration) * ROW_H`.

### Radial and linear layouts (lane T)

- `layoutFan(doc, { focusId, generations }): FanLayout` with `generations` clamped to 2–7.
  - Each ancestor's angular span is half of their child's span.
  - Missing ancestors leave their arc empty (no segment).
  - The focus itself is the centre disc, which is not a segment.
- `layoutTimeline(doc, { rootId }): TimelineLayout`.
  - Covers everyone reachable in the family view from `rootId`.
  - A person with no birth year gets no bar.
  - With no death year: `living` → end = current year (pass `now` as an optional third argument, for tests); not living → end = start + 70 and `endKnown = false`.

### Kinship (lane K): `src/core/kinship/*`

```ts
export type RelationKind =
  | "self" | "parent" | "child" | "grandparent" | "grandchild" | "sibling" | "auncle" | "nibling" | "cousin"
  | "spouse" | "exSpouse" | "stepParent" | "stepChild" | "stepSibling"
  | "parentInLaw" | "childInLaw" | "siblingInLaw" | "otherInLaw";
export type Relationship = {
  kind: RelationKind;
  greats: number;          // grandparent: 0 = grandparent, 1 = great-grandparent ... ; auncle/nibling: 0 = uncle/aunt, 1 = great-uncle
  degree?: number;         // cousin degree (1 = first cousin)
  removal?: number;        // cousin removal (0 = none)
  half: boolean;           // shares only one parent at the closest common ancestor level
  side?: "paternal" | "maternal"; // relative to B: through B's father or mother (for B's ancestors and their descendants)
  sexOfA: "male" | "female";
  path: string[];          // person ids from A to B inclusive, via the common ancestor(s) or spouse link
};
```

- `relate(doc, aId, bId): Relationship[]` describes **A relative to B** ("A is B's …").
  - It returns every distinct relationship, closest first: blood relationships before in-law or step ones, then by path length.
  - It returns `[]` if the two are unrelated.
  - It is pure and uses an LCA over biological parents, with up to 2 parents per person.
- `describeRelationship(rel, aName, bName, t): string` in `src/core/kinship/describe.ts`. This is the one place core may take a `t` function as a parameter (keep it free of i18n imports).
  - It produces English sentences such as "Noor is Adam's first cousin once removed", "Ali is Sara's half-brother", "Zara is Omar's great-great-aunt" and "Hina is Ahmed's sister-in-law".
  - Gendered words are chosen from `sexOfA`.
- `urduTerm(rel): string | null` gives Urdu kinship words in Urdu script for the cases Urdu distinguishes:
  - چچا / تایا (father's brother; younger or older needs birth dates, otherwise use چچا)
  - پھوپھی (father's sister)
  - ماموں (mother's brother)
  - خالہ (mother's sister)
  - دادا / دادی (paternal grandparents)
  - نانا / نانی (maternal grandparents)
  - بھتیجا / بھتیجی (brother's son / daughter)
  - بھانجا / بھانجی (sister's son / daughter)
  - سسر / ساس (parents-in-law)
  - plus the basic terms for parent, child and sibling.
  - Returns null otherwise.
- Tests: table-driven, at least 60 cases covering every kind, the half and step variants, greats up to 3, cousins up to third and twice removed, in-laws in both directions, pedigree collapse giving 2 results, and unrelated → `[]`. Add a property test: `relate(a, b)` is non-empty exactly when `relate(b, a)` is.

### Birthdays (lane U): `src/core/birthdays.ts`

- `upcomingBirthdays(doc, today: Date, days = 30): { personId: string; date: { month: number; day: number }; turning: number | null; inDays: number }[]`
  - Only living people with a known birth month and day.
  - Sorted by `inDays`; Feb 29 falls on Mar 1 in non-leap years.
- `onThisDay(doc, today: Date): { personId: string; kind: "birth" | "death" | "union"; year: number; unionId?: string }[]`

## Lanes

### Lane T: tree, fan and timeline layouts (pure core)

- Implement all five layout functions above in `src/core/layout/`, plus `src/core/views/types.ts`. Reuse the M1 contour packing and edge helpers (`contour.ts`, `edges.ts`).
- Property tests on `arbFamily` and the deep family arbitrary, for each tree layout:
  - no overlapping cards;
  - every card's y matches its generation's row;
  - deterministic output;
  - every ancestor (pedigree) or every descendant (descendants) appears exactly once as non-linked.
- Fan unit tests: spans halve each generation; empty arcs for unknown parents; `generations` is clamped.
- Timeline tests: rows grouped by generation, unknown ends flagged, living people end at `now`.
- Benchmarks: add each new layout at 5k to `scripts/bench-layout.ts` (≤ 300 ms p75).

### Lane K: relationship calculator (pure core)

Implement exactly the kinship contract, with the 60+ table cases and the symmetry property.

### Lane R: fan chart and timeline renderers (React, read-only)

- `src/ui/views/FanChart.tsx` and `src/ui/views/Timeline.tsx`. Props: `{ doc, layout, selectedId, onSelect(personId), dir }`.
- Rendering:
  - SVG arcs and bars, with names on arcs (radial text where it fits, otherwise initials) and the years axis for the timeline;
  - unknown ends fade out (linear gradient); living people get an open end;
  - the selected person is drawn with the accent;
  - pan and zoom via the existing pure `viewport.ts`.
- Each segment or bar is keyboard focusable, with an aria-label from `describePerson`.
- Clicking selects the person. Double-click, or Enter on a focused item, sets the focus person through `onFocus(personId)`.
- Code against the contract types. Use small hand-built `FanLayout` / `TimelineLayout` fixtures in tests, because lane T is being built in parallel.
- Add a dev demo route `/dev/views` (dev only, like `/dev/canvas`).

### Lane U: view switcher, calculator UI, birthdays

- **Store:**
  - add `viewMode: ViewMode` (default `"family"`) and `focusId: string | null` to `editorStore`. Focus defaults to the selection, else the view root, else the tree root.
  - `setViewMode`, `setFocus`.
  - The computed `layout` picks `layoutFamily`, `layoutPedigree`, `layoutDescendants` or `layoutHourglass` by mode.
  - Fan and timeline compute `fanLayout` / `timelineLayout`, rendered by lane R's components, and `layout` keeps the family layout for exports.
  - Code against lane T's contract, using `import`s of the planned module paths. If a module is missing in your worktree, add a typed stub that throws "not built yet" and list it.
- **Toolbar:**
  - a view switcher (a segmented control or menu, with icons and labels): Family, Pedigree, Descendants, Hourglass, Fan, Timeline.
  - Shortcuts Alt+1…6.
  - For pedigree, hourglass and fan, "Focus: {name}" with a way to change the focus (the selected person).
  - Fan and timeline are read-only (FR-V7): hide the "+" handles, drag and drop and editing, but keep selection and the panel read-only.
- **Relationship calculator (FR-K1, K2, K4, K6):**
  - Shift+click a second card while one is selected, or use a "How are we related?" panel with two person pickers (reuse `SearchBox` picker mode).
  - It shows every sentence from `describeRelationship`, plus the `urduTerm` when present, labelled "In Urdu".
  - The path is highlighted on the canvas: add a `highlightPath?: string[]` prop to `Canvas` that draws the path cards and edges in full ink and dims the others to 0.25.
  - Esc clears it.
  - Code against lane K's contract, with stubs if missing.
- **Birthdays panel (FR-B1):** implement `src/core/birthdays.ts` (above) with tests. Add a toolbar button with a badge for the count in the next 7 days, a panel listing upcoming birthdays (name, date, "turns 64", "in 3 days") and "On this day" items; clicking a row selects and centres the person.
- **Exports:** the "current view" scope exports the current tree-shaped layout. Fan and timeline exports are out of scope for M3. The dialog says "Fan and timeline can't be exported yet" and falls back to family.

## Integration and review

1. Merge the lanes in the order T, K, R, U.
2. Integration agent:
   - remove the stubs and wire the real modules;
   - E2E: switch through every view on the `famRemarriage` fixture and a 3-generation pedigree fixture; edit in pedigree; Shift+click the relationship with path highlight; birthdays panel with a mocked date; fan and timeline click-to-select;
   - performance check at 1k people per view;
   - screenshots.
3. One review per merged group: T+K together (core), R+U together (UI). Then the final review and one fix wave.
