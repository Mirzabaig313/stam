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
| D6 | Backend | Cloudflare: Workers, Durable Objects, D1, R2, free plan | Supabase (pauses after 1 week idle, 1 GB photos); Bun on a VPS (self-run) |
| D7 | Privacy on links | View links may hide living people's details | Not offered |
| D8 | Offline editors | Keep editing; queued edits sync on reconnect | Read-only when offline |
| D9 | Merge model | Server-authoritative commands with client rebase (Figma, Linear, tldraw, Replicache) | Yjs CRDT (merges can break tree invariants); one editor at a time |
| D10 | Version history | In the first release | Later |
| D11 | API framework | Hono on the Worker; Bun as toolchain | Plain `fetch` handler |

Why D9: Google Docs uses Operational Transformation because text edits are positional. Stam's
commands refer to people and unions by id, so a command can simply be re-run on the newer tree,
and the existing `validate` keeps refusing any result that would break the tree.

## 3. Architecture

```
Browser (existing app)                     Cloudflare
┌───────────────────────────┐    HTTPS   ┌─────────────────────────────────────┐
│ editor UI (React/Zustand) │──/api/*──▶│ Worker "stam"                       │
│ src/cloud/  API, auth     │            │  ├ serves dist/ (static assets)     │
│ src/sync/   SyncClient    │◀──WS────▶│  ├ /api/auth/*  Better Auth, Google │
│  pending queue (IndexedDB)│            │  ├ /api/trees, /links, /s/:token    │
└───────────────────────────┘            │  └ /api/trees/:id/ws ─┐             │
                                         │ Durable Object TreeRoom (1 per tree)│
                                         │  SQLite: doc, ops, checkpoints,     │
                                         │          comments                   │
                                         │  runs src/core applyCommand+validate│
                                         │ D1: users, sessions, trees, links   │
                                         │ R2: photos, nightly backups         │
                                         └─────────────────────────────────────┘
```

- **One Worker** serves `dist/` as static assets and the API on `stam.mirzalabs.in`: one deploy,
  same-origin cookies, no CORS. This replaces the Cloudflare Pages plan (PRD §13).
- **Hono** is the API framework. It runs on Workers and on Bun, Better Auth mounts on it
  directly, and `app.request()` lets `bun test` call routes with no server running. Bun stays the
  toolchain (install, build, test, fmt). Wrangler is used only to run the Worker locally
  (`wrangler dev`, for Durable Objects) and to deploy.
- **One `TreeRoom` Durable Object per shared tree** (SQLite-backed, which the free plan
  requires). It holds the authoritative tree and orders every edit. It uses the WebSocket
  Hibernation API so idle connections cost nothing.
- **D1** holds accounts, tree ownership and links. **R2** holds photos and backups.
- The service worker (`src/sw.ts`) never caches `/api/*`.

### 3.1 Code layout

| Path | Purpose | Depends on |
|---|---|---|
| `src/core/` | Unchanged role. Gains deterministic ids and an injected clock (§5.1) | — |
| `src/sync/` (new) | Pure TypeScript shared by client and server: protocol message types and parsing, `RoomCore`, `SyncClient`, role checks, the privacy view, revert and history helpers. No `fetch`, no WebSocket, no Cloudflare APIs | `src/core` |
| `src/cloud/` (new) | Browser side: API client, auth state, WebSocket transport for `SyncClient`, the IndexedDB pending queue and cloud tree cache | `src/sync`, `src/storage` |
| `worker/` (new) | Worker entry, Hono app and routes, Better Auth setup, D1 queries, the `TreeRoom` adapter (SQLite, sockets, alarms, R2), cron backup. `wrangler.jsonc` at the repo root | `src/sync`, `src/core` |
| `src/ui/` | Share dialog, role chip, presence, connection state, comments, history panel | `src/cloud` |

`RoomCore` holds all room logic as a plain class with a storage interface, so it is tested with
`bun test`. `TreeRoom` only adapts it to Durable Object storage, sockets and alarms.

## 4. Data

### 4.1 D1

- Better Auth's own tables: `user`, `session`, `account`, `verification`.
- `tree`: `id` (the tree's existing id), `owner_id`, `name`, `created_at`, `deleted_at`.
- `share_link`: `id`, `tree_id`, `role` (`view` | `comment` | `edit`), `hide_living`
  (view only), `token_hash` (unique), `created_at`, `revoked_at`.
  - At most one active link per tree and role.
  - "Reset link" revokes the old link and creates a new one.

Link tokens are 16 random bytes in base64url, giving URLs of the form
`stam.mirzalabs.in/s/<token>`. Only the SHA-256 of the token is stored.

### 4.2 TreeRoom SQLite

| Table | Columns | Notes |
|---|---|---|
| `meta` | `version`, `doc` (JSON), `doc_version`, `people_count` | The tree as of `doc_version`. It is rewritten every 50 ops or after 30 s idle (alarm), not on every op |
| `ops` | `version` PK, `op_id` unique, `author_kind` (`owner` \| `link`), `author_id`, `author_name`, `kind` (`cmd` \| `revert` \| `restore` \| `upload`), `payload` JSON, `patches` JSON, `at` | Kept in full; the source of history. Forward patches are stored, so replay never re-runs commands |
| `checkpoints` | `version` PK, `doc` JSON | The whole tree every 500 versions; history preview starts from the nearest one |
| `comments` | `id`, `person_id`, `author_kind`, `author_id`, `author_name`, `body`, `created_at`, `edited_at`, `deleted_at` | |
| `threads` | `person_id` PK, `resolved_at`, `resolved_by` | A new comment clears `resolved_at` |

The in-memory tree is the truth while the room is awake. After a restart the room loads `meta.doc`
and replays the `ops` after `doc_version` using their stored patches. Each op costs about two row
writes (the row plus the `op_id` index), against 100,000 a day on the free plan.

Comments survive when their person is deleted but are shown only while the person exists, so an
undo or a restore brings the thread back.

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

### 5.1 Changes to `src/core`

- `applyCommand(doc, cmd, opts?)`, where `opts = { now?: Date; opId?: string }`:
  - **Ids.** With `opId`, the handlers' `newId()` calls are replaced by an id source that returns
    `opId + counter` (a 10-character nanoid plus a 2-character base64url counter: 12 characters,
    the current `ID_LENGTH`). Server and client therefore create identical ids. Without `opId`,
    behaviour is as today. The id source is passed through `HandlerContext`; `src/core` stays
    pure.
  - **Time.** The server supplies `now` from its own clock. The patch it broadcasts carries
    `updatedAt`, so clients end up with the server's value.
- `revert` (pure helper in `src/sync`): built from a `HistoryEntry`. It lists the entities the
  entry touched (`persons/<id>`, `unions/<id>`, `unionOrder/<id>`, `name`, `rootPersonId`) with
  their value before and after. Applying it checks that each entity still equals `after`, writes
  `before`, then runs `validate`. Any mismatch refuses the whole revert.

### 5.2 Protocol (JSON over one WebSocket per open tree)

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
| S→C | `applied {version, opId, author, patches}` | Broadcast to every socket, including the author's |
| S→C | `rejected {opId, code, message}` | Only to the author |
| S→C | `comment.*` · `thread.*` · `presence [...]` · `history.*` | |
| S→C | `busy {retryAfter}` | A free-plan limit or rate limit was hit; the client keeps its queue |
| S→C | close codes `4401` revoked · `4404` tree deleted · `4413` tree too large | |

- **Ordering.** The room handles one message at a time. An `op` is applied with
  `applyCommand(doc, cmd, {now, opId})`. Then it is logged, a version is assigned and `applied` is
  broadcast.
- **Idempotence.** An `op_id` already in `ops` is answered with its original `applied`, so
  resending after a reconnect is safe.

### 5.3 Client (`SyncClient`)

**State:**
- `confirmed`: the tree at the last version the server applied;
- `pending`: this client's unconfirmed ops, in order;
- `view`: `confirmed` with `pending` re-run on top. The editor renders `view`.

**A local edit:**
1. Make an `opId`.
2. Run `applyCommand` on `view` for instant feedback.
3. Append the op to `pending`, persist it to IndexedDB, and send it if connected.

**When `applied` arrives:**
1. Apply its patches to `confirmed`.
2. If the `opId` is ours, drop it from `pending`.
3. Rebuild `view` by re-running the remaining `pending` on the new `confirmed`.
4. A pending op that now throws is dropped, and the drops are shown in one notice ("2 changes
   couldn't be applied: Sara was removed").

**Other messages:**
- `rejected` drops that op and explains why.
- `busy`: keep `pending` and retry after `retryAfter`.

**Undo and redo:**
- Each client's History holds only its own edits.
- Undo sends `revert` with the entry's before and after values. If the server refuses it, the
  message names who changed the entity since.

**Reconnect:**
- Exponential backoff with jitter, between 1 and 30 seconds.
- `hello` sends `lastVersion`; then all `pending` ops are re-sent in order.

**Offline:**
- Editors keep editing; `pending` is saved in IndexedDB and survives a reload.
- The toolbar shows "Offline, N changes waiting".
- View and comment users see the cached tree read-only.

### 5.4 Privacy view (hide-living view links)

- `welcome.doc` is `applyPrivacy(doc)`, the existing export privacy filter in
  `src/export/render/privacy.ts`, moved to `src/core` so the Worker can import it.
- For these sockets the room does not send raw patches. Instead, for every person and union the
  op touched, it sends a whole-entity `replace` or `remove` taken from `applyPrivacy(next)`.
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
  - The Worker resolves the role from D1 and passes `{role, linkId, hideLiving, author}` to the
    room. The room stores it in the socket's attachment.
- **Turning a link off or resetting it.**
  - The Worker tells the room to close sockets with that `linkId`, using code 4401.
  - The client then deletes its cached copy and shows "This link was turned off by the owner".
- **Deleting the cloud tree.**
  - Every socket closes with code 4404.
  - D1 marks the tree deleted, R2 photos are removed, and the room wipes its storage.
  - The owner's local copy stays as a local-only tree.

## 7. HTTP API

| Route | Who | Does |
|---|---|---|
| `/api/auth/*` | anyone | Better Auth: Google sign-in, session, sign-out |
| `GET /api/me` | owner | User and their cloud trees |
| `POST /api/trees` | owner | Upload a local tree (`{doc}`), create the room |
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
  - The room builds the version from the nearest checkpoint plus the stored patches.
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
| Ops per socket | 30 per second, burst 60 |
| Comments per socket | 10 per minute |
| Link resolutions and uploads per IP | Workers rate-limit binding (availability on the free plan to be confirmed in the plan) |

- **Free plan.** When a daily limit is reached, Cloudflare fails the call. The room or Worker
  answers `busy` (or HTTP 503 with `Retry-After`), and clients keep their queue.
- **CPU.** The free plan allows 10 ms of CPU per request. P1 measures a cold room load and an op
  on a 5,000-person tree. If either exceeds it, the fix is the $5/month Workers Paid plan; no
  design change.
- **Backups.**
  - A nightly cron writes every tree changed that day to R2.
  - D1 and Durable Object SQLite also have Cloudflare's built-in point-in-time restore.
- **Secrets.** `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are Worker
  secrets, never in the repo.
- **Logging.** Only ids, roles and error codes; never tree content, comment bodies or tokens.

## 11. Testing

| Layer | What | Tool |
|---|---|---|
| Core | Deterministic ids: same `opId` gives same ids on every run; injected clock; existing tests unchanged | `bun test` |
| `RoomCore` | Every message type × every role; idempotent resend; revert conflicts; restore; checkpoint and replay give the same tree | `bun test` |
| Convergence | 2–5 simulated clients, random commands, random delivery delay, disconnects and offline periods: every client ends equal to the server, and the server's tree always passes `validate` | `bun test` + fast-check |
| Privacy | No message to a hide-living socket contains living details, over random trees and op streams | `bun test` + fast-check |
| Routes | Hono routes, auth guard, link lifecycle, role checks: `app.request()` with in-memory fakes for D1, R2 and the room | `bun test` |
| Worker | WebSocket upgrade into a real `TreeRoom`, photos through R2, D1 queries: `bun test` against `wrangler dev` (local Miniflare), so `bun test` stays the only test runner | `bun test` |
| E2E | Two browser contexts edit one tree live; each link role; revoke while open; offline edits, then reconnect; history restore | Playwright |

Per the project's merge rule, merge checks are `verify` and `build`. E2E runs at the end of each
phase.

## 12. Phases

Each phase is deployable on its own.

| Phase | Contents |
|---|---|
| **P1 Foundation** | Single Worker with static assets and custom domain; D1 schema; Better Auth with Google; deterministic ids and clock in core; `RoomCore` + `TreeRoom` with snapshot, ops and checkpoints; upload tree and photos; **view links** with hide-living; live updates while the owner edits; share dialog (view row); "Shared with me" and "In your account"; CPU measurement; privacy copy |
| **P2 Co-editing** | Edit links; name prompt; `SyncClient` rebase; collaborative undo (`revert`); presence; connection state; offline pending queue |
| **P3 Comments** | Comment links; threads per person; badges; resolve and reopen; rate limits |
| **P4 History** | History list and grouping; preview; restore; nightly backups |
| Later | Email magic-link sign-in (Better Auth plugin plus an email service); notifications; transferring ownership |

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
| 10 ms CPU on the free plan with large trees | Measured in P1; Workers Paid ($5/month) if exceeded |
| A leaked edit link lets a stranger edit | Owner can reset or turn off a link instantly (sockets close); history restore undoes damage |
| Unverified names allow impersonation | Shown as typed; the owner's name carries an "Owner" mark; documented in the share dialog |
| Rebase drops an offline editor's work | Dropped ops are named in a notice; history keeps everything that did apply |
| The privacy filter leaking through patches | Whole-entity redacted replacements, plus the privacy property test |
| Free daily limits reached | `busy` with client-side queueing; upgrade path is configuration only |
