# Stam M2: Exports Implementation Plan

> **For agentic workers:** five lanes run in parallel git worktrees, all branched from `feat/m2-exports`. Each lane builds against the **shared contract** below, never against another lane's internals. One review per lane group, then integration and a final review.

**Goal:** export the family tree as SVG, PNG, JPEG, PDF (poster and tiled) and a self-contained interactive HTML file, with a choice of scope, options and privacy mode. Every format is drawn from the same SVG as the editor canvas.

**Architecture:** `src/export/render` turns a layout into **one standalone SVG string**, using the canvas's own card, connector and ruler components through `react-dom/server`. Every format consumes that string: raster converts SVG → canvas → blob, PDF uses jsPDF + svg2pdf, and HTML is the SVG plus an inline viewer. The export dialog in `src/ui/export` collects the options and lazy-loads each exporter.

**Spec:** `docs/superpowers/specs/2026-10-22-stam-prd.md`: §7.8 (FR-X1 to X11), §8 (performance, privacy, security), §12.2 (tokens).

## Global constraints

- These carry over from M1 unchanged: Bun only, latest dependency versions, nothing in `src/core` touching DOM or React, all strings through `t()` (new group `"export"`), logical CSS, `<bdi>` and `unicode-bidi: isolate` around names, no network calls, and no `dangerouslySetInnerHTML` for user text.
- jsPDF 4.2 and svg2pdf.js 2.8 (and any other heavy library) are **lazy-loaded** with `import()`. The first load of `/app` must stay ≤ 250 KB gzip.
- **Exports match the screen.** They reuse `PersonCard`, `Edges` and the ruler's row logic; no second card design.
- **Privacy mode** (FR-X10) is on by default for HTML and image exports, and off by default for SVG and PDF. With it on, living people show their name only: no dates, places, photo or notes.
- **Escaping.** All user text in exported SVG and HTML is escaped. In the HTML viewer, data is embedded as JSON inside `<script type="application/json">` with `<` escaped as `<`, and the viewer renders it with `textContent` only.
- **Size limits.** A raster image is at most 16,384 px per side. Its area is capped at 268,435,456 px, or 16,777,216 px on iOS Safari (detected by user agent with a feature fallback). The scale is reduced automatically and a warning returned.
- **Port 3333** is the owner's live preview. Never touch it and never `pkill`.

## Shared contract: `src/export/types.ts` (lane R creates it first; the other lanes copy it verbatim)

```ts
import type { TreeDocument } from "@/core/model/types";
import type { LayoutResult } from "@/core/layout/types";

export type ExportScope = "whole" | "view" | "branch" | "visible";
export type ExportTheme = "light" | "print";
export type ExportOptions = {
  scope: ExportScope;
  theme: ExportTheme;
  title?: string;
  subtitle?: string;
  includeDates: boolean;
  includePhotos: boolean;
  showRuler: boolean;
  privacy: boolean;
  background: "transparent" | "solid";
};
export type ExportInput = {
  doc: TreeDocument;
  layout: LayoutResult;              // current family-view layout
  viewRootId: string | null;
  selectedId: string | null;         // "branch" = the selected person and their descendants
  visibleRect?: { x: number; y: number; width: number; height: number }; // world coordinates, for "visible"
  photos: Record<string, string>;    // photoId -> data URL (only when includePhotos)
};
export type RenderedSvg = { svg: string; width: number; height: number }; // CSS px
export type ExportPerson = { id: string; name: string; nativeName?: string; lifespan: string; details: { label: string; value: string }[] };
```

## Lanes

### Lane R: render core (`src/export/render/*`, `src/export/types.ts`)

- `applyPrivacy(doc): TreeDocument` removes every field except names from living people.
- `selectScope(input, opts): LayoutResult`:
  - `whole`: re-layout from `doc.rootPersonId`, with nothing collapsed.
  - `view`: the input layout as it is.
  - `branch`: re-layout rooted at `selectedId` (falls back to `view` when there's no selection).
  - `visible`: the input layout cropped to `visibleRect`, keeping nodes and edges that intersect it.
- `renderTreeSvg(input, opts, t): RenderedSvg`:
  - Uses `renderToStaticMarkup` over a static `<svg>` built from `PersonCard` (no handles or interaction), `Edges` and the ruler rows when `showRuler`. Add a `static` prop if needed, without changing the editor's behaviour.
  - Optional title and subtitle block at the top, set in Archivo.
  - 48 px padding, a `viewBox`, `width`/`height` in px, and `xmlns` / `xmlns:xlink`.
  - A theme `<style>` with resolved token colours (no CSS variables). `print` uses white ground, black ink and no fills.
  - Fonts embedded as `@font-face` with base64 `woff2`: Archivo variable, latin plus latin-ext. Read the files from `@fontsource-variable/archivo/files`. Add Noto Naskh Arabic and Noto Nastaliq Urdu only when the doc contains Arabic-script names, through a pluggable `fontsFor(doc)` (M4 adds those font files; for now it returns Archivo only).
  - Photos embedded as `<image href="data:…">` when `includePhotos`.
- Tests:
  - the SVG parses in happy-dom (DOMParser);
  - privacy drops dates for a living person but keeps them for a deceased one;
  - each scope gives the expected person set;
  - a name containing `<script>` comes out escaped;
  - snapshot of `famSimple`;
  - no `var(` in the output.

### Lane X: raster (`src/export/raster/*`)

- `maxScale(width, height, requested, env = detectEnv()): { scale: number; warning?: "SIDE_LIMIT" | "AREA_LIMIT" }`
- `rasterize(r: RenderedSvg, o: { format: "png" | "jpeg"; scale: 1 | 2 | 3 | 4; quality?: number; background: "transparent" | "solid"; ground: string }): Promise<{ blob: Blob; scale: number; warning?: string }>`
  - SVG → `Blob` URL → `Image` → `OffscreenCanvas` (or `<canvas>` as a fallback) → `convertToBlob` / `toBlob`.
  - JPEG always fills the ground colour. Default quality is 0.92.
- Unit tests cover `maxScale`. A Playwright test exports a fixture SVG to PNG and JPEG, then checks the file signature bytes and the dimensions.

### Lane P: PDF (`src/export/pdf/*`)

- `PAGE_SIZES_MM` covers A4, A3, A2, A1, A0, Letter and Tabloid.
- `toPosterPdf(r, { page: keyof PAGE_SIZES_MM | { w: number; h: number }; orientation: "auto" | "portrait" | "landscape"; marginMm: number }): Promise<Blob>`
  - One page, vector, scaled to fit.
  - `auto` picks the orientation that gives the larger scale.
- `toTiledPdf(r, { page: "A4" | "Letter"; scale: number; overlapMm: 10 }): Promise<Blob>` (FR-X5)
  - Tiles carry crop and alignment marks and a row/column label in the corner.
  - Page 1 is an assembly guide: a thumbnail with a grid and the instruction "Trim at the marks, align by the labels".
- Lazy-load `jspdf` and `svg2pdf.js` (`bun add` them in this lane).
- Spike: Arabic-script text in svg2pdf. If shaping breaks, convert those `<text>` elements to paths, or note it for M4.
- Tests: the page count for tiling is computed; Playwright generates a poster PDF and a tiled PDF, checks for `%PDF` and checks the page count (with `pdf-lib`, as a dev dependency only, or by counting `/Type /Page`).

### Lane H: interactive HTML (`src/export/html/*`)

- `toHtml(r: RenderedSvg, people: ExportPerson[], meta: { title: string; generatedAt: string; lang: string; dir: "ltr" | "rtl" }): string`
  - One self-contained file: inline CSS, inline viewer JS, and the SVG.
  - The viewer handles wheel and pinch zoom, drag pan, a fit button, search by name (matching highlights and centres), and clicking a card (`data-person-id` on each card group) to open a details panel.
  - It's keyboard accessible, follows reduced motion, and needs no network.
- Author the viewer as a small TypeScript module, `src/export/html/viewer.ts`. Turn it into a string with `Bun.build` at build time, or keep it as a hand-written ES5 string in `viewerScript.ts` with a unit test that `eval`s it in happy-dom.
- Tests:
  - output contains no external URLs (`http`, except inside `xmlns`);
  - people JSON is escaped;
  - search finds a person;
  - clicking a card shows that person's details;
  - Playwright opens the file via `file://` and checks zoom works with no console errors.

### Lane U: export UI (`src/ui/export/*`)

- `ExportDialog`:
  - format radio: SVG, PNG, JPEG, PDF poster, PDF tiled, HTML, JSON (moves the existing backup option here; keep the menu item too);
  - scope;
  - options (title, subtitle, dates, photos, ruler, theme, privacy with format-specific defaults, background);
  - format-specific controls (PNG/JPEG scale, JPEG quality, PDF page, orientation and margin, tiled page and scale);
  - an estimated output size in px or page count;
  - an Export button with a busy state, and the error and warning text (e.g. "Scale reduced to 2× to fit the browser limit").
- Toolbar menu entry "Export…" and the shortcut Ctrl/Cmd+E.
- `downloadBlob(blob, filename)`; file names follow `{slug}-{yyyy-mm-dd}.{ext}`.
- Gathers `ExportInput` from the store and `CanvasHandle`: the visible rect comes from viewport and screen size, and photos via `repo.getPhoto` → data URL.
- Calls the exporters through `src/ui/export/exporters.ts`, which lazy-`import()`s lanes R, X, P and H. In tests, mock the exporters at that boundary.
- FR-X11 (P2): a print stylesheet so browser Print gives a one-page fit of the canvas.

## Integration and review

After all five lanes are done:
1. Merge them into `feat/m2-exports` in this order: R, X, P, H, U.
2. Integration agent: end-to-end export of every format from the real editor, a Playwright spec per format, a bundle-size check, and a CSP check (exports run in the app under the existing CSP; blob URLs and data URLs are already allowed in `img-src`).
3. One review per merged group (R+X+P+H as one, U as one), then the final review.
