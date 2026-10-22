# Stam M1 — Core Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable browser app at `/app` where a user creates family trees on an auto-laid-out SVG canvas with quick-add handles, smart drag & drop, a person side panel, undo/redo, IndexedDB autosave, multiple trees and JSON import/export.

**Architecture:** A pure-TypeScript core (`src/core`: model, dates, commands with immer patches, family-view layout engine) with no DOM access, unit- and property-tested with `bun test`. Persistence (`src/storage`, idb) and JSON I/O (`src/io/json`) sit beside it. A thin React 19 UI (`src/ui`) holds one Zustand store; every edit goes through `applyCommand`, and the canvas renders the pure `LayoutResult` as SVG.

**Tech Stack:** Bun ≥ 1.4.4 (runtime, dev server, bundler, `bun test`, `bun check`, `bun fmt`), oxlint, React 19.3, React Router 8.5 (declarative), Zustand 5, Immer 11, idb 8, nanoid 6, i18next 26 + react-i18next 17, happy-dom 21 + @testing-library/react 16, fast-check 4, fake-indexeddb 6, mitata 1, Playwright 1.64 + @axe-core/playwright 4.14, @fontsource-variable/archivo 5.3.

**Spec:** `docs/superpowers/specs/2026-10-22-stam-prd.md` (M1 row of §6; requirements FR-P*, FR-R*, FR-E*, FR-D*, FR-C*, FR-V1, FR-I1, FR-I5, FR-S*, FR-X7; §8–§11, §12.2 tokens, §13–§14).

## Global Constraints

- Bun is the only toolchain: `bun install`, `bun dev`, `bun run build`, `bun check`, `bun fmt`, `bun run lint` (oxlint), `bun test`. No Vite, Vitest, Biome, Prettier or ESLint. `package.json` has `"engines": { "bun": ">=1.4.4" }`.
- Use the latest versions listed in Tech Stack; pin with `^` ranges in `package.json`.
- Product name comes only from `APP_NAME = "Stam"` in `src/config.ts`; never hard-code the name elsewhere.
- Gender is `'male' | 'female'` only.
- Nothing in `src/core` imports React, DOM APIs, idb or i18n.
- Every edit to a `TreeDocument` goes through `applyCommand`; documents are immutable (immer auto-freeze on).
- All user-visible strings go through i18next `t()` with keys in `src/i18n/locales/en.json` (Urdu/Arabic come in M4). CSS uses logical properties only (`margin-inline-start`, `inset-inline-end`, …) so RTL works later. Every rendered name is wrapped in `<bdi>` (HTML) or has `unicode-bidi: isolate` (SVG text).
- No analytics, no third-party scripts, no cookies, no network calls from `/app`.
- Notes and all user text render as plain text (never `dangerouslySetInnerHTML`).
- Layout constants (px): `CARD_W = 180`, `CARD_H = 72`, `COUPLE_GAP = 32`, `GAP = 40`, `ROW_H = 168`.
- Motion: one easing `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out); layout re-flow 450 ms, card return/hover 250 ms; zero motion under `prefers-reduced-motion: reduce`.
- Design tokens (light): ground `#F4F5F2`, ink `#111311`, muted `#5A615B`, line `rgba(17,19,17,0.14)`, accent `#2B47F5` (selection and "you" only). Card radius 6 px; nothing else rounded. Font: Archivo variable (self-hosted via @fontsource-variable/archivo `wdth.css`), `font-variant-numeric: tabular-nums` for years.
- Undo depth: 200 entries. Autosave: debounce 500 ms, max wait 1000 ms. Snapshots: 5 per tree.
- Zoom range 0.1–4. Drag threshold 5 px; touch long-press 350 ms.
- Property tests read `PROPERTY_RUNS` (default `1000`; `bun run verify` sets `10000`).
- Commit after every task with a conventional-commit message.

## Spec clarifications made by this plan

These resolve gaps in the PRD; they are binding for M1.

1. **FR-C7 (spouse's parents):** a spouse card whose person has parents shows an "↑ View family" button. It sets the **view root** (not `doc.rootPersonId`) to that spouse's topmost biological ancestor and shows a breadcrumb "← Back to {root name}". This keeps the family view a tree.
2. **Root stays on top:** when a command gives the current `doc.rootPersonId` a parent (addParent, addSibling, relinkAsParent targeting root), `rootPersonId` moves to the first partner of the new parent union.
3. **FR-R5/R6 placeholders:** addSibling on a person without a biological parent union creates one union with two placeholders: "Unknown father" (male) and "Unknown mother" (female). Editing a placeholder's name clears `isPlaceholder`.
4. **Unconnected people:** people not reachable from the view root are listed under a toolbar badge "{n} not connected"; clicking one sets the view root to them.
5. **Inline add (FR-E2):** the add command is dispatched immediately with an empty name; confirming amends the same history entry (one undo removes the whole addition); Esc or confirming an empty name undoes it and drops the redo entry.
6. **Name entry:** one "Name" field. Two or more words → last word is `lastName`, the rest `firstName`. One word → `firstName`, and for child/sibling adds `lastName` is inherited from the person whose handle was used.
7. **Gender defaults:** spouse = opposite of partner (preselected); parent = opposite of existing parent if one exists, else must be chosen; child, sibling and first person must be chosen (toggle highlighted, Enter blocked with message "Choose ♂ or ♀").
8. **FR-R8 default order:** addChild inserts the child before the first sibling with a later birth date; children without a birth date go last.
9. **Out of M1:** service worker/offline, other views, exports other than JSON, GEDCOM, Urdu/Arabic, dark theme (tokens only), landing page (`/` is a minimal static placeholder).

## Review Focus

1. **Cousin marriage / pedigree collapse:** a person reachable twice must be placed once as primary, all other appearances as linked copies, and layout must terminate. → Task 9 test `cousin marriage yields one primary and one linked copy`.
2. **Deleting a sole partner or the root:** no dangling references; orphaned unions removed; root reassigned (partner → first child → any person → undefined). → Task 6 tests `delete sole partner removes union and keeps children` and `delete root reassigns root`.
3. **Add-then-cancel and add-then-name undo:** Esc leaves the document byte-identical to before with no redo entry; naming then undoing removes the person in one step. → Task 14 tests `inline add cancel restores doc and clears redo` and `inline add confirm is one undo step`.
4. **Corrupted saved data or bad import file:** the app recovers from the newest valid snapshot or shows a clear error, never crashes and never overwrites an existing tree. → Task 12 test `rejects future schemaVersion and malformed JSON`, Task 13 test `getTree falls back to newest valid snapshot`.
5. **Mixed-script names:** an Urdu `nativeName` next to a Latin name renders in an isolated bidi run in both the card and the panel. → Task 16 test `card isolates native-script name`.

---

## File Structure

```
package.json  bunfig.toml  tsconfig.json  .oxlintrc.json  bun-env.d.ts  README.md
public/_redirects  public/_headers
scripts/build.ts  scripts/serve-dist.ts  scripts/bench-layout.ts
src/
  config.ts                     APP_NAME, limits
  server.ts                     Bun dev server
  index.html                    "/" placeholder page (static, no JS)
  app.html                      "/app" shell
  app/main.tsx                  React entry
  core/
    model/types.ts  ids.ts  tree.ts  validate.ts
    dates/fuzzy.ts
    commands/types.ts  errors.ts  apply.ts  people.ts  relations.ts  relink.ts  remove.ts  validActions.ts  history.ts
    layout/constants.ts  types.ts  blocks.ts  contour.ts  edges.ts  family.ts
    search.ts
  io/json/stamJson.ts  migrations.ts
  storage/db.ts  treeRepo.ts  autosave.ts  backupReminder.ts  multitab.ts  persist.ts
  i18n/index.ts  locales/en.json
  ui/
    styles/tokens.css  app.css
    store/editorStore.ts  useEditor.ts
    app/AppRoutes.tsx  TreeListPage.tsx  EditorPage.tsx  Toolbar.tsx  SaveStatus.tsx  BackupBanner.tsx  UnconnectedList.tsx
    canvas/Canvas.tsx  viewport.ts  usePanZoom.ts  useLayoutTween.ts  Edges.tsx  GenerationRuler.tsx  Minimap.tsx
    cards/PersonCard.tsx  Handles.tsx  InlineEditor.tsx  nameEntry.ts  describe.ts
    keyboard/navigation.ts  useShortcuts.ts
    dnd/resolveDrop.ts  useDrag.ts  DropMenu.tsx
    panels/PersonPanel.tsx  DateField.tsx  DeleteDialog.tsx  SearchBox.tsx
    photos/resizePhoto.ts
tests/            mirrors src/ (e.g. tests/core/dates/fuzzy.test.ts), plus tests/setup.ts, tests/fixtures/
e2e/              Playwright specs + playwright.config.ts
```

---

### Task 1: Project scaffold and toolchain

**Files:**
- Create: `package.json`, `bunfig.toml`, `tsconfig.json`, `.oxlintrc.json`, `bun-env.d.ts`, `src/config.ts`, `src/server.ts`, `src/index.html`, `src/app.html`, `src/app/main.tsx`, `tests/setup.ts`, `README.md`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `APP_NAME: "Stam"`, `UNDO_LIMIT = 200`, `SNAPSHOT_LIMIT = 5`, `AUTOSAVE_DEBOUNCE_MS = 500`, `AUTOSAVE_MAX_WAIT_MS = 1000` from `src/config.ts`; scripts `dev`, `build`, `lint`, `test`, `e2e`, `bench`, `verify`.

- [ ] **Step 1: Upgrade Bun and scaffold.** Run `bun upgrade` and confirm `bun --version` ≥ 1.4.4. Use `bun init --react -y` in a scratch directory as reference only; write the files below by hand (no Tailwind, no template demo files).
- [ ] **Step 2: Write `package.json`** with `"type": "module"`, `"private": true`, `"engines": {"bun": ">=1.4.4"}`, dependencies from Tech Stack, and scripts:
  - `dev`: `bun --hot src/server.ts`
  - `build`: `bun run scripts/build.ts` (Task 20 creates it; until then `echo "build lands in Task 20"`)
  - `lint`: `oxlint`
  - `test`: `bun test`
  - `e2e`: `bunx playwright test`
  - `bench`: `bun run scripts/bench-layout.ts`
  - `verify`: `bun check && bun fmt --check && bun run lint && PROPERTY_RUNS=10000 bun test`
- [ ] **Step 3: Config files.** `tsconfig.json` = the Bun React template's options plus `"noUnusedLocals": true`, `"noUnusedParameters": true`, `"exactOptionalPropertyTypes": false`, `"paths": {"@/*": ["./src/*"]}`. `bunfig.toml`: `[fmt]` with `printWidth = 100`, `sortImports = true`; `[test]` with `preload = ["./tests/setup.ts"]`. `tests/setup.ts` registers `@happy-dom/global-registrator` and imports `fake-indexeddb/auto`. `.oxlintrc.json`: plugins `react`, `jsx-a11y`, `typescript`, `unicorn`; categories `correctness: error`, `suspicious: warn`; rules `react-hooks/rules-of-hooks: error`, `react-hooks/exhaustive-deps: error`.
- [ ] **Step 4: Write the failing test** `tests/config.test.ts`:

```ts
import { expect, test } from "bun:test";
import { APP_NAME, UNDO_LIMIT, SNAPSHOT_LIMIT } from "@/config";
test("config pins product constants", () => {
  expect(APP_NAME).toBe("Stam");
  expect(UNDO_LIMIT).toBe(200);
  expect(SNAPSHOT_LIMIT).toBe(5);
});
```

- [ ] **Step 5: Run** `bun test tests/config.test.ts` → FAIL (module not found).
- [ ] **Step 6: Implement** `src/config.ts`; `src/server.ts` using `Bun.serve({ routes: { "/": indexHtml, "/app": appHtml, "/app/*": appHtml }, development: { hmr: true, console: true } })`; `src/index.html` (static page: `<h1>` "{APP_NAME}", one sentence, link "Open the app" → `/app`; no script); `src/app.html` (`<div id="root">`, `<script type="module" src="./app/main.tsx">`); `src/app/main.tsx` rendering a placeholder `<main>` with the `import.meta.hot.data.root ??= createRoot(...)` pattern from the template.
- [ ] **Step 7: Verify.** `bun test` → PASS. `bun run verify` → exit 0. `bun dev`, then `curl -s localhost:3000/app/t/x | grep 'id="root"'` and `curl -s localhost:3000/ | grep '<h1'` both match.
- [ ] **Step 8: Commit** `chore: scaffold Bun + React toolchain`.

---

### Task 2: Fuzzy dates

**Files:**
- Create: `src/core/dates/fuzzy.ts`
- Test: `tests/core/dates/fuzzy.test.ts`

**Interfaces:**
- Produces:
  - `type FuzzyDate = { qualifier?: 'about' | 'before' | 'after' | 'between'; year?: number; month?: number; day?: number; toYear?: number }` (exported from here and re-exported by `core/model/types.ts`)
  - `parseFuzzyDate(input: string): { ok: true; date: FuzzyDate } | { ok: false; error: 'EMPTY' | 'INVALID' }`
  - `formatFuzzyDate(d: FuzzyDate): string`
  - `compareFuzzyDate(a?: FuzzyDate, b?: FuzzyDate): number` (undefined sorts last)
  - `lifespanLabel(birth?: FuzzyDate, death?: FuzzyDate, isLiving?: boolean): string`

- [ ] **Step 1: Write the failing tests** (table-driven):

```ts
const ok: [string, FuzzyDate][] = [
  ["1950", { year: 1950 }],
  ["1950-03", { year: 1950, month: 3 }],
  ["1950-03-14", { year: 1950, month: 3, day: 14 }],
  ["abt 1950", { qualifier: "about", year: 1950 }],
  ["~1950", { qualifier: "about", year: 1950 }],
  ["c. 1950", { qualifier: "about", year: 1950 }],
  ["bef 1950", { qualifier: "before", year: 1950 }],
  ["aft 1950-03", { qualifier: "after", year: 1950, month: 3 }],
  ["1948–1952", { qualifier: "between", year: 1948, toYear: 1952 }],
  ["1948-1952", { qualifier: "between", year: 1948, toYear: 1952 }],
  ["bet 1948 and 1952", { qualifier: "between", year: 1948, toYear: 1952 }],
  ["  2000-02-29 ", { year: 2000, month: 2, day: 29 }],
];
const bad = ["1950-13", "1900-02-29", "1952–1948", "abc", "0", "10000"];
// parseFuzzyDate("") → { ok:false, error:"EMPTY" }
// formatFuzzyDate: {year:1950}→"1950"; {year:1950,month:3}→"Mar 1950"; {year:1950,month:3,day:14}→"14 Mar 1950";
//   about→"abt 1950"; before→"bef 1950"; after→"aft 1950"; between→"1948–1952"
// compareFuzzyDate({year:1950},{year:1950,month:1}) < 0; compareFuzzyDate({year:1950}, undefined) < 0
// lifespanLabel({year:1950},{year:2019}) === "1950 – †2019"; lifespanLabel({year:1950},undefined,true) === "1950";
// lifespanLabel(undefined,{year:2019}) === "? – †2019"; lifespanLabel(undefined,undefined,false) === "†"; lifespanLabel(undefined,undefined,true) === ""
```

- [ ] **Step 2: Run** `bun test tests/core/dates` → FAIL.
- [ ] **Step 3: Implement** in `src/core/dates/fuzzy.ts`. Case-insensitive prefixes: about = `abt|about|~|c.|ca|circa`; before = `bef|before|<`; after = `aft|after|>`. Years 1–9999; validate day against month length with Gregorian leap years. Range end must be ≥ start. Month names for formatting come from a fixed English array (M4 localizes).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): fuzzy date parse/format/compare`.

---

### Task 3: Data model, queries and validation

**Files:**
- Create: `src/core/model/types.ts`, `src/core/model/ids.ts`, `src/core/model/tree.ts`, `src/core/model/validate.ts`
- Test: `tests/core/model/tree.test.ts`, `tests/core/model/validate.test.ts`, `tests/fixtures/families.ts`

**Interfaces:**
- Consumes: `FuzzyDate` (Task 2).
- Produces:
  - Types exactly as PRD §9 (`Gender`, `Person`, `Union`, `UnionStatus`, `ChildType`, `TreeDocument` with `schemaVersion: 1`), plus `type PersonInput = Partial<Omit<Person, 'id'>> & { gender: Gender }`.
  - `newId(): string` (nanoid, 12 chars).
  - `createTree(name: string, now?: Date): TreeDocument`
  - `unionsOf(doc, personId): Union[]` (in `unionOrder` order), `parentUnionOf(doc, personId, type?: ChildType = 'biological'): Union | undefined`, `parentsOf(doc, personId): string[]` (biological), `childrenOf(doc, personId): string[]`, `partnersOf(doc, personId): string[]`, `siblingsOf(doc, personId): { personId: string; half: boolean }[]`, `isAncestor(doc, ancestorId, personId): boolean` (any child type), `descendantsOf(doc, personId): Set<string>`, `topmostAncestor(doc, personId): string` (follows first biological parent), `displayName(p: Person): string`.
  - `type Issue = { code: 'DANGLING_REF' | 'MULTIPLE_BIO_PARENTS' | 'CYCLE' | 'EMPTY_UNION' | 'BAD_ROOT' | 'UNION_ORDER_MISMATCH' | 'DUPLICATE_CHILD'; message: string; ids: string[] }`
  - `validate(doc: TreeDocument): Issue[]`
  - `tests/fixtures/families.ts` builders: `famSimple()` (couple + 3 children), `famRemarriage()` (person with two unions, children in each), `famHalfSiblings()`, `famCousinMarriage()` (two first cousins married with a child), `famAdoption()` — written with raw object literals (commands don't exist yet).

- [ ] **Step 1: Write the failing tests:** `siblingsOf` on `famHalfSiblings()` returns the half-sibling with `half: true` and full siblings with `half: false`; `isAncestor(grandparent, grandchild)` true and reverse false; `topmostAncestor` of a grandchild is the first grandparent; `displayName` of `{firstName:"Ali", lastName:"Khan"}` is `"Ali Khan"`; of a placeholder with empty names it is `""` (the UI supplies the translated "Unknown father/mother"). `validate` returns `[]` for every fixture, and returns exactly one issue with the right code for each of: a union child id missing from `persons` (`DANGLING_REF`), a person biological child of two unions (`MULTIPLE_BIO_PARENTS`), A child of B and B child of A (`CYCLE`), union with `partners: []` (`EMPTY_UNION`), `rootPersonId` not in `persons` (`BAD_ROOT`), a union missing from its partner's `unionOrder` (`UNION_ORDER_MISMATCH`), same child twice in one union (`DUPLICATE_CHILD`).
- [ ] **Step 2: Run** `bun test tests/core/model` → FAIL.
- [ ] **Step 3: Implement** the four files. `isAncestor`/`CYCLE` use iterative DFS with a visited set (no recursion; trees reach 5,000 people).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): data model, relationship queries, validation`.

---

### Task 4: Command infrastructure and person commands

**Files:**
- Create: `src/core/commands/types.ts`, `src/core/commands/errors.ts`, `src/core/commands/apply.ts`, `src/core/commands/people.ts`
- Test: `tests/core/commands/people.test.ts`

**Interfaces:**
- Consumes: Task 3 model.
- Produces:
  - `type Command =`
    `| { type: 'addPerson'; person: PersonInput }`
    `| { type: 'updatePerson'; personId: string; patch: Partial<Omit<Person, 'id'>> }`
    `| { type: 'updateUnion'; unionId: string; patch: Partial<Pick<Union, 'status' | 'start' | 'end'>> }`
    `| { type: 'setRoot'; personId: string }`
    `| { type: 'renameTree'; name: string }`
    `| { type: 'addChild'; parentId: string; unionId?: string; child: PersonInput; childType?: ChildType }`
    `| { type: 'addSpouse'; personId: string; spouse: PersonInput; status?: UnionStatus }`
    `| { type: 'addParent'; childId: string; parent: PersonInput }`
    `| { type: 'addSibling'; personId: string; sibling: PersonInput }`
    `| { type: 'reorderChild'; unionId: string; personId: string; toIndex: number }`
    `| { type: 'setChildType'; unionId: string; personId: string; childType: ChildType }`
    `| { type: 'relinkAsChild'; personId: string; parentId: string; unionId?: string }`
    `| { type: 'relinkAsSpouse'; personId: string; targetId: string }`
    `| { type: 'relinkAsParent'; personId: string; childId: string }`
    `| { type: 'deletePerson'; personId: string; mode: 'person' | 'withDescendants' }`
  - `class CommandError extends Error { code: 'NOT_FOUND' | 'CYCLE' | 'AMBIGUOUS_UNION' | 'PARENTS_FULL' | 'ALREADY_LINKED' | 'INVALID' }`
  - `type CommandResult = { doc: TreeDocument; patches: Patch[]; inversePatches: Patch[]; createdIds: string[] }` (immer `Patch`)
  - `applyCommand(doc: TreeDocument, cmd: Command, now?: Date): CommandResult` — wraps `produceWithPatches` (call `enablePatches()` once), dispatches to handler modules, sets `updatedAt`, and in a debug guard (`process.env.NODE_ENV !== 'production'`) throws `CommandError('INVALID')` if `validate(result)` is non-empty.

- [ ] **Step 1: Write the failing tests:** `addPerson` on an empty tree creates one person and sets `rootPersonId`; a second `addPerson` leaves root unchanged; `createdIds` holds the new id. `updatePerson` with `firstName` on a placeholder clears `isPlaceholder`. `updateUnion` changes status. `setRoot` on unknown id throws `CommandError` with `code === 'NOT_FOUND'`. `renameTree` trims and rejects empty (`INVALID`). `applyPatches(result.doc, result.inversePatches)` deep-equals the input doc for each command. Input doc is never mutated (`Object.isFrozen`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Handler signature inside modules: `(draft: Draft<TreeDocument>, cmd, ctx: { created: string[] }) => void`. Unimplemented command types throw `CommandError('INVALID', 'not implemented')` until Tasks 5–6.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(core): command pipeline with immer patches`.

---

### Task 5: Relationship commands

**Files:**
- Create: `src/core/commands/relations.ts`
- Modify: `src/core/commands/apply.ts` (dispatch)
- Test: `tests/core/commands/relations.test.ts`

**Interfaces:**
- Consumes: Task 4 `Command`, `CommandError`, `applyCommand`.
- Produces: behavior of `addChild`, `addSpouse`, `addParent`, `addSibling`, `reorderChild`, `setChildType`.

Rules (each is a test):
- **addChild:** `unionId` given → use it (must contain `parentId`, else `INVALID`). Omitted: parent has 0 unions → create union `{partners:[parentId], status:'partner'}`; exactly 1 → use it; ≥ 2 → `AMBIGUOUS_UNION`. Insert per clarification 8. `childType` default `'biological'`.
- **addSpouse:** if the person has a union whose `partners` is just `[personId]`, fill its second partner (keeps its children); else create a new union `{partners:[personId, spouseId], status: cmd.status ?? 'married'}` and add it to both `unionOrder`s: before the first union with a later `start` date, else at the end (FR-R9).
- **addParent:** child's biological parent union: none → create `{partners:[parentId], status:'partner'}` containing the child; 1 partner → add as second partner, status becomes `'married'`; 2 partners → `PARENTS_FULL`. Apply clarification 2 (root moves up).
- **addSibling:** person has biological parent union → append sibling to it. None → create placeholders per clarification 3, put person and sibling in the new union (person first), apply clarification 2.
- **reorderChild:** moves within the union; `toIndex` clamped to `[0, children.length - 1]`.
- **setChildType:** changing to `'biological'` when the child is already a biological child of another union → `INVALID`.

- [ ] **Step 1: Write the failing tests** — one per rule above, including: `addChild` to a parent with two unions throws `AMBIGUOUS_UNION`; `addChild` with birth `1955` into children born `[1950, 1960, undefined]` lands at index 1; `addParent` on the root moves `rootPersonId` to the new parent; `addSibling` on a parentless root creates "Unknown father"/"Unknown mother" placeholders (`isPlaceholder: true`, genders male/female) and the root becomes the placeholder father; `addSpouse` on a single-parent union keeps the existing children in that union.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `src/core/commands/relations.ts`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): add child/spouse/parent/sibling and ordering commands`.

---

### Task 6: Relink, delete and drop validity

**Files:**
- Create: `src/core/commands/relink.ts`, `src/core/commands/remove.ts`, `src/core/commands/validActions.ts`
- Modify: `src/core/commands/apply.ts`
- Test: `tests/core/commands/relink.test.ts`, `tests/core/commands/remove.test.ts`

**Interfaces:**
- Produces:
  - `type DropAction = 'child' | 'spouse' | 'parent'`
  - `validDropActions(doc, draggedId: string, targetId: string): DropAction[]` — ordered `['child','spouse','parent']` filtered by:
    - `child` (dragged becomes child of target): target ≠ dragged, target not a descendant of dragged, dragged not already a child of target.
    - `spouse`: different people, neither is an ancestor of the other, not already partners.
    - `parent` (dragged becomes parent of target): target not an ancestor of dragged, target not dragged, target has < 2 biological parents, dragged not already its parent.
  - `relinkAsChild` removes the dragged person's **biological** child link (other link types stay) then adds them like `addChild` with an existing person (same union rules incl. `AMBIGUOUS_UNION`). `relinkAsSpouse` creates a new married union. `relinkAsParent` adds the existing person like `addParent` (clarification 2 applies). Any action not in `validDropActions` throws `CYCLE` (if it would create a cycle) or `ALREADY_LINKED`.
  - `deletePerson` mode `'person'`: remove the person from every union; drop unions left with no partners (their children lose that parent link); remove from `unionOrder`s; delete the person. Mode `'withDescendants'`: delete the person and every `descendantsOf` person, then clean unions the same way. Root reassignment if the root is deleted: first remaining partner of the old root → first remaining child → first remaining person by insertion order → `undefined`.

- [ ] **Step 1: Write the failing tests:** each `validDropActions` rule (e.g. dragging a grandparent onto a grandchild yields no `child` action); `relinkAsChild` moves a subtree (the moved person's descendants keep their links); `relinkAsChild` into own descendant throws `CYCLE`; `delete sole partner removes union and keeps children` (children exist, no parent link); `delete root reassigns root` (to partner); `withDescendants` on a grandparent leaves only in-laws not descended from them; inverse patches restore every case.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): relink, delete and drop validity`.

---

### Task 7: Undo/redo history

**Files:**
- Create: `src/core/commands/history.ts`
- Test: `tests/core/commands/history.test.ts`

**Interfaces:**
- Consumes: `CommandResult` (Task 4), `UNDO_LIMIT` (Task 1).
- Produces: `type HistoryEntry = { label: string; patches: Patch[]; inversePatches: Patch[] }` and `class History { constructor(limit = UNDO_LIMIT); push(e: HistoryEntry): void; amend(e: HistoryEntry): void; undo(doc: TreeDocument): TreeDocument | null; redo(doc: TreeDocument): TreeDocument | null; dropRedo(): void; clear(): void; get canUndo(): boolean; get canRedo(): boolean }`.
  - `push` clears the redo stack; beyond `limit` the oldest entry is discarded.
  - `amend` appends `e.patches` to the last entry's patches and prepends `e.inversePatches` to its inverse patches (so one undo reverts both).

- [ ] **Step 1: Write the failing tests:** push/undo/redo round-trip equality; 201 pushes keep 200 undos; push after undo clears redo; `amend` then a single `undo` returns the doc from before the original push; `dropRedo` after `undo` makes `canRedo` false.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with immer `applyPatches`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): undo/redo history with amend`.

---

### Task 8: Random family generator and command property tests

**Files:**
- Create: `tests/fixtures/arbitraries.ts`
- Test: `tests/core/commands/properties.test.ts`

**Interfaces:**
- Produces: `arbFamily(opts?: { maxOps?: number }): fc.Arbitrary<TreeDocument>` — builds a doc by applying a random sequence (default ≤ 60) of `addChild` / `addSpouse` / `addParent` / `addSibling` / `reorderChild` / `relinkAsChild` / `relinkAsSpouse` / `deletePerson` commands to random existing people, skipping commands that throw `CommandError`. Also `arbFamilyOps()` returning the command list for shrinking. `runs()` helper = `Number(process.env.PROPERTY_RUNS ?? 1000)`.

- [ ] **Step 1: Write the property tests:** for every generated doc `validate(doc)` is `[]`; applying any one further random command then its `inversePatches` returns a deep-equal doc; no person is their own ancestor.
- [ ] **Step 2: Run** `bun test tests/core/commands/properties.test.ts` → PASS (or shrink and fix the command bug found, adding a regression example test to the owning task's test file).
- [ ] **Step 3: Commit** `test(core): property tests over random families`.

---

### Task 9: Layout — block tree traversal

**Files:**
- Create: `src/core/layout/constants.ts`, `src/core/layout/types.ts`, `src/core/layout/blocks.ts`
- Test: `tests/core/layout/blocks.test.ts`

**Interfaces:**
- Produces:
  - constants per Global Constraints.
  - `type NodeKind = 'blood' | 'spouse' | 'linked'`
  - `type Block = { bloodNodeId: string; members: BlockMember[]; unions: { unionId: string; anchorBetween: [number, number]; children: Block[] }[]; hiddenCount: number; depth: number }` where `BlockMember = { nodeId: string; personId: string; kind: NodeKind }` and `anchorBetween` holds the indexes of the two member cards whose gap carries the union (single-parent union: `[i, i]`).
  - `buildBlockTree(doc, rootId: string, collapsed: ReadonlySet<string>): { root: Block; primaryNode: Record<string, string>; unreachable: string[] }`

Algorithm (iterative DFS in child order; this is the part the tests pin):
1. A person's **first** placement is primary (`nodeId = personId`); any later appearance is a `linked` node with `nodeId = \`${personId}~${n}\`` and is always a leaf.
2. Each union is laid out at most once.
3. Blood person P with unions `[U1..Un]` (from `unionOrder`) and partners `[S1..Sn]`: members are `[P, S1]` for n = 1, `[S1, P, S2, …, Sn]` for n ≥ 2. Union `Ui` anchors to the gap left of `Si` for i ≥ 2 and the gap between `S1` and `P` for i = 1. A partner already placed elsewhere becomes a `linked` member.
4. Children of all unions are visited in union order, then child order; a child already placed becomes a `linked` leaf block.
5. If P is in `collapsed`, skip its unions' children and set `hiddenCount` = size of `descendantsOf(P)` minus any already placed.
6. `unreachable` = persons never placed, in insertion order.

- [ ] **Step 1: Write the failing tests:** `famSimple` → root block with 2 members and 3 child blocks; `famRemarriage` → members `[S1, P, S2]` with two union entries; `cousin marriage yields one primary and one linked copy` (the second cousin appears as `linked`, layout terminates, the couple's child appears once); collapsed root → zero child blocks, `hiddenCount` = descendants; a person added with `addPerson` and no links shows up in `unreachable`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(layout): block tree with linked copies and collapse`.

---

### Task 10: Layout — geometry, connectors and properties

**Files:**
- Create: `src/core/layout/contour.ts`, `src/core/layout/edges.ts`, `src/core/layout/family.ts`
- Test: `tests/core/layout/family.test.ts`, `tests/core/layout/properties.test.ts`, `tests/core/layout/__snapshots__/`

**Interfaces:**
- Consumes: Task 9 `buildBlockTree`.
- Produces:
  - `type LayoutNode = { nodeId: string; personId: string; kind: NodeKind; x: number; y: number; generation: number; hiddenCount: number }` (x, y = card top-left)
  - `type LayoutEdge = { id: string; kind: 'union' | 'child'; unionId: string; status?: UnionStatus; childType?: ChildType; points: [number, number][] }`
  - `type LayoutResult = { nodes: LayoutNode[]; edges: LayoutEdge[]; bounds: { x: number; y: number; width: number; height: number }; generationCount: number; primaryNode: Record<string, string>; unreachable: string[] }`
  - `layoutFamily(doc: TreeDocument, opts: { rootId: string; collapsed?: ReadonlySet<string> }): LayoutResult`

Geometry rules:
- `y = depth * ROW_H`. Block width = `members * CARD_W + (members - 1) * COUPLE_GAP`.
- Bottom-up: each block subtree has a contour (per relative depth: `[minX, maxX]`). Child blocks of a block (all unions, in order) are packed left to right: each next subtree is shifted right by the max over shared depths of `prev.max - next.min + GAP`. The block is then centred over the span from the first child's block centre to the last child's block centre. A leaf block's contour is its own width.
- Normalize so the leftmost card has `x = 0`; root row `y = 0`.
- Edges: `union` edge = horizontal line at card mid-height across the anchor gap (for a third or later spouse: an over-bracket from P's top centre up 12 px, across, down to `Si`'s top centre). `child` edge per child = polyline from the union anchor point at mid-height down to a sibling bar at `y = parentRowTop + CARD_H + 24 + 8 * unionIndex`, along the bar, down to the child's top centre. `status` and `childType` copied for styling.

- [ ] **Step 1: Write the failing tests:** `famSimple` snapshot (`expect(layout).toMatchSnapshot()`); parent block centre equals the midpoint of its children span within 0.5 px; `layoutFamily` of a single person returns one node at `(0,0)`. Property tests over `arbFamily()` using `runs()`: no two node rectangles intersect; every node's `y === generation * ROW_H`; every child edge's last point equals its child's top centre; layout is deterministic (two calls deep-equal); every reachable person appears exactly once with `kind !== 'linked'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(layout): tidy family layout with connectors`.

---

### Task 11: Layout benchmarks

**Files:**
- Create: `scripts/bench-layout.ts`, `tests/fixtures/bigFamily.ts`

**Interfaces:**
- Produces: `bigFamily(people: number, seed = 42): TreeDocument` — a deterministic balanced family (4 children per couple, every blood descendant married) via `applyCommand`.

- [ ] **Step 1: Write** `scripts/bench-layout.ts` using mitata to time `layoutFamily` on `bigFamily(1000)` and `bigFamily(5000)`; after the run, exit with code 1 if the p75 exceeds 50 ms (1k) or 300 ms (5k), printing the numbers.
- [ ] **Step 2: Run** `bun run bench` → prints both timings and exits 0. If over budget, profile and fix the layout (typical fix: replace per-depth contour arrays with linked contour lists).
- [ ] **Step 3: Commit** `perf(layout): benchmarks with budgets`.

---

### Task 12: JSON import/export

**Files:**
- Create: `src/io/json/stamJson.ts`, `src/io/json/migrations.ts`
- Test: `tests/io/json/stamJson.test.ts`

**Interfaces:**
- Produces:
  - File shape: `{ format: 'stam', schemaVersion: 1, exportedAt: string, tree: TreeDocument, photos?: Record<string, string /* data URL */> }`
  - `exportStamJson(doc: TreeDocument, photos: Record<string, Blob>, opts: { includePhotos: boolean }): Promise<string>`
  - `class ImportError extends Error { code: 'NOT_JSON' | 'NOT_STAM' | 'FUTURE_VERSION' | 'INVALID_TREE' | 'TOO_LARGE' }`
  - `importStamJson(text: string): Promise<{ doc: TreeDocument; photos: Record<string, Blob>; warnings: string[] }>` — rejects input over 50 MB (`TOO_LARGE`); runs `migrations[v]` up to 1; checks field types by hand (no schema library) then `validate()`; drops photos whose data URL does not match `^data:image\/(webp|png|jpeg);base64,` (warning); assigns a **new** tree id and fresh `createdAt` (FR-I5); keeps person/union ids.
  - `backupFileName(doc: TreeDocument, now?: Date): string` → `"{slug}-{yyyy-mm-dd}.stam.json"`.

- [ ] **Step 1: Write the failing tests:** round trip of every fixture (with and without photos) deep-equals except tree id and `createdAt`; `rejects future schemaVersion and malformed JSON` (`FUTURE_VERSION`, `NOT_JSON`, `NOT_STAM`, `INVALID_TREE` for a dangling child id); a `javascript:` photo URL is dropped with one warning; `backupFileName` for "Khan Family" on 2026-10-23 is `"khan-family-2026-10-23.stam.json"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(io): Stam JSON import/export`.

---

### Task 13: Storage, autosave and backup reminder

**Files:**
- Create: `src/storage/db.ts`, `src/storage/treeRepo.ts`, `src/storage/autosave.ts`, `src/storage/backupReminder.ts`, `src/storage/multitab.ts`, `src/storage/persist.ts`
- Test: `tests/storage/treeRepo.test.ts`, `tests/storage/autosave.test.ts`, `tests/storage/backupReminder.test.ts`

**Interfaces:**
- Produces:
  - `openStamDb(name = 'stam'): Promise<IDBPDatabase>` — v1 stores: `trees` (key `id`), `meta` (key `id`: `{ id, name, peopleCount, updatedAt }`), `photos` (key photoId → Blob), `snapshots` (autoIncrement, index `treeId`, value `{ treeId, takenAt, doc }`), `settings` (key string).
  - `type TreeMeta = { id: string; name: string; peopleCount: number; updatedAt: string }`
  - `createTreeRepo(db): TreeRepo` with `listTrees(): Promise<TreeMeta[]>` (newest first), `getTree(id): Promise<{ doc: TreeDocument; recoveredFromSnapshot: boolean } | null>`, `saveTree(doc): Promise<void>` (writes tree + meta in one transaction), `deleteTree(id)`, `duplicateTree(id, name): Promise<TreeDocument>`, `putPhoto(id, blob)`, `getPhoto(id): Promise<Blob | undefined>`, `takeSnapshot(doc): Promise<void>` (keeps newest `SNAPSHOT_LIMIT`), `getSetting<T>(key): Promise<T | undefined>`, `setSetting(key, value)`.
  - `createAutosaver(save: (doc: TreeDocument) => Promise<void>, opts?: { debounceMs?: number; maxWaitMs?: number; timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; now: () => number } }): { schedule(doc): void; flush(): Promise<void>; onStatus(cb: (s: 'idle' | 'saving' | 'saved' | 'error') => void): () => void }` and `type Autosaver = ReturnType<typeof createAutosaver>`. `timers` defaults to the globals; tests pass a manual fake clock.
  - `recordEditDay(state: BackupState, today: string): BackupState`, `shouldRemindBackup(state: BackupState): boolean` (true when ≥ 7 distinct edit days since `lastBackupAt`), `markBackedUp(state, today): BackupState`; `type BackupState = { lastBackupAt?: string; editDays: string[] }`.
  - `createTabSync(treeId: string, onRemoteSave: () => void): { announceSave(updatedAt: string): void; close(): void }` (BroadcastChannel `'stam'`, ignores own tab id).
  - `requestPersistentStorage(): Promise<boolean>`, `storagePressure(): Promise<number>` (usage / quota, 0 when unknown).

- [ ] **Step 1: Write the failing tests** (fake-indexeddb): save/list/get round trip; `listTrees` order; `deleteTree` removes meta, tree and its snapshots; six `takeSnapshot` calls keep five; `getTree falls back to newest valid snapshot` (write a tree record that fails `validate` and expect `recoveredFromSnapshot: true`); autosave with a manual fake clock passed as `timers`: three `schedule` calls within 400 ms save once after 500 ms; continuous scheduling every 300 ms still saves by 1000 ms; a rejected save emits `'error'`; backup: 7 distinct days → remind, duplicate days don't count, `markBackedUp` resets.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(storage): IndexedDB repo, autosave, snapshots, backup reminder`.

---

### Task 14: Editor store

**Files:**
- Create: `src/ui/store/editorStore.ts`, `src/ui/store/useEditor.ts`, `src/core/search.ts`
- Test: `tests/ui/store/editorStore.test.ts`, `tests/core/search.test.ts`

**Interfaces:**
- Consumes: `applyCommand`, `History`, `layoutFamily`, `TreeRepo`, autosaver, `topmostAncestor`.
- Produces:
  - `searchPeople(doc, query: string, limit = 20): string[]` — matches `firstName`, `lastName`, `nickname`, `nativeName`; case- and diacritic-insensitive (NFD, strip `\p{M}`); prefix matches rank before substring matches.
  - `createEditorStore(deps: { repo: TreeRepo; autosaver: Autosaver; now?: () => Date })` returning a Zustand vanilla store with state `{ doc: TreeDocument | null; viewRootId: string | null; selectedId: string | null; collapsed: ReadonlySet<string>; focusMode: boolean; editing: { personId: string; role: 'first' | 'child' | 'spouse' | 'parent' | 'sibling'; fromId?: string } | null; layout: LayoutResult | null; canUndo: boolean; canRedo: boolean; error: string | null }` and actions:
    - `load(treeId): Promise<void>` (takes a snapshot on open and again every 10 minutes while edits keep arriving), `dispatch(cmd: Command, label: string): string[] | null` (returns `createdIds`; on `CommandError` sets `error` to the code and returns null), `amendLast(cmd, label)`, `cancelLastAdd()` (undo + `dropRedo`), `undo()`, `redo()`, `select(id | null)`, `setViewRoot(id | null)` (null = `doc.rootPersonId`), `toggleCollapse(personId)`, `setFocusMode(on)`, `startEditing(...)`, `stopEditing()`.
    - Every doc change recomputes `layout` with `layoutFamily(doc, { rootId: viewRootId ?? doc.rootPersonId, collapsed })` and calls `autosaver.schedule(doc)`.
  - `useEditor<T>(selector: (s) => T): T` React hook bound to the app's store instance (context provider in `EditorPage`).

- [ ] **Step 1: Write the failing tests:** dispatch updates `layout` and schedules autosave; `inline add cancel restores doc and clears redo`; `inline add confirm is one undo step` (dispatch `addChild` with empty name, `amendLast` `updatePerson`, one `undo` → doc deep-equals the original); `setViewRoot` re-lays out from the new root without touching `doc.rootPersonId`; deleting the selected person clears `selectedId`; search: "ali" finds "Ali" and "Alia" before "Khalid"; "zoe" finds "Zoë".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ui): editor store and people search`.

---

### Task 15: App shell, routing, i18n, tokens, tree list

**Files:**
- Create: `src/i18n/index.ts`, `src/i18n/locales/en.json`, `src/ui/styles/tokens.css`, `src/ui/styles/app.css`, `src/ui/app/AppRoutes.tsx`, `src/ui/app/TreeListPage.tsx`, `src/ui/app/EditorPage.tsx`, `src/ui/app/BackupBanner.tsx`
- Modify: `src/app/main.tsx`
- Test: `tests/ui/app/TreeListPage.test.tsx`

**Interfaces:**
- Produces: routes `/app` → `TreeListPage`, `/app/t/:treeId` → `EditorPage`, `*` → "Not found" with link to `/app`. `TreeListPage` lists `TreeMeta` (name, "{n} people", relative "edited" time), actions New tree (name prompt dialog, default "My family"), Rename, Duplicate, Delete (confirm dialog), Import (file input `.json` → `importStamJson` → `saveTree` → navigate), and renders `BackupBanner` when `shouldRemindBackup`. First tree creation calls `requestPersistentStorage()`. When `storagePressure()` > 0.8 both pages show a warning banner "Storage is almost full. Download a backup." (FR-S4). `EditorPage` wires `createTabSync` and shows a non-blocking banner "This tree changed in another tab. Reload to see the latest." when another tab saves the same tree (FR-S5). `<html lang dir>` set from i18n. Tokens per Global Constraints as CSS custom properties on `:root`; Archivo via `@fontsource-variable/archivo/wdth.css`.

- [ ] **Step 1: Write the failing tests** (happy-dom + Testing Library, repo on fake-indexeddb): empty state shows "Create your first tree"; creating "Khan family" lists it with "0 people"; importing a fixture JSON adds a second tree and never changes the first; delete asks for confirmation.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `bun dev` and open `/app` manually to check the list renders with Archivo and tokens.
- [ ] **Step 5: Commit** `feat(ui): app shell, routing, i18n, tree list`.

---

### Task 16: Canvas rendering

**Files:**
- Create: `src/ui/canvas/viewport.ts`, `src/ui/canvas/usePanZoom.ts`, `src/ui/canvas/useLayoutTween.ts`, `src/ui/canvas/Canvas.tsx`, `src/ui/canvas/Edges.tsx`, `src/ui/canvas/GenerationRuler.tsx`, `src/ui/canvas/Minimap.tsx`, `src/ui/cards/PersonCard.tsx`, `src/ui/cards/describe.ts`, `src/ui/app/Toolbar.tsx`, `src/ui/app/SaveStatus.tsx`
- Test: `tests/ui/canvas/viewport.test.ts`, `tests/ui/cards/PersonCard.test.tsx`

**Interfaces:**
- Produces:
  - `type Viewport = { x: number; y: number; k: number }` (screen = world * k + (x, y))
  - `zoomAt(v, screenPoint: [number, number], factor: number): Viewport` (k clamped to 0.1–4, keeps the point fixed), `fitBounds(bounds, screen: { width: number; height: number }, padding = 48): Viewport` (k ≤ 1), `centerOn(v, worldPoint, screen): Viewport`, `visibleRect(v, screen, margin = 200): Rect`, `intersects(a: Rect, b: Rect): boolean` with `type Rect = { x: number; y: number; width: number; height: number }`, `lod(k): 'full' | 'name' | 'dot'` (`< 0.2` dot, `< 0.45` name).
  - Interaction: drag on background pans; Ctrl/Cmd + wheel and pinch zoom; plain wheel pans; toolbar buttons zoom in/out (×1.2) and Fit.
  - `useLayoutTween(layout)`: interpolates node positions from the previous layout over 450 ms with the global easing (new nodes fade in at their target); returns the current positions; no tween under reduced motion.
  - `PersonCard` (SVG `<g>`): avatar circle (photo or initials), name line, `nativeName` second line when present, `lifespanLabel`, ♂/♀ glyph 12 px muted at the inline-end top corner (`aria-hidden`), deceased background `#ECEEE9`, placeholder dashed border with muted italic "Unknown father/mother" (i18n), linked copy dashed outline with "see original" link, selected = 2 px accent outline, `+N` badge when `hiddenCount > 0`, collapse chevron when the person has children. `role="button"`, roving `tabIndex`, `aria-label` from `describePerson(doc, personId, t)` → e.g. "Ali Khan, born 1950, son of Ahmed Khan and Sara Khan".
  - `Edges`: union married = two parallel 1.5 px lines 3 px apart; partner/engaged = single solid; divorced/separated = dashed `6 4`; child line dotted `2 3` for adopted/foster/step; colour `--line`.
  - `GenerationRuler`: Roman numerals I… at each row on the inline-start margin, fixed to the screen edge, following vertical pan/zoom.
  - `Minimap` (bottom-right, 160×120): all nodes as dots, viewport rectangle; click/drag recentres.
  - `Toolbar`: tree name (inline rename), undo/redo, zoom controls, search trigger, focus toggle, "{n} not connected" badge, `SaveStatus` ("Saving…", "Saved", "Couldn't save"), and a menu item "Download backup (.json)" with an "Include photos" checkbox → `exportStamJson` → browser download named `backupFileName(doc)` → `markBackedUp` (FR-X7).
  - Culling: only nodes/edges intersecting `visibleRect` render.

- [ ] **Step 1: Write the failing tests:** `zoomAt` keeps the anchor point fixed and clamps at 0.1 and 4; `fitBounds` of a 2000×1000 box into 1000×800 gives k = 0.452 (within 0.001) and centres it; `lod(0.3) === 'name'`; `card isolates native-script name` (render a card with `nativeName: "علی خان"` and assert the text element has `unicode-bidi: isolate` / is wrapped by `<bdi>` in the HTML label); aria-label text for a fixture person; deceased card shows "†" before the death year.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual check in `bun dev` with `bigFamily(1000)` loaded through a dev-only `?demo=1000` query param that inserts a demo tree: pan/zoom stays smooth (Chrome performance panel shows no frames over 16 ms during a zoom).
- [ ] **Step 5: Commit** `feat(ui): SVG canvas, cards, connectors, ruler, minimap`.

---

### Task 17: Quick-add, inline editor, keyboard

**Files:**
- Create: `src/ui/cards/Handles.tsx`, `src/ui/cards/InlineEditor.tsx`, `src/ui/cards/nameEntry.ts`, `src/ui/keyboard/navigation.ts`, `src/ui/keyboard/useShortcuts.ts`
- Test: `tests/ui/cards/nameEntry.test.ts`, `tests/ui/keyboard/navigation.test.ts`, `tests/ui/cards/InlineEditor.test.tsx`

**Interfaces:**
- Produces:
  - `parseNameEntry(text: string, inheritLastName?: string): { firstName: string; lastName: string } | null` (null for blank) — per clarification 6.
  - `defaultGender(role, ctx): Gender | null` — per clarification 7 (null = must choose).
  - `nextFocus(layout: LayoutResult, doc: TreeDocument, nodeId: string, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): string | null` — Up = primary node of the first biological parent if visible; Down = first child node; Left/Right = nearest node in the same row by x (any kind). In RTL, Left/Right swap.
  - `Handles`: on hover/selection: top "+" (hidden when the person has 2 biological parents), bottom "+", inline-start and inline-end "+" opening a two-item chooser "Spouse" / "Sibling". Each handle dispatches the add command with an empty name (`createdIds[0]` becomes `editing.personId`) and opens `InlineEditor` positioned over the new card (HTML overlay, screen coords from viewport). Adding a child to a person with ≥ 2 unions first shows a union chooser listing partner names (FR-E4).
  - Empty tree: a single "Start with a person" card; confirming creates the first person (`addPerson`).
  - `InlineEditor`: name input (autofocus) + ♂/♀ toggle buttons (`aria-pressed`); Enter → `amendLast(updatePerson)`; Esc or blank Enter → `cancelLastAdd()`.
  - Shortcuts: Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z and Ctrl+Y redo, Ctrl/Cmd+F search, arrows via `nextFocus`, Enter opens the panel for the focused card, Delete/Backspace opens the delete dialog, Alt+←/→ reorder siblings (`reorderChild`, RTL-aware), Esc clears selection. Shortcuts are ignored while focus is in a text input.
  - Collapse chevron → `toggleCollapse`; Focus mode dims (opacity 0.25) every node that is not the selected person, an ancestor or a descendant.

- [ ] **Step 1: Write the failing tests:** `parseNameEntry("Ali Raza Khan")` → `{firstName:"Ali Raza", lastName:"Khan"}`; `parseNameEntry("Noor", "Khan")` → `{firstName:"Noor", lastName:"Khan"}`; `parseNameEntry("   ")` → null; `nextFocus` on `famSimple` (Up from a child reaches the first parent; Right from the first child reaches the second child); InlineEditor: Enter with no gender chosen for a child shows "Choose ♂ or ♀" and does not commit; Esc calls `cancelLastAdd`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ui): quick-add handles, inline editor, keyboard navigation`.

---

### Task 18: Smart drag & drop

**Files:**
- Create: `src/ui/dnd/resolveDrop.ts`, `src/ui/dnd/useDrag.ts`, `src/ui/dnd/DropMenu.tsx`
- Test: `tests/ui/dnd/resolveDrop.test.ts`, `tests/ui/dnd/DropMenu.test.tsx`

**Interfaces:**
- Consumes: `validDropActions` (Task 6), `LayoutResult`.
- Produces:
  - `type DropTarget = { kind: 'none' } | { kind: 'reorder'; unionId: string; toIndex: number; indicatorX: number; rowY: number } | { kind: 'person'; personId: string; actions: DropAction[] }`
  - `resolveDrop(layout, doc, draggedPersonId: string, pointer: [number, number] /* world */): DropTarget` — pointer inside a card that is not the dragged person (or its linked copy) → `person` (an empty `actions` list means not allowed); else pointer within the dragged person's row band (`[rowTop, rowTop + CARD_H]`) and between the first and last sibling of the dragged person's biological parent union → `reorder` with `toIndex` = number of sibling centres left of the pointer (excluding the dragged person); else `none`.
  - `useDrag`: pointer drag after 5 px; touch long-press 350 ms; ghost card follows the pointer (`opacity 0.85`), source card at `opacity 0.3`; drop targets highlighted (accent outline for allowed, muted strike for not allowed, insertion line for reorder); Esc cancels; drop on `none` animates the ghost back (250 ms) then clears. While dragging, connector lines of the dragged person are drawn with a 6 px sag (FR-D8, P2: skip if it costs more than 30 min).
  - `DropMenu`: anchored at the drop point with only the allowed actions, labelled "Make child of {name}", "Make spouse of {name}", "Make parent of {name}"; "child" on a target with ≥ 2 unions opens the union chooser; choosing dispatches `relinkAsChild` / `relinkAsSpouse` / `relinkAsParent` (one history entry); Esc closes. A "Move to…" item in the card context menu (right-click / long-press without movement / `Shift+F10`) opens `SearchBox` in picker mode then this menu — the keyboard path for FR-D7.

- [ ] **Step 1: Write the failing tests:** pointer on a grandchild while dragging the grandparent → `person` with `actions` not containing `'child'`; pointer between two siblings → `reorder` with the expected `toIndex`; pointer on empty space → `none`; `DropMenu` lists only allowed actions and dispatches `relinkAsSpouse` on click.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual check: drag reorder and relink in `bun dev`, then undo each in one step.
- [ ] **Step 5: Commit** `feat(ui): smart drag and drop`.

---

### Task 19: Person panel, search, delete, unconnected list

**Files:**
- Create: `src/ui/panels/PersonPanel.tsx`, `src/ui/panels/DateField.tsx`, `src/ui/panels/DeleteDialog.tsx`, `src/ui/panels/SearchBox.tsx`, `src/ui/photos/resizePhoto.ts`, `src/ui/app/UnconnectedList.tsx`
- Test: `tests/ui/panels/PersonPanel.test.tsx`, `tests/ui/panels/DateField.test.tsx`, `tests/ui/photos/resizePhoto.test.ts`

**Interfaces:**
- Produces:
  - `PersonPanel` (inline-end side panel, 360 px; bottom sheet under 768 px): first/last name, nickname, native name (`dir="auto"`), gender toggle, living checkbox (unchecked automatically when a death date is entered), birth/death `DateField` + place, photo (upload → `resizePhoto` → `putPhoto` → `updatePerson({photoId})`; remove), notes `<textarea>` (plain text), unions list (partner name, status select, start/end `DateField`), children list per union (child type select), buttons "Set as root" (`setRoot` + `setViewRoot(null)`), "View family" for spouses (clarification 1), "Delete…". Each field commits on blur/Enter as one `updatePerson`/`updateUnion` history entry.
  - `DateField`: text input; live preview of `formatFuzzyDate` or the error "Use a year like 1950, 1950-03-14, abt 1950 or 1948–1952" (`aria-invalid`).
  - `DeleteDialog`: "Delete {name} only" / "Delete {name} and {n} descendants" / Cancel (FR-P5); both undoable.
  - `SearchBox` (Ctrl/Cmd+F): results from `searchPeople`; Enter/click centres the canvas on the person (`centerOn`), selects them and, if they are not in the current view, sets the view root to `topmostAncestor` first. Also used in picker mode by Task 18.
  - `fitWithin(w: number, h: number, max = 512): [number, number]` and `resizePhoto(file: Blob, max = 512): Promise<Blob>` (createImageBitmap → canvas → `image/webp`, quality 0.85).
  - `UnconnectedList`: popover from the toolbar badge listing `layout.unreachable`; click sets the view root.

- [ ] **Step 1: Write the failing tests:** `fitWithin(2000, 1000)` → `[512, 256]`, `fitWithin(300, 200)` → `[300, 200]`; DateField shows "Mar 1950" for "1950-03" and the error text for "1950-13"; editing first name then blurring dispatches exactly one `updatePerson`; entering a death year unchecks "Living"; delete dialog shows the descendant count from `descendantsOf`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ui): person panel, search, delete dialog, unconnected list`.

---

### Task 20: Production build, hosting config, E2E and accessibility

**Files:**
- Create: `scripts/build.ts`, `scripts/serve-dist.ts`, `public/_redirects`, `public/_headers`, `e2e/playwright.config.ts`, `e2e/editor.spec.ts`, `e2e/a11y.spec.ts`
- Modify: `package.json` (`build` script), `README.md`

**Interfaces:**
- Produces:
  - `scripts/build.ts`: `Bun.build({ entrypoints: ['src/index.html', 'src/app.html'], outdir: 'dist', minify: true, splitting: true, sourcemap: 'linked', publicPath: '/', define: { 'process.env.NODE_ENV': '"production"' } })`, then copies `public/*` into `dist/`. Fails the process on any build log of level error.
  - `public/_redirects`: `/app /app.html 200` and `/app/* /app.html 200`.
  - `public/_headers` for `/*`: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  - `scripts/serve-dist.ts`: `Bun.serve` on port 4400 serving `dist/`, emulating the two `_redirects` rules and the `_headers` CSP (used by Playwright `webServer`).
  - Playwright config: Chromium + WebKit + a 390×844 mobile project; `webServer: { command: 'bun run build && bun run scripts/serve-dist.ts', port: 4400 }`.

- [ ] **Step 1: Write the E2E specs** (`e2e/editor.spec.ts`), each a separate test:
  1. Create tree "E2E family" → "Start with a person" → type "Ahmed Khan", choose ♂, Enter → card visible.
  2. Bottom handle → "Ali", ♂ → card shows "Ali Khan" (inherited last name); inline-end handle → Spouse → "Sara Malik" (♀ preselected).
  3. Add two more children, drag the last child before the first → order changes; Ctrl+Z restores the order in one step.
  4. Drag a child onto its grandparent → menu shows only allowed actions; choose "Make spouse of" is absent for an ancestor.
  5. Reload the page → the tree is unchanged (autosave + IndexedDB) and "Saved" is shown.
  6. Export JSON from the toolbar menu → import the downloaded file from the tree list → a second tree with the same people count appears.
  7. Keyboard only: Tab to the canvas, arrows move focus between relatives, Enter opens the panel.
  8. Esc during inline add removes the new card and Ctrl+Shift+Z does nothing.
- [ ] **Step 2: Write** `e2e/a11y.spec.ts`: axe (`@axe-core/playwright`) on `/app` and on an editor with `famSimple` imported reports zero `serious`/`critical` violations; every focused element has a visible outline (computed `outline-style` ≠ `none`).
- [ ] **Step 3: Run** `bunx playwright install chromium webkit` once, then `bun run e2e` → FAIL until the build script exists.
- [ ] **Step 4: Implement** the build, serve and hosting files; fix any failures the specs reveal in the owning component.
- [ ] **Step 5: Verify** `bun run verify` → exit 0 and `bun run e2e` → all pass on all three projects. `bun run build && ls dist` shows `index.html`, `app.html`, `_redirects`, `_headers`, hashed JS/CSS and font files.
- [ ] **Step 6: Document** in `README.md`: requirements (Bun ≥ 1.4.4), every script, and the Cloudflare Pages settings (build command `bun run build`, output `dist`, custom domain `stam.mirzalabs.in`). Do not deploy; deployment waits for the owner's go-ahead.
- [ ] **Step 7: Commit** `build: production build, hosting headers, E2E and a11y tests`.
