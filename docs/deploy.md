# Deploying Stam with its backend

Stam is one Cloudflare Worker (`server/stam-worker`, Rust compiled to WASM): it serves the built
site from `dist/` and the API on the same domain. Shared trees live in `TreeRoom` Durable
Objects, accounts and links in D1, photos in R2. Everything fits the Workers **free plan** (see
the numbers below).

This replaces the Cloudflare Pages setup: once the Worker serves `stam.mirzalabs.in`, the Pages
project can be removed.

## One-time setup

Tools: Bun, Rust (with the `wasm32-unknown-unknown` target), `cargo install wasm-pack worker-build`,
and Wrangler (a dev dependency: `bunx wrangler`).

1. **Sign in to Cloudflare:** `bunx wrangler login`.
2. **Create the database:** `bunx wrangler d1 create stam`. Copy the `database_id` it prints into
   `wrangler.jsonc` (`d1_databases[0].database_id`).
3. **Create the photo bucket:** `bunx wrangler r2 bucket create stam-photos`.
4. **Google sign-in:** in Google Cloud Console, create an OAuth client ("Web application") with
   - authorised JavaScript origin `https://stam.mirzalabs.in`
   - authorised redirect URI `https://stam.mirzalabs.in/api/auth/google/callback`
   - scopes `openid`, `email`, `profile` (the consent screen only needs these).
5. **Secrets** (each asks for the value):
   - `bunx wrangler secret put GOOGLE_CLIENT_ID`
   - `bunx wrangler secret put GOOGLE_CLIENT_SECRET`
   - `bunx wrangler secret put SESSION_SECRET`: at least 32 random characters
     (`openssl rand -base64 48`).
   - `bunx wrangler secret put LINK_KEY`: exactly 32 random bytes, base64
     (`openssl rand -base64 32`). Changing it later makes existing links impossible to copy
     again (they still open; reset them to show a new one).
6. **Domain:** the `routes` entry in `wrangler.jsonc` claims `stam.mirzalabs.in` as a custom
   domain on the first deploy. Remove the domain from the old Pages project first.

## Every deploy

```sh
bun run verify && bun run verify:server   # all tests, parity and the local Worker suite
bun run deploy                            # build, apply D1 migrations, wrangler deploy
```

`bun run deploy` runs `bun run build`, `wrangler d1 migrations apply stam --remote`, then
`wrangler deploy` (which builds the Rust Worker with `worker-build --release`).

## Local development

- `cp .dev.vars.example .dev.vars` and fill it in (Google values only matter for real sign-in).
- `bun run dev:worker`: the Worker on `http://localhost:8787` (site from `dist/`, API, rooms).
- `bun dev`: the app with hot reload; its `/api/*` requests go to the local Worker, and its
  WebSockets connect to it directly.
- `bun run test:worker`: a fresh local Worker on port 8788 with a stand-in for Google, then
  `tests/worker`.

## Measured against the free plan (2026-10-24)

| Check | Result | Free plan |
|---|---|---|
| Worker size (`bun run scripts/wasm-size.ts`) | 362 KB gzip (1.1 MB raw) | 3 MB gzip |
| Room CPU, 5,000-person tree (`bun run scripts/bench-room.ts`, WASM in Bun as a proxy) | cold open 4.9 ms; one edit 4.7 ms; a hide-living viewer joining 2.6 ms | 10 ms per request |
| Same, 1,000 people | about 1.2 ms each | |

Everything is under half the CPU limit. After the first deploy, check **Workers & Pages → stam →
Metrics → CPU time** in the dashboard: if the median for the Durable Object nears 10 ms on the
biggest trees, move to the Workers Paid plan ($5/month); no code changes.

## What to know in production

- **Tokens in URLs.** Share links carry their token in the path (`/s/<token>`) and in the
  WebSocket and photo URLs (`?t=`). The Worker logs nothing, but if you turn on Workers
  observability or Logpush, request URLs (and so tokens) are recorded there. Keep such logs
  private, or leave them off.
- **Hosts.** `workers_dev` and `preview_urls` are off: the app runs only on the custom domain.
- **Cookies.** In production they are `__Host-stam_session` and `__Host-stam_oauth`
  (Secure, HttpOnly, SameSite=Lax, Path=/).
- **Deleting a shared tree** ends access at once (D1); the room, its storage and photos are then
  cleared. If that clean-up fails, sharing the same tree again clears what is left.
- **Daily free-plan limits** reset at 00:00 UTC. When one runs out, rooms answer `busy` and
  browsers keep the edits queued until it resets.
- **Not in P1:** nightly backups (P4), per-IP rate limits on link opening and uploads (P3).
