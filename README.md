# Stam

A browser-based family tree builder. Local by default: nothing leaves your device unless you share
a tree.

## Requirements

Bun 1.4.4 or newer. For the backend: Rust (stable, with the `wasm32-unknown-unknown` target) and
`cargo install wasm-pack worker-build`.

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
| `bun run verify`            | WASM build, type check, format check, lint, tests (10000 runs)     |
| `bun run wasm`              | Build the Rust core and room to WASM for the parity suites         |
| `bun run test:parity`       | TS and Rust rules agree (10000 runs)                               |
| `bun run verify:server`     | cargo fmt, clippy, cargo test, then `bun run test:worker`          |
| `bun run test:worker`       | Start a local Worker (port 8788) and run `tests/worker` against it |
| `bun run dev:worker`        | The Worker on http://localhost:8787 (`bun dev` proxies `/api`)     |
| `bun run test:frontend`     | The app's checks and tests (`verify`)                              |
| `bun run test:backend`      | The API's checks and tests (`verify:server`)                       |
| `bun run deploy:backend`    | Apply D1 migrations, deploy the Worker (its Cloudflare account)    |
| `bun run deploy:frontend`   | Build, deploy `dist/` to Pages (the Pages account)                 |

## Public pages

The landing page (`/`), `/privacy` and the 404 live in `src/site/` (copy in `src/site/content.ts`,
design system in `DESIGN.md`). `scripts/prerender.ts` renders them to static HTML after the bundle
is built; the client bundle hydrates them and adds motion (GSAP and Lenis, landing only). The dev
server renders them on the client.

## Backend

Sharing, accounts and live editing run on a Cloudflare Worker written in Rust (`server/`), on
`workers.dev` and another Cloudflare account than the app, which calls it cross-site: the
tree rules (`server/stam-core`, a port of `src/core` held to it by `tests/parity`), the room that
referees a shared tree (`server/stam-room`) and the Worker itself (`server/stam-worker`). The
design is in `docs/superpowers/specs/2026-10-24-stam-backend-design.md`; setup and deploy steps in
`docs/deploy.md`.

### Running the backend locally

1. Once: `cp .dev.vars.example .dev.vars` and fill it in (`.dev.vars` is never committed):
   - `LINK_KEY`: `openssl rand -base64 32`
   - `SESSION_SECRET`: any long random string (`openssl rand -base64 48`)
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: only for real Google sign-in. Add
     `http://localhost:3000/api/auth/google/callback` as a redirect URI on the OAuth client.
2. Terminal 1: `bun run dev:worker`. It sets up the local D1 database and runs the Worker on
   http://localhost:8787 (the first run compiles the Rust code: a few minutes).
3. Terminal 2: `bun dev`, then open http://localhost:3000/app. Its `/api` requests go to the
   Worker.

If the app runs on another port, set `SITE_ORIGIN` and `API_ORIGIN` in `.dev.vars` to match (and
use that port in the Google redirect URI). `bun run test:worker` needs none of this: it starts its own Worker on
port 8788 with a stand-in for Google.

## Hosting (Cloudflare Pages)

The app stays on Pages; the API is the Worker (see `docs/deploy.md`).

| Setting                | Value               |
| ---------------------- | ------------------- |
| Build command          | `bun run build`     |
| Build output directory | `dist`              |
| Custom domain          | `stam.mirzalabs.in` |

The build copies `public/_redirects` (`/app/*` and share links `/s/*` rewrite to `app.html`) and
`public/_headers` (CSP with the API's address from `src/config.ts`, referrer, nosniff and
permissions policies) into `dist/`. Nothing is deployed until the owner says so.

Deploy to the `stam` Pages project (https://stam-3ov.pages.dev) with:

```sh
bun run deploy:frontend
```
