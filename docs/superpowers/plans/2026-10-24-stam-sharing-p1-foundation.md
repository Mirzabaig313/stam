# Stam Sharing P1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner signs in with Google, uploads a tree with its photos, edits it live from any
device, and shares view-only links (optionally hiding living people's details) whose viewers see
every edit as it happens.

**Architecture:**
- The browser keeps the TypeScript core and gains a `SyncClient` that applies edits instantly and
  replays its unconfirmed edits on top of the server's.
- A Rust Worker (workers-rs + axum) on Cloudflare serves the site and the API. Each shared tree
  lives in a `TreeRoom` Durable Object.
- The room re-runs every edit with `stam-core`, a Rust port of the TS rules. The Rust port is
  held to the TypeScript behaviour by a WASM parity suite that runs inside `bun test`.

**Tech Stack:**
- Rust (stable 1.99+), `worker` 0.8 (features `http`, `d1`), `axum`, `serde`/`serde_json`
  (`preserve_order`), `indexmap`, `wasm-bindgen`, `wasm-pack`, `sha2`, `hmac`, `aes-gcm`,
  `getrandom`, `base64`, `proptest`.
- Wrangler (dev dependency), Cloudflare D1, R2, Durable Objects (SQLite).
- Bun 1.4.4, TypeScript, React 19, fast-check, Playwright.
- Add every crate with `cargo add` and every package with `bun add`, so each lands on its latest
  version.

**Spec:** `docs/superpowers/specs/2026-10-24-stam-sharing-design.md` (read it first; this plan
argues from it). Background: `stam-prd.md`.

**Branch:** `feat/sharing-p1` from `main`. Commit per task on the branch. At merge, squash into
one commit per area (core, server, client), per the owner's preference.

## Deviations from the spec (decided while planning; the spec is updated in Task 13)

1. **The sync engine moves into P1.** `SyncClient` with rebase, collaborative undo (`revert`) and
   the convergence suite are here, not in P2. Reason: an owner editing live from two devices or
   tabs is already two writers. P2 keeps edit links, the name prompt, presence and the
   persistent offline queue.
2. **No `ts-rs`.** Protocol types are hand-written in `src/sync/protocol.ts`. Drift is caught
   because the TS client talks to the real Rust room (compiled to WASM) in the protocol and
   convergence suites. ts-rs cannot import the TS-owned model types (`TreeDocument`, `Command`)
   that the messages carry.
3. **Link tokens are stored twice:** as a SHA-256 hash (for lookup) and AES-GCM encrypted with
   the `LINK_KEY` secret (so the owner can copy a link any time, as in Google Docs). A database
   leak alone still yields no working link.
4. **Upload id collisions.** If another owner already holds the tree's id (e.g. someone imported
   a JSON backup of a shared tree), the server answers 409 `TREE_ID_TAKEN`. The client then
   copies the tree to a new id and uploads that copy.

## Global Constraints

- **Toolchains.** Bun only for the frontend. Cargo for `server/`. Wrangler only for
  `wrangler dev`, D1 migrations and deploy. Latest versions of everything.
- **TS core purity.** `src/core` stays pure: no I/O, no `Date.now()` and no random ids inside
  handlers once an `opId` is given.
- **Parity rule (merge gate).** Any change to `src/core/commands`, `src/core/model/validate.ts`,
  `src/core/model/privacy.ts` or `src/io/json/parseTree.ts` lands in the same commit as the
  matching `server/stam-core` change, with `bun run test:parity` green.
- **Map order is behaviour.** JS iterates `persons`, `unions` and `unionOrder` in insertion
  order, and the commands depend on it (`parentUnionOf` takes the first match; `successorRoot`
  takes the first remaining person). Rust therefore uses `IndexMap`:
  - deleting uses `shift_remove`, never `swap_remove`;
  - assigning to an existing key keeps its position;
  - a new key is appended.
- **Wire encoding.** JSON cannot carry `undefined`. In a command patch, "remove this field" is
  sent as `null`. TS `encodeCommand` and `decodeCommand` translate; Rust treats `null` as
  removal.
- **Timestamps.** Always ISO strings from JS `Date.prototype.toISOString()`. Rust never formats
  dates; the Worker passes `js_sys::Date::new_0().to_iso_string()`.
- **Ids.** Tree, person, union and photo ids match `^[A-Za-z0-9_-]{1,64}$`. Ops create 12-char
  ids: `opId` (10 chars, nanoid alphabet) plus a 2-char base64url counter. The counter alphabet
  is `A–Z a–z 0–9 - _` in that order, so index 0 gives `"AA"`, index 1 `"AB"`, and so on.
- **Limits:**
  - 5,000 people per cloud tree (`TUNED_PEOPLE`)
  - photo ≤ 300 KB, WebP magic bytes required
  - display name ≤ 40 characters
  - ops per socket: token bucket of 30 per second, burst 60
- **Close codes:** `4401` link revoked or session gone · `4404` tree deleted · `4413` tree too
  large.
- **Logging.** Only ids, roles and error codes. Never tree content, comment bodies or tokens.
- **UI strings** go through `t()` with keys in `en.json`, `ur.json` and `ar.json`. Logical CSS
  only. `<bdi>` around names. Visible copy has no em or en dashes.
- **The owner's machine.**
  - Port 3333 is the owner's preview: never bind to it, never `pkill`.
  - No `git push`.
  - Group reviews after Tasks 5, 7, 10 and 12, plus a final review. No per-task reviews.
  - After each task, remove scratch files and merged worktrees.
- **Merge checks:** `bun run verify`, `bun run verify:server`, `bun run build`. E2E only in Task
  13 (`e2e/sharing.spec.ts`), not the full suite.

## Review Focus

1. **The owner has the same cloud tree open in two tabs or devices.** Both must stay editable
   and converge. The v1 SaveGuard must not lock either tab as "changed in another tab", because
   cloud trees skip the guard and the journal. Test in Task 11:
   `cloud trees never lock on a second tab's cache write`.
2. **A view link is revoked while its viewer is offline.** On reconnect the socket closes with
   4401. The client deletes the cached tree and shows "This link was turned off by the owner".
   Tests: Task 10 `revoked link closes and refuses reconnect`; Task 11
   `4401 deletes the cached link tree`.
3. **The uploaded tree's id is already owned by someone else.** Expected: 409, then the client
   re-ids the tree and uploads it under the new id, with no error shown to the user. Tests:
   Task 10 `upload with an id owned by another user is 409`; Task 11
   `upload retries under a new id after TREE_ID_TAKEN`.
4. **The session expires while the editor is open.**
   - HTTP routes answer 401 and the UI asks the owner to sign in again.
   - An open socket keeps working. Its next reconnect is refused with HTTP 401 at the upgrade,
     the transport reports `signedOut`, and it stops retrying until sign-in.
   - Unconfirmed edits stay in `pending` and are sent after sign-in.

   Tests: Task 9 `expired session is 401`; Task 11 `session loss keeps pending edits`.
5. **Some photo uploads fail during sharing.** The tree is still shared. The dialog shows "2
   photos didn't upload" with a Retry button, and Retry sends only the failed ones. Test in
   Task 12: `photo upload failures are reported and retried`.

---

## File map

**TS core (modified):**
- `src/core/commands/types.ts`: `HandlerContext.newId`, `ApplyOptions`.
- `src/core/commands/apply.ts`: `applyCommand(doc, cmd, opts)`.
- `src/core/commands/people.ts`, `relations.ts`: use `ctx.newId()`.
- `src/core/commands/opIds.ts` (new): the id source.
- `src/core/dates/fuzzy.ts`: `sameFuzzyDate`.
- `src/core/model/privacy.ts` (new, moved from `src/export/render/privacy.ts`, which
  re-exports it).

**TS sync and cloud (new):**
- `src/sync/wire.ts`: command encoding.
- `src/sync/changes.ts`: `Changes`, `diffDocs`, `applyChanges`.
- `src/sync/revert.ts`: `EntityChange`, `entityChanges`, `applyRevert`.
- `src/sync/protocol.ts`: message types.
- `src/sync/syncClient.ts`: `SyncClient`.
- `src/cloud/api.ts`, `src/cloud/auth.ts`, `src/cloud/transport.ts`,
  `src/cloud/cloudSession.ts`, `src/cloud/linkTrees.ts`.

**Rust (new):**
- `Cargo.toml` (workspace).
- `server/stam-core/src/{lib,model,parse,validate,tree,dates,ids,commands/*,changes,revert,privacy,wasm}.rs`.
- `server/stam-room/src/{lib,protocol,room,store,ratelimit,wasm}.rs`.
- `server/stam-worker/src/{lib,routes,auth,db,crypto,headers,room_do}.rs`.
- `server/migrations/0001_init.sql`.
- `wrangler.jsonc`.

**Tests (new):**
- `tests/parity/*.test.ts`, `tests/sync/*.test.ts`, `tests/cloud/*.test.ts`,
  `tests/worker/*.test.ts` (skipped unless `WORKER_URL` is set).
- `e2e/sharing.spec.ts`.

**UI (new and modified):**
- `src/ui/share/ShareDialog.tsx`, `share.css`.
- `src/ui/app/LinkPage.tsx`, `src/ui/app/CloudStatus.tsx`.
- `TreeListPage.tsx`, `Toolbar.tsx`, `AppRoutes.tsx`, `EditorPage.tsx`.
- `src/ui/store/editorStore.ts`.
- Locales; `public/_headers`, `public/_redirects`; `src/site/content.ts`; `src/server.ts`
  (dev proxy).

**Scripts:**
- `package.json`: `wasm`, `test:parity`, `test:worker`, `verify:server`, `dev:worker`,
  `deploy`.
- `scripts/test-worker.ts`, `scripts/wasm-size.ts`.

---

## Group A: TypeScript groundwork

### Task 1: Deterministic ids, injected clock and structural date comparison in the TS core

**Files:**
- Create: `src/core/commands/opIds.ts`, `src/core/model/privacy.ts`
- Modify: `src/core/commands/{types,apply,people,relations}.ts`, `src/core/dates/fuzzy.ts`,
  `src/core/commands/people.ts:updateUnion`, `src/export/render/privacy.ts` (re-export only).
  Update callers: `src/ui/store/editorStore.ts:239`, `src/ui/app/TreeListPage.tsx:322`,
  `src/site/data.ts:17`, `src/site/sample/family.ts:149,168`,
  `tests/fixtures/arbitraries.ts:tryApply`.
- Test: `tests/core/commands/opIds.test.ts`, `tests/core/dates/fuzzy.test.ts` (extend)

**Interfaces:**
- Produces:
  - `type ApplyOptions = { now?: Date; opId?: string }`
  - `applyCommand(doc: TreeDocument, cmd: Command, opts?: ApplyOptions): CommandResult`
  - `HandlerContext = { created: string[]; newId: () => string }`
  - `opIdSource(opId: string): () => string`
  - `isOpId(value: string): boolean` (exactly 10 chars of `[A-Za-z0-9_-]`)
  - `sameFuzzyDate(a?: FuzzyDate, b?: FuzzyDate): boolean`
  - `applyPrivacy`, `isLivingPerson` exported from `@/core/model/privacy`

- [ ] **Step 1: Write the failing tests**

```ts
test("an opId gives the same ids on every run", () => {
  const doc = buildFamily([]); // one root person
  const cmd: Command = { type: "addSibling", personId: doc.rootPersonId!, sibling: { gender: "female" } };
  const a = applyCommand(doc, cmd, { now: STAMP, opId: "abcdefghij" });
  const b = applyCommand(doc, cmd, { now: STAMP, opId: "abcdefghij" });
  expect(a.createdIds).toEqual(["abcdefghijAA", "abcdefghijAB", "abcdefghijAC"]);
  expect(Object.keys(a.doc.unions)).toEqual(["abcdefghijAD"]);
  expect(a.doc).toEqual(b.doc);
});
test("opIdSource counts through 4096 ids and then throws", () => {
  const next = opIdSource("abcdefghij");
  const ids = Array.from({ length: 4096 }, next);
  expect(ids[63]).toBe("abcdefghijA_");
  expect(ids[64]).toBe("abcdefghijBA");
  expect(new Set(ids).size).toBe(4096);
  expect(next).toThrow();
});
test("applyCommand rejects a malformed opId", () => {
  expect(() => applyCommand(doc, cmd, { opId: "short" })).toThrow(CommandError);
});
test("now sets updatedAt", () => {
  expect(applyCommand(doc, renameCmd, { now: STAMP }).doc.updatedAt).toBe(STAMP.toISOString());
});
test("updateUnion with an equal start date in another key order keeps union order", () => {
  // partner with unions u1 (start 1990) and u2 (start {month:1, year:1990} written in reverse key order)
  // patch u2.start to {year:1990, month:1}: order must not change
});
test("sameFuzzyDate compares fields, not key order or undefined fields", () => {
  expect(sameFuzzyDate({ year: 1990, month: 1 }, { month: 1, year: 1990 })).toBe(true);
  expect(sameFuzzyDate({ year: 1990 }, { year: 1990, month: undefined })).toBe(true);
  expect(sameFuzzyDate({ year: 1990 }, undefined)).toBe(false);
  expect(sameFuzzyDate(undefined, undefined)).toBe(true);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test tests/core/commands/opIds.test.ts tests/core/dates/fuzzy.test.ts`. Expected:
FAIL (`opIdSource` not exported; `applyCommand` third argument is a `Date`).

- [ ] **Step 3: Implement**
  - `opIdSource` keeps a counter `n`. Each call returns `opId + ALPHABET[n >> 6] + ALPHABET[n & 63]`
    and throws `CommandError("INVALID")` after 4096 ids.
  - `applyCommand` builds `ctx.newId` from `opIdSource(opts.opId)` when `opts.opId` is given
    (validated with `isOpId`), otherwise from `newId`.
  - `buildPerson(input, id)` and `createUnion(doc, …, newId)` take the id or id source from
    the context. No handler imports `newId` any more.
  - `updateUnion` repositions only when `!sameFuzzyDate(oldStart, union.start)`, replacing the
    `JSON.stringify` comparison.
  - Move `applyPrivacy` and `isLivingPerson` to `src/core/model/privacy.ts`; the old file
    re-exports them.
  - Update every caller from `applyCommand(doc, cmd, date)` to `applyCommand(doc, cmd, { now: date })`.

- [ ] **Step 4: Run the full suite**

Run: `bun check && bun test`. Expected: PASS, including every existing command and property
test.

- [ ] **Step 5: Commit**

`git commit -m "feat(core): op-derived ids, injected clock and structural date comparison"`

### Task 2: Wire encoding, changes and revert in TypeScript

**Files:**
- Create: `src/sync/wire.ts`, `src/sync/changes.ts`, `src/sync/revert.ts`,
  `tests/fixtures/canonical.ts`
- Test: `tests/sync/wire.test.ts`, `tests/sync/changes.test.ts`, `tests/sync/revert.test.ts`

**Interfaces:**
- Consumes: `applyCommand`, `ApplyOptions` (Task 1).
- Produces:
  - `encodeCommand(cmd: Command): unknown`: a JSON-safe value. `undefined` inside
    `updatePerson.patch`, `updateUnion.patch`, `birth` and `death` becomes `null`; any other
    `undefined` is dropped.
  - `decodeCommand(raw: unknown): Command`: the reverse, plus shape checks with the same
    readers as `parseTree.ts`. Throws `CommandError("INVALID")`.
  - `type EntityKey = \`persons/${string}\` | \`unions/${string}\` | \`unionOrder/${string}\` | "tree/name" | "tree/rootPersonId"`
  - `type Changes = { persons: Record<string, Person | null>; unions: Record<string, Union | null>; unionOrder: Record<string, string[] | null>; tree: { name?: string; rootPersonId?: string | null; updatedAt: string } }`
  - `diffDocs(before: TreeDocument, after: TreeDocument): Changes`
  - `applyChanges(doc: TreeDocument, changes: Changes): TreeDocument`
  - `type EntityChange = { key: EntityKey; before: unknown | null; after: unknown | null }`
  - `entityChanges(changes: Changes, before: TreeDocument): EntityChange[]`
  - `applyRevert(doc: TreeDocument, entries: EntityChange[], direction: "undo" | "redo", now: Date): { doc: TreeDocument; changes: Changes }`
    - It throws `CommandError("CONFLICT", …, undefined, conflictKey)` when an entity no longer
      equals its expected value.
    - Add `"CONFLICT"` to `CommandErrorCode`, and an optional `key` field on `CommandError`.
  - Test helper `canonicalDoc(doc): string`: JSON in which `persons`, `unions` and `unionOrder`
    become arrays of `[id, value]` in map order, and every other object has sorted keys and no
    `undefined` values.

**Rules the tests pin:**
- **`diffDocs` order.** Iterate `after`'s keys in order, then `before`'s keys that are gone (as
  `null`).
- **What counts as a change.** An entity is changed when it is not the same reference *and* not
  deep-equal (`canonicalDoc`-style comparison). Immer can reassign an array with equal contents,
  and that must not count. `tree.updatedAt` is always present.
- **`applyChanges` order.** `null` deletes the key. An existing key is replaced in place. A new
  key is appended in the order it appears in `changes`.
- **Revert.**
  - Undo expects `after` and writes `before`; redo expects `before` and writes `after`.
  - Writing `null` deletes the key. Expected `null` means "must be absent".
  - The result must pass `validate`, otherwise `CommandError("INVALID")`.
  - `updatedAt` becomes `now`.

- [ ] **Step 1: Write the failing tests**

```ts
test("applyChanges(before, diffDocs(before, after)) equals after, map order included", () => {
  fc.assert(fc.property(fc.array(arbOp(ALL_KINDS), { maxLength: 40 }), arbOp(ALL_KINDS), (ops, last) => {
    const before = buildFamily(ops);
    const cmd = resolveOp(before, last);
    const result = cmd && tryApply(before, cmd);
    if (!result) return;
    expect(canonicalDoc(applyChanges(before, diffDocs(before, result.doc)))).toBe(canonicalDoc(result.doc));
  }), { numRuns: runs() });
});
test("an array reassigned with equal contents is not a change", () => { /* linkParent sets union.partners */ });
test("encode then decode returns the same command, removals included", () => {
  const cmd: Command = { type: "updatePerson", personId: "p1", patch: { nickname: undefined, firstName: "A" } };
  const wire = JSON.parse(JSON.stringify(encodeCommand(cmd)));
  expect(wire.patch).toEqual({ nickname: null, firstName: "A" });
  expect(applyCommand(doc, decodeCommand(wire), { now: STAMP }).doc).toEqual(applyCommand(doc, cmd, { now: STAMP }).doc);
});
test("decodeCommand refuses unknown types, bad ids and non-integer years", () => { /* each throws INVALID */ });
test("undo then redo through applyRevert returns the same document", () => { /* property over random ops */ });
test("undo is refused with CONFLICT when someone changed the entity since", () => { /* key reported */ });
test("undo of an add deletes the person; redo appends it again", () => {});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `bun test tests/sync`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the four modules to the rules above.**

- [ ] **Step 4: Run** `bun check && bun test tests/sync`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(sync): wire encoding, entity changes and revert"`

---

## Group B: Rust core and parity

### Task 3: Cargo workspace, model, strict tree parsing and validate in Rust

**Files:**
- Create: `Cargo.toml` (workspace: `server/stam-core`, `server/stam-room`,
  `server/stam-worker`, `resolver = "3"`, release profile `opt-level = "z"`, `lto = true`,
  `codegen-units = 1`, `panic = "abort"`)
- Create: `server/stam-core/{Cargo.toml,src/lib.rs,src/model.rs,src/parse.rs,src/validate.rs,src/dates.rs}`
- Create: `server/stam-core/tests/fixtures/*.json`: copy 5 trees from `tests/fixtures`
  (remarriage, adoption, cousin marriage, deep family, a GEDCOM import) as JSON documents
- Modify: `.gitignore` (`target/`, `.wasm/`, `.wrangler/`), `.oxlintrc.json` and
  `.prettierignore` (ignore `.wasm/`, `target/`)

**Interfaces:**
- Produces (Rust):
  - `pub struct TreeDocument { id, name, schema_version: u32, root_person_id: Option<String>, persons: IndexMap<String, Person>, unions: IndexMap<String, Union>, union_order: IndexMap<String, Vec<String>>, settings: Settings, created_at: String, updated_at: String }`
  - `Person`, `Union`, `ChildLink`, `FuzzyDate`, `Event`, enums `Gender`, `UnionStatus`,
    `ChildType`, `Qualifier`.
  - All use `#[serde(rename_all = "camelCase")]` and `skip_serializing_if = "Option::is_none"`.
    Enums use the TS string values. `partners: Vec<String>` (1–2, checked in parse).
    `FuzzyDate` numbers are `i32`.
  - `pub fn parse_tree_document(json: &str) -> Result<TreeDocument, ParseError>`: mirrors
    `parseTreeDocument`'s `readTree` for schema version 1 only (the client migrates before
    upload):
    - same id pattern;
    - whole-number checks;
    - drops unknown fields;
    - applies `withRoot`;
    - runs `validate`.
  - `pub fn validate(doc: &TreeDocument) -> Vec<Issue>` with
    `Issue { code: IssueCode, ids: Vec<String> }`. `IssueCode` serialises to the TS strings.
    Messages are not part of parity.
  - `pub fn compare_fuzzy_date(a: Option<&FuzzyDate>, b: Option<&FuzzyDate>) -> Ordering`
    and `pub fn same_fuzzy_date(...) -> bool`.
- Dependencies: `cargo add serde --features derive`,
  `cargo add serde_json --features preserve_order`, `cargo add indexmap --features serde`,
  `cargo add thiserror`.

- [ ] **Step 1: Write failing `cargo test`s**
  - Round trip: every fixture parses, and re-serialises to JSON equal to the input as parsed
    by `serde_json::Value`.
  - `validate` returns no issues on the fixtures.
  - Each `IssueCode` is produced by a hand-broken document: a dangling child, two biological
    unions, a cycle, an empty union, a bad root, a union-order mismatch, a duplicate child.
  - Parse refuses `schemaVersion: 2`, a non-integer year, a person whose id differs from its key,
    `partners: []`, and an id with `/`.
- [ ] **Step 2: Run** `cargo test -p stam-core`. Expected: FAIL (does not compile).
- [ ] **Step 3: Implement.** Port `validate.ts` line by line, including the iterative
  three-colour DFS and its iteration order (person keys in map order; each parent's child set in
  insertion order, so use `IndexSet`).
- [ ] **Step 4: Run** `cargo test -p stam-core && cargo clippy -p stam-core -- -D warnings && cargo fmt --check`.
  Expected: PASS.
- [ ] **Step 5: Commit**

`git commit -m "feat(server): Rust workspace with the tree model, strict parsing and validate"`

### Task 4: Commands, changes, revert and privacy in Rust

**Files:**
- Create: `server/stam-core/src/{tree.rs,ids.rs,changes.rs,revert.rs,privacy.rs}` and
  `server/stam-core/src/commands/{mod.rs,people.rs,relations.rs,relink.rs,remove.rs,valid_actions.rs,union_order.rs}`

**Interfaces:**
- Consumes: Task 3 types.
- Produces (Rust):
  - `pub enum Command` mirrors TS `Command`, using `#[serde(tag = "type", rename_all = "camelCase")]`.
    Patch fields are `Option<Option<T>>` with `serde_with::rust::double_option`: absent means no
    change, `null` means remove.
  - `pub fn apply_command(doc: &TreeDocument, cmd: &Command, now: &str, op_id: &str) -> Result<Applied, CommandError>`
  - `pub struct Applied { pub doc: TreeDocument, pub changes: Changes, pub created_ids: Vec<String> }`
  - `pub struct CommandError { pub code: ErrorCode, pub key: Option<String> }`, where
    `ErrorCode` is `NotFound | Cycle | AmbiguousUnion | ParentsFull | AlreadyLinked | Invalid | Conflict`
    serialised in TS `SCREAMING_SNAKE` form.
  - `pub struct Changes` with the same JSON shape as TS `Changes`.
  - `pub fn diff_docs(before: &TreeDocument, after: &TreeDocument) -> Changes`
  - `pub fn apply_changes(doc: &mut TreeDocument, changes: &Changes)`
  - `pub struct EntityChange { key: String, before: Option<Value>, after: Option<Value> }`
  - `pub fn apply_revert(doc: &TreeDocument, entries: &[EntityChange], direction: Direction, now: &str) -> Result<Applied, CommandError>`
  - `pub fn apply_privacy(doc: &TreeDocument) -> TreeDocument`, `pub fn is_living_person(p: &Person) -> bool`
  - `pub fn op_id_source(op_id: &str) -> Result<impl FnMut() -> Result<String, CommandError>, CommandError>`
  - `pub fn photo_owner(doc: &TreeDocument, photo_id: &str) -> Option<&Person>`
- Port rules:
  - Every handler is a line-by-line port of its TS file.
  - Queries (`unionsOf`, `parentUnionOf`, `isAncestor`, `descendantsOf`, …) live in `tree.rs`
    and keep the TS iteration order.
  - `reorderChild.toIndex` is an `f64`: non-finite (absent or `null`) gives `Invalid`, and
    `trunc` plus clamp work as in TS.
  - `assignPatch`'s required fields (`firstName`, `lastName`, `gender`, `isLiving`) ignore
    removal.
  - `updatePerson`'s placeholder-naming rule is ported exactly.
  - `apply_command` runs `validate` on the result and returns `Invalid` if it reports anything.

- [ ] **Step 1: Write failing `cargo test`s.** For each of the 16 command types, port the
  primary TS test cases from `tests/core/commands/*.test.ts` that assert outcomes (resulting
  links, root moves, error codes). Add:
  - the `op_id_source` sequence test from Task 1 (`AA`, `AB`, `A_` at 63, `BA` at 64, error
    after 4096);
  - `apply_changes(before, diff_docs(before, after)) == after` (map order included) on the
    fixtures with every command type;
  - revert undo/redo symmetry, and `Conflict` with the entity key;
  - privacy: a living person keeps only `id`, `firstName`, `lastName`, `nickname`,
    `nativeName`, `gender`, `isPlaceholder` and `isLiving`, matching TS `applyPrivacy`'s `names`
    rest; a union with a living partner loses `start` and `end`.
- [ ] **Step 2: Run** `cargo test -p stam-core`. Expected: FAIL.
- [ ] **Step 3: Implement the port.**
- [ ] **Step 4: Run** `cargo test -p stam-core && cargo clippy -p stam-core -- -D warnings`.
  Expected: PASS.
- [ ] **Step 5: Commit**

`git commit -m "feat(server): port the tree commands, changes, revert and privacy to Rust"`

### Task 5: WASM build and the parity suite (merge gate)

**Files:**
- Create: `server/stam-core/src/wasm.rs` (behind feature `wasm`), `tests/parity/core.test.ts`,
  `tests/parity/parse.test.ts`, `tests/parity/privacy.test.ts`, `tests/parity/wasm.ts`
  (loader)
- Modify: `package.json` scripts, `server/stam-core/Cargo.toml` (`crate-type = ["cdylib", "rlib"]`,
  optional `wasm-bindgen`)

**Interfaces:**
- Produces (WASM, all JSON strings in and out):
  - `apply_command_json(doc, cmd, now, opId) -> {"ok":{doc,changes,createdIds}} | {"err":{code,key?}}`
  - `apply_revert_json(doc, entries, direction, now)`
  - `parse_tree_json(text) -> {"ok":doc} | {"err":"INVALID_TREE"}`
  - `validate_json(doc) -> [{code, ids}]`
  - `apply_privacy_json(doc)`
- Produces (TS): `loadCore(): Promise<CoreWasm>` in `tests/parity/wasm.ts`. If `.wasm/stam-core`
  is missing it throws "run `bun run wasm` first".
- Scripts:
  - `"wasm": "wasm-pack build server/stam-core --target nodejs --out-dir ../../.wasm/stam-core --release -- --features wasm && wasm-pack build server/stam-room --target nodejs --out-dir ../../.wasm/stam-room --release -- --features wasm"`.
    The `stam-room` half is added in Task 7; until then the script builds core only.
  - `"test:parity": "bun run wasm && PROPERTY_RUNS=10000 bun test tests/parity"`
  - `"verify"` gains a `bun run wasm &&` prefix.
  - `"verify:server": "cargo fmt --check && cargo clippy --workspace -- -D warnings && cargo test --workspace"`
- Install: `cargo install wasm-pack` (once, on the dev machine; record it in `README.md`).

- [ ] **Step 1: Write the parity properties**

```ts
test("TS and Rust apply every command identically", async () => {
  const core = await loadCore();
  const opId = (i: number) => `op${String(i).padStart(8, "0")}`; // 10 chars, unique per step
  fc.assert(fc.property(fc.array(arbOp(ALL_KINDS), { maxLength: 60 }), (ops) => {
    let doc = buildFamily([]);
    for (const [i, op] of ops.entries()) {
      const cmd = resolveOp(doc, op);
      if (!cmd) continue;
      const wire = JSON.stringify(encodeCommand(cmd));
      const rust = JSON.parse(core.apply_command_json(JSON.stringify(doc), wire, STAMP_ISO, opId(i)));
      let ts;
      try { ts = applyCommand(doc, decodeCommand(JSON.parse(wire)), { now: STAMP, opId: opId(i) }); }
      catch (e) { expect(rust.err.code).toBe((e as CommandError).code); continue; }
      expect(rust.ok.createdIds).toEqual(ts.createdIds);
      expect(canonicalDoc(rust.ok.doc)).toBe(canonicalDoc(ts.doc));
      expect(rust.ok.changes).toEqual(JSON.parse(JSON.stringify(diffDocs(doc, ts.doc))));
      doc = ts.doc;
    }
  }), { numRuns: runs() });
});
```

Also add:
- `revert parity` (random undo and redo of random applied ops, including conflicts);
- `validate parity` (random documents with random corruptions: same set of issue codes);
- `parse parity` (fixtures accepted by both; random mutations of a valid document, such as a
  string year, a removed id, `partners: []` or an extra field, give the same accept or refuse
  outcome);
- `privacy parity` (`apply_privacy_json` equals TS `applyPrivacy` by `canonicalDoc`);
- `named fixtures parity`: replay each layout fixture's construction commands through both.

- [ ] **Step 2: Run** `bun run test:parity`. Expected: FAIL (no wasm module), then real
  mismatches, until Tasks 3–4 match exactly.
- [ ] **Step 3: Implement `wasm.rs`** as thin `#[wasm_bindgen]` wrappers.
- [ ] **Step 4: Run** `bun run test:parity`, `bun run verify`, `bun run verify:server`.
  Expected: PASS with 10,000 runs.
- [ ] **Step 5: Commit**

`git commit -m "test(parity): TS and Rust core agree on commands, revert, validate, parse and privacy"`

**→ Group review A+B** (Tasks 1–5): a fresh reviewer checks the TS core change, the Rust port and
the parity coverage against the spec §5.1–5.2.

---

## Group C: Room and sync engine

### Task 6: `RoomCore` in Rust

**Files:**
- Create: `server/stam-room/{Cargo.toml,src/lib.rs,src/protocol.rs,src/room.rs,src/store.rs,src/ratelimit.rs}`

**Interfaces:**
- Consumes: `stam_core::{apply_command, apply_revert, apply_changes, apply_privacy, diff_docs, photo_owner, TreeDocument, Changes}`.
- Produces:
  - Attachment: `pub struct Attachment { pub socket_id: String, pub role: Role, pub link_id: Option<String>, pub hide_living: bool, pub author: Author }`
    - `Role` is `Owner | View | Comment | Edit`.
    - `Author { kind: AuthorKind, id: String, name: String }`, with `AuthorKind` `Owner | Link`.
  - `pub trait RoomStore` (synchronous; Durable Object SQL is synchronous):
    - `fn load(&self) -> Option<Snapshot>`
    - `fn ops_after(&self, version: u64, limit: u32) -> Vec<StoredOp>`
    - `fn find_op(&self, op_id: &str) -> Option<StoredOp>`
    - `fn append_op(&mut self, op: &StoredOp)`
    - `fn write_snapshot(&mut self, doc_json: &str, version: u64)`
    - `fn write_checkpoint(&mut self, version: u64, doc_json: &str)`
    - `fn wipe(&mut self)`
  - `Snapshot { doc_json, doc_version, version }`.
  - `StoredOp { version, op_id, author: Author, kind: OpKind, payload_json, changes_json, at }`,
    with `OpKind` `Upload | Cmd | Revert`.
  - `pub struct MemoryStore` implements `RoomStore` (for tests and WASM).
  - `pub struct RoomCore<S: RoomStore>`:
    - `fn create(store: S, doc: TreeDocument, author: Author, now: &str) -> Self`
      writes version 0 (an `Upload` op), the snapshot and checkpoint 0.
    - `fn open(store: S) -> Result<Self, RoomError>` loads the snapshot and applies the stored
      `changes` after `doc_version`.
    - `fn on_message(&mut self, att: &Attachment, text: &str, now: &str, now_ms: f64) -> Outbox`
    - `fn photo_access(&self, att: &Attachment, photo_id: &str) -> PhotoAccess`, where
      `PhotoAccess` is `Allowed | NotFound`.
    - `fn flush_due(&self, now_ms: f64) -> bool`, `fn flush(&mut self)`,
      `fn people_count(&self) -> usize`, `fn version(&self) -> u64`
  - `pub struct Outbox { pub reply: Vec<String>, pub broadcast: Option<Broadcast>, pub close_self: Option<(u16, String)> }`
  - `pub struct Broadcast { pub full: String, pub redacted: String }`: the adapter sends
    `redacted` to `hide_living` sockets and `full` to all others.
- Messages (P1 subset; JSON `{"type": …}`):
  - C→S `hello {lastVersion?}`, `op {opId, cmd}`, `revert {opId, entries, direction}`.
  - S→C `welcome {role, hideLiving, version, doc?, ops?}`, `applied {version, opId, author: {kind, name}, changes}`,
    `rejected {opId, code, key?}`, `busy {retryAfter}`.
- Rules:
  - **Welcome.**
    - Sends `ops` (each `{version, opId, author, changes}`) when `lastVersion` is set,
      `0 ≤ version - lastVersion ≤ 1000` and the socket is not `hide_living`. Otherwise it
      sends `doc`.
    - `hide_living` sockets always get `doc = apply_privacy(doc)`.
  - **`op` and `revert`:**
    - Allowed only for `Owner` and `Edit`. Any other role gets `rejected {code: "FORBIDDEN"}`.
    - A known `opId` replies with the stored `applied` (only to the sender) and changes
      nothing.
    - People over 5,000 after the op: `rejected {code: "TOO_LARGE"}`.
  - **Rate limit:** an in-memory token bucket per `socket_id` (30 per second, burst 60). When
    empty the reply is `busy {retryAfter: 1}`.
  - **Redacted broadcast.** The touched persons and unions, plus every union whose partner is a
    touched person, are recomputed from `apply_privacy(new doc)` and diffed against the room's
    cached redacted copy. The result must equal
    `diff_docs(apply_privacy(old), apply_privacy(new))` (a test pins this).
  - **Persistence:**
    - Every op is appended.
    - The snapshot is rewritten every 50 versions, or when `flush()` runs (the adapter calls it
      from a 30-second alarm).
    - A checkpoint is written every 500 versions.
  - **Malformed JSON or an unknown type** gives `rejected {code: "BAD_MESSAGE"}`.
  - **`photo_access`:** `NotFound` when no person has the photo, or the socket is `hide_living`
    and the owner is living.

- [ ] **Step 1: Write failing `cargo test`s**, one per rule:
  - `viewer_op_is_forbidden`
  - `resent_op_is_answered_once_and_not_reapplied`
  - `welcome_sends_ops_within_1000_else_doc`
  - `hide_living_welcome_is_redacted`
  - `redacted_broadcast_equals_full_privacy_diff` (proptest over random op streams)
  - `snapshot_every_50_and_checkpoint_every_500`
  - `open_replays_ops_after_snapshot`
  - `too_large_is_rejected`
  - `rate_limit_returns_busy`
  - `photo_of_living_person_hidden_from_hide_living`
  - `bad_message_rejected`
- [ ] **Step 2: Run** `cargo test -p stam-room`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run verify:server`. Expected: PASS.
- [ ] **Step 5: Commit**

`git commit -m "feat(server): RoomCore orders, logs and broadcasts tree edits by role"`

### Task 7: Protocol types, `SyncClient` and the convergence suite

**Files:**
- Create: `src/sync/protocol.ts`, `src/sync/syncClient.ts`, `server/stam-room/src/wasm.rs`
  (feature `wasm`: `RoomHarness`), `tests/sync/syncClient.test.ts`,
  `tests/sync/convergence.test.ts`, `tests/sync/protocol.test.ts`
- Modify: `package.json` (`wasm` script builds stam-room too)

**Interfaces:**
- Consumes: Task 2 (`encodeCommand`, `applyChanges`, `diffDocs`, `entityChanges`,
  `applyRevert`), Task 6 messages.
- Produces (TS):
  - `src/sync/protocol.ts`: `ClientMessage` and `ServerMessage` unions matching Task 6
    exactly, plus `parseServerMessage(text: string): ServerMessage` (throws on an unknown
    `type`).
  - `class SyncClient`:
    - `constructor(opts: { send: (msg: ClientMessage) => void; onView: (doc: TreeDocument, cause: "local" | "remote") => void; onDropped: (dropped: { cmd: Command; code: string }[]) => void; now?: () => Date; newOpId?: () => string })`
    - `start(confirmed: TreeDocument, version: number): void`
    - `get view(): TreeDocument`, `get version(): number`, `get pendingCount(): number`
    - `submit(cmd: Command): CommandResult & { entities: EntityChange[] }`: throws
      `CommandError` like `applyCommand`.
    - `submitRevert(entries: EntityChange[], direction: "undo" | "redo"): void`: throws
      `CommandError("CONFLICT")` locally first.
    - `receive(msg: ServerMessage): void`
    - `connected(): void` sends `hello {lastVersion}` and then every pending op in order;
      `disconnected(): void`.
  - `SyncClient` follows spec §5.4. On `welcome` with `doc` it replaces `confirmed`; with
    `ops` it applies their changes. Either way it then re-runs `pending`.
- Produces (WASM): `RoomHarness`:
  - `new(doc_json, now)`
  - `connect(attachment_json) -> socket_id`
  - `message(socket_id, text, now, now_ms) -> JSON [{to: socket_id, text}]`, with the
    broadcast already fanned out to the harness's sockets by `hide_living`.

- [ ] **Step 1: Write the failing tests**
  - `syncClient.test.ts`:
    - `local submit shows at once and stays pending until applied`
    - `remote applied rebases pending on top`
    - `a pending op that no longer applies is dropped and reported`
    - `rejected drops the op`
    - `reconnect resends pending after hello`
    - `revert conflict is raised locally before sending`
  - `protocol.test.ts`, through `RoomHarness`:
    - every client message type gets the expected server message type;
    - the viewer's `op` gets `FORBIDDEN`;
    - `parseServerMessage` accepts every message the room emits.
  - `convergence.test.ts`, property test with fast-check:

```ts
test("2–5 clients with random edits, delays and disconnects converge on a valid tree", async () => {
  const room = await loadRoom();
  fc.assert(fc.property(arbSchedule /* clients 2..5, steps: submit|undo|redo|deliver(i)|drop-connection(c)|reconnect(c) */, (schedule) => {
    const sim = new Simulation(room, schedule);      // in-test: per-client inbound queues
    sim.run();
    sim.deliverAll();
    const server = sim.serverDoc();
    expect(validate(server)).toEqual([]);
    for (const c of sim.clients) expect(canonicalDoc(c.view)).toBe(canonicalDoc(server));
    for (const c of sim.clients) expect(c.pendingCount).toBe(0);
  }), { numRuns: runs() });
});
test("a hide-living viewer never receives a living person's details", () => { /* scan every message text */ });
```

- [ ] **Step 2: Run** `bun run wasm && bun test tests/sync`. Expected: FAIL.
- [ ] **Step 3: Implement** `protocol.ts`, `SyncClient` and `RoomHarness`.
- [ ] **Step 4: Run** `bun run verify && bun run verify:server`. Expected: PASS.
- [ ] **Step 5: Commit**

`git commit -m "feat(sync): SyncClient with rebase and revert, converging against the Rust room"`

**→ Group review C** (Tasks 6–7) against spec §4.2, §5.3–5.5 and §6.

---

## Group D: The Worker

### Task 8: Worker scaffold, asset routing, security headers, D1 schema and the local harness

**Files:**
- Create: `server/stam-worker/{Cargo.toml,src/lib.rs,src/routes.rs,src/headers.rs,src/db.rs}`,
  `server/migrations/0001_init.sql`, `wrangler.jsonc`, `scripts/test-worker.ts`,
  `tests/worker/assets.test.ts`, `tests/worker/helpers.ts`
- Modify: `package.json`, `public/_redirects` (remove the `/app` rules; the Worker serves
  them), `src/server.ts` (dev proxy), `.dev.vars.example`

**Interfaces:**
- `wrangler.jsonc`:
  - `main = "build/index.js"`, `build.command = "cargo install -q worker-build && worker-build --release server/stam-worker"`.
  - `assets: { directory: "./dist", binding: "ASSETS", run_worker_first: ["/api/*", "/app", "/app/*", "/s/*"] }`.
    Check the current Cloudflare docs for the `run_worker_first` array form when implementing.
  - `d1_databases: [{ binding: "DB", database_name: "stam", migrations_dir: "server/migrations" }]`.
  - `r2_buckets: [{ binding: "PHOTOS", bucket_name: "stam-photos" }]`.
  - `durable_objects.bindings: [{ name: "TREE_ROOM", class_name: "TreeRoom" }]`,
    `migrations: [{ tag: "v1", new_sqlite_classes: ["TreeRoom"] }]`.
  - `routes: [{ pattern: "stam.mirzalabs.in", custom_domain: true }]`.
- `0001_init.sql` creates the spec §4.1 tables:
  - `share_link` adds `token_cipher TEXT NOT NULL` (deviation 3).
  - Indexes: `share_link(token_hash)` unique, `share_link(tree_id)`, `tree(owner_id)`,
    `session(user_id)`.
- Routing:
  - `/app`, `/app/*` and `/s/*` serve `ASSETS` `/app.html` with `security_headers()`.
  - `/api/health` → `{ok: true}`.
  - Any other unknown `/api/*` → 404 JSON `{error: "NOT_FOUND"}`.
- `headers.rs` exposes `security_headers()`. It copies `public/_headers` exactly, except
  `connect-src 'self' wss://stam.mirzalabs.in` (plus `ws://localhost:8787` when
  `ENVIRONMENT=dev`).
- `src/server.ts` (dev only) proxies `"/api/*"` HTTP to `process.env.API_ORIGIN ?? "http://localhost:8787"`.
  The client opens WebSockets on `wsOrigin()` (Task 11), which in dev is `ws://localhost:8787`.
  Cookies are per host, not port, so the session works across both ports.
- Scripts:
  - `"dev:worker": "bun run build && wrangler d1 migrations apply stam --local && wrangler dev --port 8787"`
  - `"test:worker": "bun run scripts/test-worker.ts"`. The script builds, applies local
    migrations, starts `wrangler dev --port 8788` with test vars (`GOOGLE_*_URL` pointing at
    its mock), waits for `/api/health`, runs `WORKER_URL=http://localhost:8788 bun test tests/worker`,
    then stops wrangler.
  - `verify:server` gains `&& bun run test:worker`.
- `tests/worker/*` use `describe.skipIf(!process.env.WORKER_URL)`.

- [ ] **Step 1: Write the failing tests:**
  - `/app/t/abc serves the app with the CSP`
  - `/s/token serves the app`
  - `/ serves the prerendered landing page`
  - `/api/nope is a JSON 404`
  - `/api/health is ok`
- [ ] **Step 2: Run** `bun run test:worker`. Expected: FAIL.
- [ ] **Step 3: Implement.** `cargo add worker --features http,d1`, `cargo add axum --no-default-features`
  (with whatever features the workers-rs axum example uses), `cargo add tower-service`.
- [ ] **Step 4: Run** `bun run test:worker && bun run verify:server`. Expected: PASS.
- [ ] **Step 5: Commit**

`git commit -m "feat(server): Worker serving the site and API with D1 schema and local test harness"`

### Task 9: Google sign-in and sessions

**Files:**
- Create: `server/stam-worker/src/{auth.rs,crypto.rs}`, `scripts/google-mock.ts` (used by
  `test-worker.ts`), `tests/worker/auth.test.ts`

**Interfaces:**
- Routes (spec §7.1):
  - `GET /api/auth/google?return=`
  - `GET /api/auth/google/callback`
  - `POST /api/auth/signout`
  - `GET /api/me` → `{user: {id, name, email}, trees: [{id, name, createdAt}]}` or 401
    `{error: "SIGNED_OUT"}`.
- `crypto.rs`:
  - `random_token() -> String` (32 bytes, base64url, `getrandom` with the `wasm_js` backend)
  - `sha256_b64(s) -> String`
  - `sign(value, secret) -> String`, `verify(signed, secret) -> Option<String>` (HMAC-SHA256)
  - `pkce_pair() -> (verifier, challenge)`
  - `encrypt(plain, key) -> String`, `decrypt(cipher, key) -> Option<String>` (AES-256-GCM,
    random 12-byte nonce prefixed)
- `auth.rs`:
  - `current_user(req, env) -> Option<User>`: reads `stam_session`, looks up its hash, checks
    `expires_at`, and slides the expiry when less than 15 days remain.
  - `require_same_origin(req)`: for every non-GET `/api` route, requires `Origin` equal to
    `env.SITE_ORIGIN` and `Content-Type: application/json` (except signout, which takes an
    empty body).
- Env:
  - Vars: `SITE_ORIGIN`, `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_USERINFO_URL`
    (Google's real URLs in production; mock URLs in tests), `ENVIRONMENT`.
  - Secrets: `SESSION_SECRET`, `LINK_KEY` (32 bytes base64), `GOOGLE_CLIENT_ID`,
    `GOOGLE_CLIENT_SECRET`.
  - `.dev.vars.example` lists them.
- Cookies:
  - `stam_oauth` (signed, 10 minutes, `HttpOnly`, `Secure` unless dev, `SameSite=Lax`,
    `Path=/api/auth`).
  - `stam_session` (30 days, `HttpOnly`, `Secure` unless dev, `SameSite=Lax`, `Path=/`).

- [ ] **Step 1: Write the failing tests:**
  - `sign-in redirects to Google with state and S256 challenge`
  - `callback with matching state creates user and session`
  - `callback with wrong or missing state is 400 and sets no session`
  - `return only accepts same-origin paths`: `//evil.com` and `https://evil.com` fall back to
    `/app`
  - `/api/me without a cookie is 401`
  - `expired session is 401`
  - `signout deletes the session`
  - `POST without Origin is 403`
  - `the second sign-in with the same Google sub reuses the user`
- [ ] **Step 2: Run** `bun run test:worker`. Expected: FAIL.
- [ ] **Step 3: Implement.** The token exchange and userinfo calls use `worker::Fetch`. The
  Google userinfo `sub` is the identity.
- [ ] **Step 4: Run** `bun run test:worker && bun run verify:server`. Expected: PASS.
- [ ] **Step 5: Commit**

`git commit -m "feat(server): Google sign-in with PKCE and hashed sliding sessions"`

### Task 10: Trees, view links, the `TreeRoom` Durable Object, WebSockets and photos

**Files:**
- Create: `server/stam-worker/src/room_do.rs`, `tests/worker/trees.test.ts`,
  `tests/worker/room.test.ts`, `tests/worker/photos.test.ts`
- Modify: `routes.rs`, `db.rs`

**Interfaces:**
- Routes (spec §7.2):
  - `POST /api/trees`
  - `DELETE /api/trees/:id`
  - `GET|POST /api/trees/:id/links`, `DELETE /api/trees/:id/links/:linkId`
  - `GET /api/s/:token`
  - `GET /api/trees/:id/ws`
  - `PUT|GET /api/trees/:id/photos/:photoId`
- **`POST /api/trees` `{doc}`:**
  - `stam_core::parse_tree_document`; more than 5,000 people → 413 `TOO_LARGE`.
  - The id is owned by another user (or soft-deleted by them) → 409 `TREE_ID_TAKEN`. Owned by
    the same user and not deleted → 409 `ALREADY_SHARED`.
  - Otherwise insert the `tree` row, call the room's `/init` and answer 201 `{id, version: 0}`.
- **`POST /links` `{role, hideLiving?}`:**
  - P1 accepts only `role: "view"`; others → 400 `NOT_AVAILABLE`.
  - An active link of that role is revoked and replaced.
  - Returns `{id, role, hideLiving, url, createdAt}`.
- **`GET /links`** returns the active links with `url` (decrypted from `token_cipher`).
- **`DELETE /links/:linkId`** sets `revoked_at` and calls the room's `/close-link`.
- **`GET /api/s/:token`** → `{treeId, role, hideLiving, name}`; 404 `{error: "LINK_OFF"}` when
  the link is unknown or revoked, or the tree is deleted.
- **`GET /ws`:**
  - The owner is identified by session; a link user by `?t=`.
  - The Worker builds the `Attachment` (owner: `author = {kind: owner, id: user.id, name: user.name}`;
    view link: `author = {kind: link, id: "", name: ""}`).
  - It forwards to the DO as a new request to `https://room/ws` with header `X-Stam-Attachment`.
    No client headers are forwarded.
- **`TreeRoom`** (`#[durable_object]`):
  - A `SqlStore` implements `RoomStore` over `state.storage().sql()`; its tables are created on
    construction.
  - `RoomCore` is opened lazily on first use.
  - `/init` creates the room; `/ws` accepts a hibernatable socket with the attachment
    serialised.
  - `websocket_message` → `on_message` → reply, plus a fan-out over `state.get_websockets()` by
    attachment `hide_living`.
  - After an op, set the alarm to +30 s if none is set; `alarm()` → `flush()`.
  - `/close-link {linkId}` closes matching sockets with 4401.
  - `/destroy` closes every socket with 4404, wipes the store and deletes `photos/<treeId>/*`
    from R2.
  - `/photo/:id` GET/PUT run `photo_access` and the R2 calls. PUT is allowed for `Owner` and
    `Edit` and requires ≤ 300 KB and the WebP magic bytes `RIFF????WEBP`.
- **Photos response:** `GET` → 200 `image/webp` with `Cache-Control: private, max-age=31536000, immutable`,
  or 404.

- [ ] **Step 1: Write the failing tests:**
  - `trees.test.ts`:
    - `upload creates the tree and lists it in /api/me`
    - `upload over 5000 people is 413`
    - `upload with an id owned by another user is 409 TREE_ID_TAKEN`
    - `upload of an invalid tree is 400`
    - `only the owner can create, list and delete links`
    - `reset revokes the old view link`
    - `the link url can be copied again later`
    - `comment and edit roles are not available yet`
    - `deleted tree resolves as LINK_OFF`
  - `room.test.ts`, using `WebSocket` from Bun:
    - `owner op is broadcast to a viewer`
    - `hide-living viewer gets redacted welcome and changes`
    - `viewer op is FORBIDDEN`
    - `revoked link closes and refuses reconnect` (close code 4401, then `/api/s` 404)
    - `delete closes sockets with 4404`
    - `room survives restart: reconnect with lastVersion gets the missing ops` (restart
      `wrangler dev` inside the test helper)
  - `photos.test.ts`:
    - `owner uploads and viewer downloads a photo`
    - `non-WebP or over 300 KB is refused`
    - `living person's photo is 404 for hide-living links`
    - `viewer cannot upload`
- [ ] **Step 2: Run** `bun run test:worker`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test:worker && bun run verify:server`. Expected: PASS.
- [ ] **Step 5: Commit**

`git commit -m "feat(server): shared trees, view links and live TreeRoom with photos"`

**→ Group review D** (Tasks 8–10), with a security focus: OAuth, cookies, CSRF, token handling,
role checks, header forwarding, photo access.

---

## Group E: The client

### Task 11: Cloud API, auth state and live editing in the editor store

**Files:**
- Create: `src/cloud/api.ts`, `src/cloud/auth.ts`, `src/cloud/transport.ts`,
  `src/cloud/cloudSession.ts`, `src/cloud/linkTrees.ts`, `tests/cloud/*.test.ts`
- Modify:
  - `src/storage/treeRepo.ts`: `TreeMeta.cloud`; `setCloud(treeId, cloud | null)`;
    `listTrees` returns it.
  - `src/ui/store/editorStore.ts`: an optional `cloud` dependency.
  - `src/core/commands/history.ts`: `HistoryEntry.entities?`; `peek(move)` and `shift(move)`.
  - `src/ui/app/EditorPage.tsx`: create the cloud session for cloud trees; skip the guard and
    journal for them.

**Interfaces:**
- Consumes: `SyncClient` (Task 7); the HTTP routes from Tasks 9–10.
- Produces:
  - `type CloudMeta = { role: "owner" | "view"; token?: string; hideLiving?: boolean; version: number }`.
    `TreeMeta.cloud?: CloudMeta`. Stored in the existing `meta` store; no IndexedDB version
    bump.
  - `api.ts`, each function throwing `ApiError { status, code }`:
    - `getMe(): Promise<Me | null>` (null on 401)
    - `uploadTree(doc): Promise<{id: string; version: number}>`
    - `deleteCloudTree(id)`
    - `listLinks(id)`, `createLink(id, {role: "view", hideLiving})`, `deleteLink(id, linkId)`
    - `resolveLink(token)`
    - `uploadPhoto(treeId, photoId, blob)`
    - `signInUrl(returnPath): string`
    - `signOut()`
  - `auth.ts`: a zustand store `authStore` with
    `{status: "unknown" | "signedOut" | "signedIn"; me: Me | null; refresh(): Promise<void>}`.
    Any `ApiError` with status 401 sets `signedOut`.
  - `transport.ts`: `connectRoom(treeId, token?: string, handlers): RoomConnection`.
    - `wsOrigin()` is `ws://localhost:8787` in dev (`process.env.NODE_ENV !== "production"`),
      otherwise the page origin with `wss:`.
    - Reconnects with exponential backoff and jitter (1 s → 30 s). A close with 4401 or 4404
      does not reconnect; it calls `handlers.onClosed(code)`.
  - `cloudSession.ts`: `createCloudSession({treeId, meta, repo, onView, onClosed, onStatus}): CloudSession`.
    - Wraps `SyncClient` and the transport.
    - `status` is `"live" | "connecting" | "offline"`, along with `pendingCount`.
    - Persists `view` to the repo through the existing autosaver (cache) and stores
      `cloud.version`.
    - `onClosed(4401|4404)` for a link tree deletes the cached tree and its meta.
  - `linkTrees.ts`: `openLink(token, repo): Promise<{treeId: string}>`. It resolves the link,
    connects once to receive `welcome.doc`, saves the doc as a local tree with
    `cloud = {role, token, hideLiving, version}`, and returns the id.
  - `openOwnedTree(treeId, repo): Promise<void>`: the same for an owner's cloud tree that is not
    on this device (the "In your account" section). It connects with the session and stores
    `cloud = {role: "owner", version}`.
  - `uploadAndShare(doc, repo, photos)`:
    - On 409 `TREE_ID_TAKEN`, `repo.duplicateTree(id, name)` under a new id, deletes the old
      local copy, then uploads the copy.
    - Uploads photos and returns `{treeId, failedPhotos: string[]}`.
  - Editor store with `cloud`:
    - `run` uses `cloud.submit(cmd)` (same `CommandError` handling).
    - `record` stores `entities` on the history entry.
    - `step(move)` uses `history.peek(move)`, then `cloud.submitRevert(entry.entities, move)`.
      On `CONFLICT` it sets `error: "CONFLICT"` and leaves the stacks as they are; otherwise it
      calls `history.shift(move)`.
    - Remote `onView` installs the doc without touching history.
    - `role: "view"` makes every edit action a no-op (like `locked`, but no banner).

- [ ] **Step 1: Write the failing tests** (`tests/cloud/*`, with a fake transport and a fake
  `fetch`):
  - `cloud trees never lock on a second tab's cache write`
  - `upload retries under a new id after TREE_ID_TAKEN`
  - `4401 deletes the cached link tree`
  - `session loss keeps pending edits` (401 → `signedOut`, `pendingCount` unchanged, resent
    after reconnect)
  - `remote edits re-lay out without adding undo steps`
  - `undo of own edit sends revert; conflict shows CONFLICT and keeps the stack`
  - `view role ignores dispatch, undo and redo`
  - `reconnect backoff stays between 1 and 30 seconds and stops on 4404`
  - `openLink stores the tree with its link meta`
  - `openOwnedTree caches an account tree with owner meta`
  - `a 401 at reconnect reports signedOut and stops retrying until sign-in`
- [ ] **Step 2: Run** `bun test tests/cloud`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run verify`. Expected: PASS (the v1 editor tests unchanged).
- [ ] **Step 5: Commit**

`git commit -m "feat(cloud): sign-in state, upload, link trees and live editing in the editor"`

### Task 12: Share dialog, link page, tree list sections, toolbar status and copy

**Files:**
- Create: `src/ui/share/ShareDialog.tsx`, `src/ui/share/share.css`, `src/ui/app/LinkPage.tsx`,
  `src/ui/app/CloudStatus.tsx`, `tests/ui/share/*.test.tsx`, `tests/ui/app/linkPage.test.tsx`
- Modify: `src/ui/app/{Toolbar,TreeListPage,TreeCard,AppRoutes,EditorPage}.tsx`,
  `src/i18n/locales/{en,ur,ar}.json`, `public/_headers` (`connect-src`),
  `src/site/content.ts` (privacy copy), `src/ui/app/MoreMenu.tsx`

**Interfaces:**
- Consumes: Task 11 (`authStore`, `api`, `uploadAndShare`, `openLink`, `CloudSession` status).
- UI (spec §9, P1 subset):
  - **Toolbar** `Share` button: `IconButton` with a share icon and a `Tip`. Hidden for
    `role: "view"`.
  - **ShareDialog**, built from `Sheet`/`Dialog` and `Button`/`Segmented`:
    - **Signed out:** text `share.signInLead` and a "Sign in with Google" button
      (`location.assign(signInUrl(currentPath + "?share=1"))`). On return, `?share=1` reopens
      the dialog.
    - **Signed in, local tree:** `share.uploadLead` ("This uploads the tree and its photos to
      Stam's server so the people you share with can see it."). An "Upload and share" button
      shows progress, then `failedPhotos` with Retry.
    - **Shared:**
      - A **View** row: *Create link* / *Copy* (`navigator.clipboard.writeText`, with a
        "Copied" chip) / *Reset* / *Turn off*, plus the "Hide living people's details" switch.
        Changing the switch resets the link, after a confirm explaining that the old link stops
        working.
      - **Comment** and **Edit** rows shown disabled with "Coming soon".
      - Danger zone: "Stop sharing and delete cloud copy" with a confirm.
  - **LinkPage**, route `/s/:token`:
    - Spinner, then `openLink`, then `navigate("/app/t/" + id, {replace: true})`.
    - On `LINK_OFF`: "This link was turned off or doesn't exist".
    - Offline: "Connect to the internet to open this link".
  - **TreeListPage** sections:
    - "My trees": local and owned cloud trees, with a "Shared" chip on owned cloud trees.
    - "Shared with me": `cloud.role === "view"`, with a "Can view" chip. Its delete action reads
      "Remove from this device".
    - "In your account": shown when signed in; cloud trees from `/api/me` not on this device,
      each with "Open", which fetches through the owner's `/ws` welcome into a local cache.
    - Account menu: the signed-in name and "Sign out".
  - **CloudStatus** in the toolbar: a role chip ("Can view") for link trees and a connection
    state ("Live" / "Reconnecting" / "Offline, N changes waiting"). The connection state uses
    `aria-live="polite"`.
  - **Copy:**
    - `public/_headers` `connect-src 'self' wss://stam.mirzalabs.in`.
    - Landing privacy facts and `/privacy`: "Local by default. Nothing leaves your device unless
      you share a tree." plus a paragraph on what sharing uploads (tree, photos, link names) and
      that deleting the cloud copy removes it. Remove the "no account, no server" absolutes.
    - Every new string goes in `en`, `ur` and `ar`. The Urdu and Arabic strings are flagged for
      the native-speaker review already open in project status.

- [ ] **Step 1: Write the failing tests:**
  - `signed-out share dialog offers Google sign-in with return to the same tree`
  - `upload shows progress then the link rows`
  - `photo upload failures are reported and retried`
  - `copy writes the link url`
  - `hide living toggle resets the link after confirm`
  - `turn off removes the link`
  - `link page opens the tree and replaces history`
  - `link page shows LINK_OFF message`
  - `tree list groups mine, shared with me and in your account`
  - `view role hides share button, add handles and drag`
  - `locales have every new key in en, ur and ar` (the existing locales test covers this once
    keys exist)
- [ ] **Step 2: Run** `bun test tests/ui/share tests/ui/app`. Expected: FAIL.
- [ ] **Step 3: Implement**, following `DESIGN-APP.md` tokens and the shared components in
  `src/ui/design`.
- [ ] **Step 4: Run** `bun run verify && bun run build`. Expected: PASS, with the `/app` bundle
  within its budget. If the budget fails, lazy-load `ShareDialog`, and `src/cloud` behind it,
  with `import()`.
- [ ] **Step 5: Commit**

`git commit -m "feat(ui): share dialog, link page, shared tree list and live status"`

**→ Group review E** (Tasks 11–12) against spec §4.4, §5.4, §9.

---

## Group F: Ship

### Task 13: Measurements, end-to-end test, deploy setup and spec update

**Files:**
- Create: `scripts/wasm-size.ts`, `scripts/bench-room.ts`, `e2e/sharing.spec.ts`,
  `docs/deploy.md`
- Modify: `package.json` (`"deploy": "bun run build && wrangler d1 migrations apply stam --remote && wrangler deploy"`),
  `e2e/playwright.config.ts` (a `sharing` project with `webServer` = `bun run dev:worker` on
  port 8788 and the Google mock), the spec, the project status memory, `README.md`

**Interfaces:**
- `wasm-size.ts`: builds the Worker in release and prints the gzip size of `build/` WASM plus JS.
  It fails above 3,000,000 bytes (free plan) and warns above 2,500,000.
- `bench-room.ts` uses the `stam-room` WASM in Bun, on `bigFamily(5000)`. It measures:
  - cold `RoomCore::open` (snapshot plus 49 ops);
  - one `addChild`;
  - one redacted broadcast.

  It prints the median of 50 runs. Budget: each under 5 ms, half the free plan's 10 ms CPU, as
  a proxy for production. On failure, record the numbers and recommend Workers Paid in
  `docs/deploy.md`; nothing else changes.
- `e2e/sharing.spec.ts` (Chromium only), with two browser contexts:
  1. The owner signs in through the Google mock and creates a 3-person tree.
  2. Share: upload, create a view link with "Hide living people's details" on, and copy it.
  3. The viewer opens the link and sees the tree read-only, with no add handles. A living
     person's birth year is not shown.
  4. The owner adds a child; the viewer sees the new card within 2 s.
  5. The owner turns the link off; the viewer sees "This link was turned off by the owner".
  6. Axe check on the share dialog.
- `docs/deploy.md`, the owner's one-time setup:
  - `wrangler d1 create stam`
  - `wrangler r2 bucket create stam-photos`
  - the Google OAuth client, with the redirect URI `https://stam.mirzalabs.in/api/auth/google/callback`
  - `wrangler secret put` for each secret
  - an R2 lifecycle rule is not needed in P1
  - the custom domain, and removing the old Pages project
  - after the first deploy: check the Workers dashboard for CPU time per request against the
    10 ms limit

- [ ] **Step 1: Write** `e2e/sharing.spec.ts`. **Run**
  `bunx playwright test -c e2e/playwright.config.ts --project=sharing`. Expected: FAIL first if
  wiring is missing, then PASS.
- [ ] **Step 2: Run** `bun run scripts/wasm-size.ts` and `bun run scripts/bench-room.ts`.
  Record both results in `docs/deploy.md`.
- [ ] **Step 3: Update the spec.**
  - Add deviations 1–4 at the top of `docs/superpowers/specs/2026-10-24-stam-sharing-design.md`.
  - Move `SyncClient` and revert into P1 in §12.
  - Drop `ts-rs` from §3.1 and §5.3.
  - Add `token_cipher` to §4.1.
- [ ] **Step 4: Run all merge checks**
  - `bun run verify && bun run verify:server && bun run build`. Expected: PASS.
  - Clean up worktrees, branches, `test-results/`, `.wrangler/state` from tests and scratch
    files.
- [ ] **Step 5: Commit**

`git commit -m "chore(sharing): measurements, sharing E2E, deploy guide and spec update"`

**→ Final review:** the whole branch against the spec, then squash into one commit per area.
Do not push or deploy; the owner deploys with `docs/deploy.md`.
