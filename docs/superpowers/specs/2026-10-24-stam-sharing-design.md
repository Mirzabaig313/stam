# Stam Sharing: Share Links, Live Co-editing, Comments and History

| | |
|---|---|
| **Status** | Approved design, spec for review |
| **Date** | 2026-10-24 |
| **Owner** | Mirza |
| **Builds on** | `stam-prd.md` (v1). This spec moves "accounts, cloud sync, share links, real-time collaboration" out of PRD §16 (Later) and changes the PRD's "no backend" assumption (§18) |

---

## 1. Summary

An owner signs in with Google, uploads a tree and creates share links. Each link has one role:
**view**, **comment** or **edit**. People who open a link do not sign in; they type a name the
first time they comment or edit. Everyone with the tree open sees changes live, like Google Docs.
Editors keep working offline and their edits sync when they reconnect. Comments are threads on a
person. Editors and the owner can browse the tree's version history and restore an old version.

The backend is written in **Rust** and runs on Cloudflare's free plan.

Trees that are never shared stay local-only, exactly as in v1. The privacy promise becomes
"local by default; nothing leaves your device unless you share a tree".

## 2. Decisions

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| D1 | How people get in | Share links with a role | Email invites per person |
| D2 | Link users' identity | Type a name, kept in the browser; not verified | Sign-in for every member; fully anonymous |
| D3 | Owner identity | Signs in. Google now; email magic link later | Owner key without an account |
| D4 | Concurrent editing | Live, under a second | Sync on save or refresh |
| D5 | Comments | One thread per person | Tree-wide thread; canvas pins |
| D6 | Platform | Cloudflare: Workers, Durable Objects, D1, R2, free plan | Supabase (pauses after 1 week idle, 1 GB photos); a self-run VPS |
| D7 | Privacy on links | View links may hide living people's details | Not offered |
| D8 | Offline editors | Keep editing; queued edits sync on reconnect | Read-only when offline |
| D9 | Merge model | Server-authoritative commands with client rebase (Figma, Linear, tldraw, Replicache) | Yjs CRDT (merges can break tree invariants); one editor at a time |
| D10 | Version history | In the first release | Later |
| D11 | Backend language | **Rust**, `workers-rs` (`worker` crate) compiled to WASM, `axum` for routing | TypeScript + Hono (first draft); a Rust core shared with the browser as WASM (would replace the tested TS core and add 200–400 KB to the app) |
| D13 | Account sync | Any tree can be saved to the owner's account without links (a cloud tree with no links); it syncs live across the owner's devices. Encrypted in transit (TLS) and at rest (Cloudflare storage), but readable by the server, which must run the rules | End-to-end encryption now (see §12 Later: Private vault) |
| D12 | Two implementations of the edit rules | The browser keeps the TypeScript core. The server gets a Rust port. A **parity property suite** runs both on the same random edits and requires identical results | One shared implementation |

Why D9: Google Docs uses Operational Transformation because text edits are positional. Stam's
commands refer to people and unions by id, so a command can simply be re-run on the newer tree,
and `validate` keeps refusing any result that would break the tree.

Why D12 matters: the server re-runs every edit to stay the referee, so the Rust port must behave
exactly like the TypeScript core. The parity suite (§11) is a merge gate, not an optional test.

## 3. Architecture

```
Browser (existing TS app)                  Cloudflare (Rust → WASM)
┌───────────────────────────┐    HTTPS   ┌─────────────────────────────────────┐
│ editor UI (React/Zustand) │──/api/*──▶│ Worker "stam" (workers-rs + axum)   │
│ src/core   (TS rules)     │            │  ├ serves dist/ (static assets)     │
│ src/cloud/ API, auth      │            │  ├ /api/auth/*  Google OAuth        │
│ src/sync/  SyncClient     │◀──WS────▶│  ├ /api/trees, /links, /s/:token    │
│  pending queue (IndexedDB)│            │  └ /api/trees/:id/ws ─┐             │
└───────────────────────────┘            │ Durable Object TreeRoom (1 per tree)│
                                         │  SQLite: doc, ops, checkpoints,     │
                                         │          comments                   │
                                         │  runs stam-core (Rust rules)        │
                                         │ D1: users, sessions, trees, links   │
                                         │ R2: photos, nightly backups         │
                                         └─────────────────────────────────────┘
```

- **One Worker** serves `dist/` as static assets and the API on `stam.mirzalabs.in`: one deploy,
  same-origin cookies, no CORS. This replaces the Cloudflare Pages plan (PRD §13).
- **Rust:** the `worker` crate with the `http` and `d1` features; `axum` for routes; `serde`
  for JSON. Release builds use `opt-level = "z"`, LTO and `wasm-opt -Oz` to stay under the
  free plan's 3 MB compressed Worker limit.
- **One `TreeRoom` Durable Object per shared tree** (SQLite-backed, which the free plan
  requires). It holds the authoritative tree and orders every edit. It uses WebSocket
  hibernation, so idle connections cost nothing.
- **D1** holds accounts, sessions, tree ownership and links. **R2** holds photos and backups.
- **Toolchains.** Bun stays the frontend toolchain. Cargo builds the backend. Wrangler runs it
  locally (`wrangler dev`) and deploys it.
- The service worker (`src/sw.ts`) never caches `/api/*`.

### 3.1 Code layout

| Path | Purpose | Depends on |
|---|---|---|
| `src/core/` (TS) | Unchanged role. Gains deterministic ids and an injected clock (§5.1) | — |
| `src/sync/` (TS, new) | Browser sync logic, pure: `SyncClient` (pending queue, rebase), revert builder, applying `changes`. Protocol and model types come from `protocol.gen.ts`, generated from Rust | `src/core` |
| `src/cloud/` (TS, new) | API client, auth state, WebSocket transport, IndexedDB pending queue and cloud tree cache | `src/sync`, `src/storage` |
| `server/` (new) | Cargo workspace | — |
| `server/stam-core` | Rust port of `src/core/model`, `commands`, `validate`, the fuzzy-date pieces the commands need, deterministic ids and the privacy filter. Pure Rust with no I/O; also builds to WASM via `wasm-bindgen` for the parity suite | `serde` |
| `server/stam-room` | `RoomCore`: room logic as plain Rust with a storage trait: apply ops, roles, revert, restore, history, comments, privacy view, rate limits. Protocol message types use `ts-rs` to generate `src/sync/protocol.gen.ts`. Also builds to WASM for the convergence suite | `stam-core` |
| `server/stam-worker` | workers-rs: axum routes, Google OAuth, sessions, D1 queries, the `TreeRoom` adapter (SQL storage, sockets, alarms, R2), cron backup | `stam-room` |
| `wrangler.jsonc` | Bindings: `ASSETS`, `DB` (D1), `PHOTOS` (R2), `TREE_ROOM` (DO); cron trigger | — |
| `src/ui/` | Share dialog, role chip, presence, connection state, comments, history panel | `src/cloud` |

`RoomCore` holds all room logic, so `cargo test` covers it without Cloudflare. `TreeRoom` only
adapts it to Durable Object storage, sockets and alarms.

## 4. Data

### 4.1 D1

| Table | Columns |
|---|---|
| `user` | `id`, `google_sub` unique, `email`, `name`, `avatar_url`, `created_at` |
| `session` | `token_hash` PK, `user_id`, `created_at`, `expires_at` (30 days, sliding) |
| `tree` | `id` (the tree's existing id), `owner_id`, `name`, `created_at`, `deleted_at` |
| `share_link` | `id`, `tree_id`, `role` (`view` \| `comment` \| `edit`), `hide_living` (view only), `token_hash` unique, `created_at`, `revoked_at` |

- At most one active link per tree and role. "Reset link" revokes the old link and creates a
  new one.
- Link tokens and session tokens are 32 random bytes in base64url. Link URLs have the form
  `stam.mirzalabs.in/s/<token>`.
- Only the SHA-256 of a token is stored, so a database leak yields no working link or session.
- Migrations are SQL files under `server/migrations/`, applied with `wrangler d1 migrations`.

### 4.2 TreeRoom SQLite

| Table | Columns | Notes |
|---|---|---|
| `meta` | `version`, `doc` (JSON), `doc_version`, `people_count` | The tree as of `doc_version`. It is rewritten every 50 ops or after 30 s idle (alarm), not on every op |
| `ops` | `version` PK, `op_id` unique, `author_kind` (`owner` \| `link`), `author_id`, `author_name`, `kind` (`cmd` \| `revert` \| `restore` \| `upload`), `payload` JSON, `changes` JSON, `at` | Kept in full; the source of history. The resulting `changes` (§5.2) are stored, so replay never re-runs commands |
| `checkpoints` | `version` PK, `doc` JSON | The whole tree every 500 versions; history preview starts from the nearest one |
| `comments` | `id`, `person_id`, `author_kind`, `author_id`, `author_name`, `body`, `created_at`, `edited_at`, `deleted_at` | |
| `threads` | `person_id` PK, `resolved_at`, `resolved_by` | A new comment clears `resolved_at` |

- The in-memory tree is the truth while the room is awake. After a restart the room loads
  `meta.doc` and applies the `changes` of every op after `doc_version`.
- Each op costs about two row writes (the row plus the `op_id` index), against 100,000 a day on
  the free plan.
- Comments survive when their person is deleted but are shown only while the person exists, so
  an undo or a restore brings the thread back.

### 4.3 R2

- `photos/<treeId>/<photoId>.webp`.
- `backups/<yyyy-mm-dd>/<treeId>.json`, removed after 30 days by a lifecycle rule.

### 4.4 Browser

- `TreeMeta` gains an optional `cloud` record:
  - `role` (`owner` | `view` | `comment` | `edit`)
  - `token` (for link trees)
  - `hideLiving`
  - `version` (the last confirmed one)
- A new IndexedDB store holds each cloud tree's pending ops.
- The cloud tree's local copy is a cache: confirmed tree plus pending ops. The v1 compare-and-swap
  save guard and the journal apply to local-only trees only.
- Link users' `clientId` (random) and display name live in `localStorage`.

## 5. Sync

### 5.1 Edit rules on both sides

**TypeScript (`src/core`) gains `applyCommand(doc, cmd, opts?)`, where
`opts = { now?: Date; opId?: string }`:**
- **Ids.** With `opId`, new person and union ids come from an id source: `opId` (a
  10-character nanoid) plus a 2-character base64url counter, taken in the order the handler asks
  for them. That gives 12 characters, the current `ID_LENGTH`. Without `opId`, `newId()` is used
  as today. The id source travels in `HandlerContext`, so `src/core` stays pure.
- **Time.** Taken from `now`. The server's value wins, because `applied` carries `updatedAt`.

**Rust (`stam-core`) mirrors it exactly:**
- `apply_command(doc, cmd, now, op_id) -> Result<Changes, CommandError>` with the same command
  set, the same id order, the same `validate` rules and the same error codes.
- Documents and commands use the TS JSON shape (`serde` with `camelCase` and
  `skip_serializing_if` for optional fields), so the two sides compare as JSON.

**Revert** (collaborative undo) is built in TS from a `HistoryEntry`:
- It lists the entities the entry touched (`persons/<id>`, `unions/<id>`, `unionOrder/<id>`,
  `name`, `rootPersonId`), each with its value before and after.
- The server applies it in Rust: check that each entity still equals `after` (JSON equality),
  write `before`, then run `validate`. Any mismatch refuses the whole revert.

### 5.2 Changes: the wire format for edits

Each applied op is broadcast as entity-level changes, not Immer patches, so both languages
produce and read the same simple shape:

```jsonc
{
  "persons":    { "<id>": { /* full Person */ } | null },   // null = removed
  "unions":     { "<id>": { /* full Union */ } | null },
  "unionOrder": { "<personId>": ["<unionId>", ...] | null },
  "tree":       { "name"?: "...", "rootPersonId"?: "..." | null, "updatedAt": "..." }
}
```

- The server builds `changes` by comparing each touched entity before and after.
- The client applies them with one small function (`applyChanges`, in TS and in Rust).
- History replay and the privacy view also work in `changes`.

### 5.3 Protocol (JSON over one WebSocket per open tree)

Rust message types generate `src/sync/protocol.gen.ts` with `ts-rs`. CI fails if the generated
file is out of date.

| Direction | Message | Meaning |
|---|---|---|
| C→S | `hello {clientId, name?, lastVersion?}` | First message |
| C→S | `op {opId, cmd}` | An editor's command |
| C→S | `revert {opId, entries}` | Collaborative undo or redo |
| C→S | `restore {opId, version}` | Restore a history version |
| C→S | `comment.add {personId, body}` · `comment.edit {id, body}` · `comment.delete {id}` · `thread.resolve {personId}` · `thread.reopen {personId}` | Comments |
| C→S | `presence {selectedPersonId?}` | Throttled to 2 per second |
| C→S | `history.list {before?}` · `history.get {version}` | History page and preview |
| S→C | `welcome {role, hideLiving, version, doc?, ops?, comments?, presence}` | `ops` when the client is at most 1,000 versions behind, otherwise `doc` |
| S→C | `applied {version, opId, author, changes}` | Broadcast to every socket, including the author's |
| S→C | `rejected {opId, code, message}` | Only to the author |
| S→C | `comment.*` · `thread.*` · `presence [...]` · `history.*` | |
| S→C | `busy {retryAfter}` | A free-plan limit or rate limit was hit; the client keeps its queue |
| S→C | close codes `4401` revoked · `4404` tree deleted · `4413` tree too large | |

- **Ordering.** The room handles one message at a time. An `op` runs through
  `stam_core::apply_command`. Then it is logged, a version is assigned and `applied` is
  broadcast.
- **Idempotence.** An `op_id` already in `ops` is answered with its original `applied`, so
  resending after a reconnect is safe.

### 5.4 Client (`SyncClient`, TS)

**State:**
- `confirmed`: the tree at the last version the server applied;
- `pending`: this client's unconfirmed ops, in order;
- `view`: `confirmed` with `pending` re-run on top. The editor renders `view`.

**A local edit:**
1. Make an `opId`.
2. Run the TS `applyCommand` on `view` for instant feedback.
3. Append the op to `pending`, persist it to IndexedDB, and send it if connected.

**When `applied` arrives:**
1. Apply its `changes` to `confirmed`.
2. If the `opId` is ours, drop it from `pending`.
3. Rebuild `view` by re-running the remaining `pending` on the new `confirmed`.
4. A pending op that now throws is dropped, and the drops are shown in one notice ("2 changes
   couldn't be applied: Sara was removed").

Because ids are deterministic, the client's optimistic result for its own op equals the server's
`changes`. The parity suite checks this.

**Other messages:**
- `rejected` drops that op and explains why.
- `busy`: keep `pending` and retry after `retryAfter`.

**Undo and redo:**
- Each client's History holds only its own edits.
- Undo sends `revert`. If the server refuses it, the message names who changed the entity since.

**Reconnect:**
- Exponential backoff with jitter, between 1 and 30 seconds.
- `hello` sends `lastVersion`; then all `pending` ops are re-sent in order.

**Offline:**
- Editors keep editing; `pending` is saved in IndexedDB and survives a reload.
- The toolbar shows "Offline, N changes waiting".
- View and comment users see the cached tree read-only.

### 5.5 Privacy view (hide-living view links)

- `welcome.doc` is the Rust port of `applyPrivacy` (`src/export/render/privacy.ts`): a living
  person keeps only their names, and a union with a living partner loses its dates.
- For each `applied`, these sockets get the touched entities taken from the redacted document.
- Photos of living people answer 404 for these links.
- A property test asserts that no message to such a socket ever contains a living person's birth,
  death, notes, nickname or photo id.

## 6. Roles

Checked by the room on every message and by the Worker on every HTTP route. The UI only mirrors
them.

| Capability | View | Comment | Edit | Owner |
|---|---|---|---|---|
| Open the tree, live updates, presence | ✅ | ✅ | ✅ | ✅ |
| Read comments | — | ✅ | ✅ | ✅ |
| Add comments; edit and delete own; resolve or reopen threads | — | ✅ | ✅ | ✅ |
| Delete anyone's comment | — | — | — | ✅ |
| Edit the tree, upload photos | — | — | ✅ | ✅ |
| History list, preview, restore | — | — | ✅ | ✅ |
| Create, reset and turn off links; delete the cloud tree | — | — | — | ✅ |

- **Connecting.**
  - Owners connect with their session cookie.
  - Link users connect to `/api/trees/:id/ws?t=<token>`. Browsers cannot set headers on
    WebSockets, and the page URL already contains the token.
  - The Worker resolves the role from D1 and forwards `{role, linkId, hideLiving, author}` to the
    room in internal headers. The room keeps it in the socket's serialized attachment, so it
    survives hibernation.
- **Turning a link off or resetting it.**
  - The Worker tells the room to close sockets with that `linkId`, using code 4401.
  - The client then deletes its cached copy and shows "This link was turned off by the owner".
- **Deleting the cloud tree.**
  - Every socket closes with code 4404.
  - D1 marks the tree deleted, R2 photos are removed, and the room wipes its storage.
  - The owner's local copy stays as a local-only tree.

## 7. HTTP API

### 7.1 Auth (own implementation; the TS auth library no longer applies)

**Sign-in flow:**
- `GET /api/auth/google?return=<path>`:
  - creates `state` and a PKCE verifier;
  - keeps them in a 10-minute signed `HttpOnly` cookie;
  - redirects to Google with the `openid email profile` scopes.
- `GET /api/auth/google/callback`:
  1. Checks `state` against the cookie.
  2. Exchanges the code at Google's token endpoint with `Fetch`.
  3. Reads the user from Google's userinfo endpoint, so no JWT signatures need verifying.
  4. Upserts `user` by `google_sub` and creates a `session`.
  5. Sets `stam_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, 30 days) and redirects to
     `return` (same-origin paths only).
- `POST /api/auth/signout` deletes the session.
- **CSRF:** every state-changing route requires `Content-Type: application/json` and an `Origin`
  header equal to the site.
- **Later:** an email magic link adds a `login_token` table and an email provider.

### 7.2 Routes

| Route | Who | Does |
|---|---|---|
| `GET /api/me` | owner | User and their cloud trees |
| `POST /api/trees` | owner | Upload a local tree (`{doc}`): validated in Rust, then the room is created |
| `DELETE /api/trees/:id` | owner | Stop sharing and delete the cloud copy |
| `GET /api/trees/:id/links` · `POST` · `DELETE /:linkId` | owner | Manage links. `POST {role, hideLiving?}` returns the URL once |
| `GET /api/s/:token` | anyone | Resolve a link: `{treeId, role, hideLiving, name}`, or 404 |
| `GET /api/trees/:id/ws` | owner or link | WebSocket upgrade into the room |
| `PUT /api/trees/:id/photos/:photoId` | edit, owner | WebP up to 300 KB, into R2 through the room |
| `GET /api/trees/:id/photos/:photoId` | per role | From R2 through the room's access check; `Cache-Control: private, immutable` |

**Uploading a tree:**
1. `POST /api/trees` with the tree.
2. `PUT` each photo.
3. The tree keeps its id, and its local `TreeMeta` gets `cloud.role = "owner"`.

## 8. Version history

- **The panel.** The history panel lists ops newest first, grouped by author within a 10-minute
  window, e.g. "**Ali** added 3 people · Tue 14:02".
  - Each group's label is built from its commands' types.
  - Restores and reverts are labelled as such.
- **Preview.**
  - The room builds the version from the nearest checkpoint plus the stored `changes`.
  - The client shows it read-only with a banner: "Viewing Tue 14:02 · Restore · Back to now".
- **Restore.**
  - A `restore` op replaces the tree with the old version, after `validate`.
  - It is logged like any op, so it shows in history and can itself be undone by restoring the
    version before it.
- **Access.** Edit links and the owner only.

## 9. UI

All strings go through `t()` in `en`, `ur` and `ar`, and all layouts must work right-to-left.

- **Share button** in the toolbar opens the share dialog:
  - Signed out: "Sign in with Google to share".
  - Signed in, not yet uploaded: "Upload and share", with a line saying what leaves the device.
  - Uploaded: three rows (**View**, **Comment**, **Edit**), each with *Create link* or
    *Copy / Reset / Turn off*. The View row has a "Hide living people's details" switch.
  - Danger zone: "Stop sharing and delete cloud copy".
- **Opening `/s/<token>`.**
  - Resolves the link, caches the tree and opens it with a role chip ("Can view", "Can
    comment", "Can edit").
  - The first comment or edit asks "What should we call you?".
- **Tree list.**
  - New sections "Shared with me" (link trees in this browser) and "In your account" (when signed
    in, including trees uploaded from another device).
  - Removing a link tree from this list only forgets it locally.
- **Toolbar.**
  - Presence avatars (initials with `avatarHue`; "+N"); a person someone has selected shows their
    colour ring.
  - Connection state: *Live*, *Reconnecting*, *Offline, N changes waiting*.
- **View and comment roles.**
  - No + handles, no drag, panel fields read-only.
  - No import or GEDCOM merge into the cloud tree; export stays available.
- **Comments.**
  - A Comments section in the person panel, with Resolve and Reopen.
  - Cards show a badge with the open comment count.
- **History.** A panel from the toolbar overflow menu (§8).
- **Copy changes.** The privacy page and the landing page's privacy facts change to "Local by
  default. Nothing leaves your device unless you share a tree", and state what sharing uploads.

## 10. Limits, abuse and operations

| Limit | Value |
|---|---|
| People per cloud tree | 5,000 (`TUNED_PEOPLE`) |
| Photo | 300 KB WebP |
| Comment | 2,000 characters |
| Display name | 40 characters |
| Ops per socket | 30 per second, burst 60 (token bucket in `RoomCore`) |
| Comments per socket | 10 per minute |
| Link resolutions and uploads per IP | Workers rate-limit binding if the free plan has it, otherwise a per-IP counter in D1 (decided in the plan) |

- **Free plan.** When a daily limit is reached, Cloudflare fails the call. The room or Worker
  answers `busy` (or HTTP 503 with `Retry-After`), and clients keep their queue.
- **CPU and size.**
  - The free plan allows 10 ms of CPU per request and a 3 MB compressed Worker.
  - P1 measures a cold room load and an op on a 5,000-person tree, plus the compressed WASM size.
  - If any limit is exceeded, the fix is the $5/month Workers Paid plan (10 MB, more CPU); no
    design change.
- **Backups.**
  - A nightly cron (`#[event(scheduled)]`) writes every tree changed that day to R2.
  - D1 and Durable Object SQLite also have Cloudflare's built-in point-in-time restore.
- **Secrets.** `SESSION_SECRET` (cookie signing), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
  are Worker secrets, never in the repo.
- **Logging.** Only ids, roles and error codes; never tree content, comment bodies or tokens.

## 11. Testing

| Layer | What | Tool |
|---|---|---|
| TS core | Deterministic ids: same `opId` gives same ids; injected clock; existing tests unchanged | `bun test` |
| Rust core | Unit tests per command and per `validate` rule, mirroring the TS tests | `cargo test` |
| **Parity (merge gate)** | `stam-core` is built to WASM and loaded in `bun test`. fast-check generates random trees and command sequences; each runs through the TS `applyCommand` and the Rust `apply_command`. Results must be equal as JSON, including created ids, error codes on refusal, and `validate` outcomes. Fixtures: the 20 named layout fixtures and the GEDCOM corpus trees | `bun test` + fast-check |
| `RoomCore` | Every message type × every role; idempotent resend; revert conflicts; restore; checkpoint + replay equals the live tree; rate limits | `cargo test` |
| Convergence | `stam-room` as WASM in `bun test`, with 2–5 TS `SyncClient`s: random commands, delivery delays, disconnects and offline periods. Every client ends equal to the server, and the server's tree always passes `validate` | `bun test` + fast-check |
| Privacy | No message to a hide-living socket contains living details, over random trees and op streams | `cargo test` + `proptest` |
| Worker | Routes, OAuth callback (Google mocked), sessions, link lifecycle, WebSocket upgrade, photos: `bun test` against `wrangler dev` (local Miniflare) | `bun test` |
| E2E | Two browser contexts edit one tree live; each link role; revoke while open; offline edits, then reconnect; history restore | Playwright |

**Scripts:**
- `bun run verify:server` runs `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`,
  the `ts-rs` freshness check, and the parity and convergence suites.
- Per the project's merge rule, merge checks are `verify`, `verify:server` and `build`. E2E runs
  at the end of each phase.

## 12. Phases

Each phase is deployable on its own.

| Phase | Contents |
|---|---|
| **P1 Foundation** | Cargo workspace; `stam-core` port with the **parity suite green**; deterministic ids and clock in the TS core; single Worker with static assets and custom domain; D1 schema; Google OAuth and sessions; `RoomCore` + `TreeRoom` with snapshot, ops and checkpoints; upload tree and photos; **view links** with hide-living; live updates while the owner edits; share dialog (view row); "Shared with me" and "In your account"; CPU and size measurement; privacy copy |
| **P2 Co-editing** | Edit links; name prompt; `SyncClient` rebase; collaborative undo (`revert`); presence; connection state; offline pending queue; convergence suite |
| **P3 Comments** | Comment links; threads per person; badges; resolve and reopen; rate limits |
| **P4 History** | History list and grouping; preview; restore; nightly backups |
| Later | Email magic-link sign-in; notifications; transferring ownership |
| Later: Private vault | End-to-end encryption for **unshared** account trees: key from a passphrase plus a recovery key, encrypted photos, an opaque blob on the server, whole-tree "newer version or pick one" instead of live merging. Sharing a vault tree switches it to normal mode. Shared trees stay server-readable by design (D9). E2EE for shared trees would need a sequencer-only server and key rotation on revoke, so it is a redesign, not an add-on |

## 13. Out of scope

- Per-person invites and member lists.
- Verified identities for link users.
- Editing comments on someone else's behalf.
- Merging two cloud trees.
- Sharing a single branch.
- Billing.

## 14. Risks

| Risk | Mitigation |
|---|---|
| The Rust port drifts from the TS core, so clients and server disagree | Parity suite is a merge gate. Any change to `src/core/commands` or `validate` must land with the matching Rust change in the same commit |
| workers-rs D1 support is marked alpha | Queries are few and simple, behind one `Db` module; if a D1 API breaks, that module calls the JS binding through `wasm-bindgen` |
| Free-plan 3 MB Worker size or 10 ms CPU | Measured in P1; size flags in §3; Workers Paid ($5/month) if exceeded |
| A leaked edit link lets a stranger edit | Owner can reset or turn off a link instantly (sockets close); history restore undoes damage |
| Unverified names allow impersonation | Shown as typed; the owner's name carries an "Owner" mark; documented in the share dialog |
| Rebase drops an offline editor's work | Dropped ops are named in a notice; history keeps everything that did apply |
| Hand-written OAuth mistakes | PKCE + state cookie, same-origin `return` only, a test for each failure path, and a security review at the end of P1 |
| The privacy filter leaking | Redacted whole entities only, plus the privacy property test |
| Free daily limits reached | `busy` with client-side queueing; upgrade path is configuration only |
