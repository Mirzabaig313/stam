# Stam

A browser-based family tree builder. Everything stays on your device.

## Requirements

Bun 1.4.4 or newer.

## Commands

| Command          | What it does                                                       |
| ---------------- | ------------------------------------------------------------------ |
| `bun install`    | Install dependencies                                               |
| `bun dev`        | Start the dev server on http://localhost:3000                      |
| `bun run build`  | Production build into `dist/`, then prerender `/`, `/privacy`, 404 |
| `bun check`      | Type check                                                         |
| `bun fmt`        | Format (`bun fmt --check` to verify)                               |
| `bun run lint`   | Lint with oxlint                                                   |
| `bun test`       | Run unit and property tests                                        |
| `bun run e2e`    | Build, serve `dist/` and run Playwright (5 projects)               |
| `bun run bench`  | Run layout benchmarks                                              |
| `bun run verify` | Type check, format check, lint and tests (10000 property runs)     |

## Public pages

The landing page (`/`), `/privacy` and the 404 live in `src/site/` (copy in `src/site/content.ts`,
design system in `DESIGN.md`). `scripts/prerender.ts` renders them to static HTML after the bundle
is built; the client bundle hydrates them and adds motion (GSAP and Lenis, landing only). The dev
server renders them on the client.

## End-to-end tests

Install the browsers once with `bunx playwright install chromium webkit`. `bun run e2e` builds the app,
serves `dist/` with `scripts/serve-dist.ts` (which emulates `_redirects` and `_headers`) and runs the
specs in `e2e/` on Chromium, WebKit and a 390x844 mobile viewport. `bun test` only runs `tests/`.

Two language projects run their own spec only: `rtl` drives the real Arabic interface
(`rtl.spec.ts`) and `urdu` the real Urdu one (`urdu.spec.ts`, Nastaliq and offline). Selectors read
the app's own locale files through `e2e/strings.ts`, so they use the real Urdu and Arabic words.

Firefox is opt-in: `E2E_FIREFOX=1 bun run e2e` adds a `firefox` project (install it with
`bunx playwright install firefox`). It is off by default because Playwright's Firefox does not start
on every machine (on macOS 27 it exits with "Could not find profile folder"), and it has not been
run against this suite yet.

The server listens on port 4400 by default. Set `E2E_PORT` to use another one, for example
`E2E_PORT=4471 bun run e2e`. The run never reuses a server that is already listening (it could be
serving a different build), so it fails fast if the port is taken: pick a free one.

The specs: `editor.spec.ts` (the editor flows: create, quick add, drag and undo, reload, JSON
export and import, keyboard, Esc), `a11y.spec.ts` (axe on the list and the editor, focus
outlines), `polish.spec.ts` (selection outline, handle placement, dateless cards) and
`smoke.spec.ts` (routing and headers).

## Hosting (Cloudflare Pages)

| Setting                | Value               |
| ---------------------- | ------------------- |
| Build command          | `bun run build`     |
| Build output directory | `dist`              |
| Custom domain          | `stam.mirzalabs.in` |

The build copies `public/_redirects` (the `/app` and `/app/*` rewrites to `app.html`) and `public/_headers`
(CSP, referrer, nosniff and permissions policies) into `dist/`. Nothing is deployed until the owner says so.
