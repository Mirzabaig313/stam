# Deploying Stam with its backend

Stam runs on two Cloudflare accounts:

| Part | Where | Address |
|---|---|---|
| The app (site and `/app`) | Cloudflare **Pages**, the account that has `mirzalabs.in` | `https://stam.mirzalabs.in` |
| The API (`server/stam-worker`, Rust compiled to WASM) | A **Worker** on the second account | `https://stam.stammirzalabs.workers.dev` |

The app calls the API cross-site. So sign-in does not use cookies (Safari blocks them across
sites): Google returns to the Worker, which sends the browser back to the app with a one-time code
the app trades for a session token; the app keeps the token and sends it as
`Authorization: Bearer`, and on WebSockets as a subprotocol. The Worker answers CORS only for
`SITE_ORIGIN`. Shared trees live in `TreeRoom` Durable Objects, accounts and links in D1, photos in
R2, all on the Worker's account. Everything fits the free plans (numbers below), and the Pages
account's Worker quota is not used at all.

The two addresses are written in three places; change all of them together:

- `wrangler.jsonc`: `SITE_ORIGIN` (the app) and `API_ORIGIN` (the Worker).
- `src/config.ts`: `PRODUCTION_API_ORIGIN` (the app calls it; the Pages CSP is built from it).
- Google Cloud: the OAuth client's redirect URI (below).

The Worker's address is `https://<worker name>.<account subdomain>.workers.dev`. The worker is
named `stam`; the account subdomain is set under **Workers & Pages → Account details →
Subdomain** (`stammirzalabs`).

## One-time setup: the Worker (second account)

Tools: Bun, Rust (with the `wasm32-unknown-unknown` target), `cargo install wasm-pack worker-build`,
and Wrangler (a dev dependency: `bunx wrangler`).

1. **Sign in to the Worker's account:** `bunx wrangler login`, then `bunx wrangler whoami`.
2. **Create the database:** `bunx wrangler d1 create stam`. Copy the `database_id` it prints into
   `wrangler.jsonc` (`d1_databases[0].database_id`).
3. **Create the photo bucket:** `bunx wrangler r2 bucket create stam-photos` (enable R2 in the
   dashboard first if asked).
4. **Google sign-in:** in Google Cloud Console, create an OAuth client ("Web application") with
   - authorised redirect URI `https://stam.stammirzalabs.workers.dev/api/auth/google/callback`
   - (for local development also `http://localhost:3000/api/auth/google/callback`)
   - scopes `openid`, `email`, `profile`; on the consent screen, the app's home page and privacy
     policy are `https://stam.mirzalabs.in` and `https://stam.mirzalabs.in/privacy`.
5. **Deploy once** (`bun run deploy:backend`, see "Every deploy" below), so the Worker exists.
6. **Secrets** (each asks for the value):
   - `bunx wrangler secret put GOOGLE_CLIENT_ID`
   - `bunx wrangler secret put GOOGLE_CLIENT_SECRET`
   - `openssl rand -base64 48 | bunx wrangler secret put SESSION_SECRET`
   - `openssl rand -base64 32 | bunx wrangler secret put LINK_KEY`. Changing it later makes
     existing links impossible to copy again (they still open; reset them to show a new one).

## One-time setup: the app (Pages account)

Nothing changes on Pages except what the build produces: `public/_headers` gets the API's address
in its CSP (`connect-src`, `img-src`), and `public/_redirects` sends `/s/*` (share links) to the
app. Keep the custom domain `stam.mirzalabs.in` on the Pages project.

## Every deploy

| Script | What it does | Signed in to |
|---|---|---|
| `bun run test:frontend` | the app: types, format, lint, every TypeScript test (`verify`) | nothing |
| `bun run test:backend` | the API: cargo fmt, clippy, Rust tests, the local Worker suite (`verify:server`) | nothing |
| `bun run deploy:backend` | D1 migrations, then `wrangler deploy` (the Worker) | the Worker's account |
| `bun run deploy:frontend` | `bun run build`, then `wrangler pages deploy dist` (project `stam`) | the Pages account |

The two deploys need different Cloudflare accounts. Either sign in to each in turn
(`bunx wrangler logout && bunx wrangler login`), or give each its own API token:
`CLOUDFLARE_API_TOKEN=<token> bun run deploy:backend`. Pages can also keep deploying from its Git
integration (build command `bun run build`, output `dist`) instead of `deploy:frontend`.

Deploy the backend first when both change: the app's new code expects the new API.

After the first deploy: `https://stam.stammirzalabs.workers.dev/api/health` answers `{"ok":true}`;
sign in on `https://stam.mirzalabs.in/app`, share a tree, open the view link in a private window.

## Local development

- `cp .dev.vars.example .dev.vars` and fill it in (Google values only matter for real sign-in).
- `bun run dev:worker`: the API on `http://localhost:8787`.
- `bun dev`: the app on `http://localhost:3000`; its `/api/*` requests go to the local Worker
  (same origin, so `SITE_ORIGIN` and `API_ORIGIN` are both `http://localhost:3000`), and its
  WebSockets connect to the Worker directly.
- `bun run test:worker`: a fresh local Worker on port 8788 with a stand-in for Google and the app
  on another origin (`http://app.test`), then `tests/worker`.

## Measured against the free plan (2026-10-24)

| Check | Result | Free plan |
|---|---|---|
| Worker size (`bun run scripts/wasm-size.ts`) | 362 KB gzip (1.1 MB raw) | 3 MB gzip |
| Room CPU, 5,000-person tree (`bun run scripts/bench-room.ts`, WASM in Bun as a proxy) | cold open 4.9 ms; one edit 4.7 ms; a hide-living viewer joining 2.6 ms | 10 ms per request |
| Same, 1,000 people | about 1.2 ms each | |

Everything is under half the CPU limit. After the first deploy, check **Workers & Pages → stam →
Metrics → CPU time** in the dashboard: if the median for the Durable Object nears 10 ms on the
biggest trees, move to the Workers Paid plan ($5/month); no code changes.

Cross-site calls add CORS preflights (one per kind of request, cached by the browser for up to a
day; Chrome keeps them 2 hours). They count as requests.

## What to know in production

- **Session tokens** live in the browser's localStorage (`stam.session`). The app's strict CSP
  (`script-src 'self'`) is what keeps other scripts from reading them; never loosen it.
- **Tokens in URLs.** Share links carry their token in the path (`/s/<token>`) and in the
  WebSocket and photo URLs (`?t=`). Owner tokens never appear in URLs. The Worker logs nothing,
  but if you turn on Workers observability or Logpush, request URLs (and so link tokens) are
  recorded there. Keep such logs private, or leave them off.
- **Hosts.** The Worker answers only `/api/*` on `workers.dev`; `preview_urls` are off. It sends
  CORS headers only to `SITE_ORIGIN`.
- **The OAuth cookie** (`__Host-stam_oauth`) lives only on the Worker's address, for the 10
  minutes of a sign-in.
- **Deleting a shared tree** ends access at once (D1); the room, its storage and photos are then
  cleared. If that clean-up fails, sharing the same tree again clears what is left.
- **Daily free-plan limits** reset at 00:00 UTC. When one runs out, rooms answer `busy` and
  browsers keep the edits queued until it resets.
- **Rate limits.** Each IP gets, per minute and per Cloudflare location: 120 API requests, 600
  photo downloads or uploads, 30 share-link opens (link users' sockets count here too) and 20
  sign-in steps (`ratelimits` in `wrangler.jsonc`). Over a limit, the Worker answers 429
  `RATE_LIMITED`; the app waits and retries, and keeps queued edits. The health check is never
  limited. If a deploy refuses the `ratelimits` bindings on your plan, remove them: the Worker then
  runs without limits.
- **Not in P1:** nightly backups (P4).
