# Stam

A browser-based family tree builder. Everything stays on your device.

## Requirements

Bun 1.4.4 or newer.

## Commands

| Command                     | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `bun install`               | Install dependencies                                               |
| `bun dev`                   | Start the dev server on http://localhost:3000                      |
| `bun run build`             | Production build into `dist/`, then prerender `/`, `/privacy`, 404 |
| `bun check`                 | Type check                                                         |
| `bun fmt`                   | Format (`bun fmt --check` to verify)                               |
| `bun run lint`              | Lint with oxlint                                                   |
| `bun test`                  | Run unit and property tests                                        |
| `bun scripts/serve-dist.ts` | Serve `dist/` on http://localhost:4400 with production routing     |
| `bun run bench`             | Run layout benchmarks                                              |
| `bun run verify`            | Type check, format check, lint and tests (10000 property runs)     |

## Public pages

The landing page (`/`), `/privacy` and the 404 live in `src/site/` (copy in `src/site/content.ts`,
design system in `DESIGN.md`). `scripts/prerender.ts` renders them to static HTML after the bundle
is built; the client bundle hydrates them and adds motion (GSAP and Lenis, landing only). The dev
server renders them on the client.

## Hosting (Cloudflare Pages)

| Setting                | Value               |
| ---------------------- | ------------------- |
| Build command          | `bun run build`     |
| Build output directory | `dist`              |
| Custom domain          | `stam.mirzalabs.in` |

The build copies `public/_redirects` (the `/app` and `/app/*` rewrites to `app.html`) and `public/_headers`
(CSP, referrer, nosniff and permissions policies) into `dist/`. Nothing is deployed until the owner says so.

Deploy to the `stam` Pages project (https://stam-3ov.pages.dev) with:

```sh
bun run build && wrangler pages deploy dist --project-name stam --branch main
```
