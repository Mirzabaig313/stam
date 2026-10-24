//! The `TreeRoom` Durable Object: one per shared tree (spec §3). It adapts `RoomCore` to the
//! object's SQLite storage, hibernating WebSockets (who is on a socket lives in its attachment)
//! and alarms, and serves the tree's photos from R2. Storage errors never panic: the room
//! answers `busy` (or 503) and clients keep their edits queued.

use std::cell::RefCell;

use serde::Deserialize;
use serde_json::{Value, json};
use stam_core::{TreeDocument, photo_owner};
use stam_room::{
    Attachment, Author, PhotoAccess, RoomCore, RoomError, RoomStore, Snapshot, StoreError,
    StoreResult, StoredOp,
};
use worker::{
    DurableObject, Env, Method, Request, Response, ResponseBuilder, Result, SqlStorage,
    SqlStorageValue, State, WebSocket, WebSocketIncomingMessage, WebSocketPair, durable_object,
    wasm_bindgen,
};

use crate::auth::{iso, now_ms};

/// The attachment header the Worker sets on requests it forwards here.
pub const ATTACHMENT_HEADER: &str = "X-Stam-Attachment";
/// Durable Object SQLite rows hold at most 2 MB, so trees are stored in parts.
const CHUNK_BYTES: usize = 1_000_000;
/// Ops are written at once; the whole tree after this long without one (spec §4.2).
const FLUSH_AFTER_MS: f64 = 30_000.0;
pub const MAX_PHOTO_BYTES: usize = 300 * 1024;
pub const CLOSE_REVOKED: u16 = 4401;
pub const CLOSE_DELETED: u16 = 4404;

fn store_error(e: impl std::fmt::Display) -> StoreError {
    StoreError(e.to_string())
}

/// `RoomStore` over the object's SQLite. SQL in a Durable Object is synchronous.
pub struct SqlStore {
    sql: SqlStorage,
}

#[derive(Deserialize)]
struct Part {
    data: String,
}

#[derive(Deserialize)]
struct OpRow {
    version: f64,
    op_id: String,
    author: String,
    kind: String,
    payload: String,
    changes: String,
    at: String,
}

impl OpRow {
    fn into_op(self) -> StoreResult<StoredOp> {
        Ok(StoredOp {
            version: self.version as u64,
            op_id: self.op_id,
            author: serde_json::from_str(&self.author).map_err(store_error)?,
            kind: serde_json::from_value(Value::String(self.kind)).map_err(store_error)?,
            payload_json: self.payload,
            changes_json: self.changes,
            at: self.at,
        })
    }
}

const SCHEMA: [&str; 5] = [
    "CREATE TABLE IF NOT EXISTS docs (name TEXT, part INTEGER, data TEXT, PRIMARY KEY (name, part))",
    "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
    "CREATE TABLE IF NOT EXISTS revoked (link_id TEXT PRIMARY KEY)",
    "CREATE TABLE IF NOT EXISTS ops (version INTEGER PRIMARY KEY, op_id TEXT NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, changes TEXT NOT NULL, at TEXT NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ops_op_id ON ops (op_id) WHERE op_id <> ''",
];

impl SqlStore {
    fn new(sql: SqlStorage) -> StoreResult<Self> {
        for statement in SCHEMA {
            sql.exec(statement, None).map_err(store_error)?;
        }
        Ok(Self { sql })
    }

    fn exec(&self, query: &str, bindings: Vec<SqlStorageValue>) -> StoreResult<()> {
        self.sql
            .exec(query, Some(bindings))
            .map(|_| ())
            .map_err(store_error)
    }

    fn rows<T: serde::de::DeserializeOwned>(
        &self,
        query: &str,
        bindings: Vec<SqlStorageValue>,
    ) -> StoreResult<Vec<T>> {
        self.sql
            .exec(query, Some(bindings))
            .and_then(|c| c.to_array())
            .map_err(store_error)
    }

    fn write_doc(&self, name: &str, json: &str) -> StoreResult<()> {
        self.exec("DELETE FROM docs WHERE name = ?", vec![name.into()])?;
        let mut start = 0;
        let mut part = 0i64;
        while start < json.len() {
            let mut end = (start + CHUNK_BYTES).min(json.len());
            while !json.is_char_boundary(end) {
                end -= 1;
            }
            self.exec(
                "INSERT INTO docs (name, part, data) VALUES (?, ?, ?)",
                vec![name.into(), part.into(), json[start..end].into()],
            )?;
            start = end;
            part += 1;
        }
        Ok(())
    }

    fn read_doc(&self, name: &str) -> StoreResult<Option<String>> {
        let parts: Vec<Part> = self.rows(
            "SELECT data FROM docs WHERE name = ? ORDER BY part",
            vec![name.into()],
        )?;
        Ok((!parts.is_empty()).then(|| parts.into_iter().map(|p| p.data).collect()))
    }

    fn meta(&self, key: &str) -> StoreResult<Option<String>> {
        #[derive(Deserialize)]
        struct Row {
            v: String,
        }
        Ok(self
            .rows::<Row>("SELECT v FROM meta WHERE k = ?", vec![key.into()])?
            .pop()
            .map(|r| r.v))
    }

    fn set_meta(&self, key: &str, value: &str) -> StoreResult<()> {
        self.exec(
            "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
            vec![key.into(), value.into()],
        )
    }

    fn revoke(&self, link_id: &str) -> StoreResult<()> {
        self.exec(
            "INSERT OR IGNORE INTO revoked (link_id) VALUES (?)",
            vec![link_id.into()],
        )
    }

    fn is_revoked(&self, link_id: &str) -> StoreResult<bool> {
        #[derive(Deserialize)]
        struct Row {
            #[allow(dead_code)]
            link_id: String,
        }
        Ok(!self
            .rows::<Row>(
                "SELECT link_id FROM revoked WHERE link_id = ?",
                vec![link_id.into()],
            )?
            .is_empty())
    }
}

impl RoomStore for SqlStore {
    fn load(&self) -> StoreResult<Option<Snapshot>> {
        let Some(doc_json) = self.read_doc("snapshot")? else {
            return Ok(None);
        };
        let doc_version: u64 = self
            .meta("doc_version")?
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| StoreError("doc_version missing".into()))?;
        #[derive(Deserialize)]
        struct Max {
            v: Option<f64>,
        }
        let version = self
            .rows::<Max>("SELECT MAX(version) AS v FROM ops", vec![])?
            .pop()
            .and_then(|m| m.v)
            .map_or(doc_version, |v| v as u64);
        Ok(Some(Snapshot {
            doc_json,
            doc_version,
            version,
        }))
    }

    fn ops_after(&self, version: u64, limit: u32) -> StoreResult<Vec<StoredOp>> {
        self.rows::<OpRow>(
            "SELECT version, op_id, author, kind, payload, changes, at FROM ops WHERE version > ? ORDER BY version LIMIT ?",
            vec![(version as i64).into(), i64::from(limit).into()],
        )?
        .into_iter()
        .map(OpRow::into_op)
        .collect()
    }

    fn find_op(&self, op_id: &str) -> StoreResult<Option<StoredOp>> {
        self.rows::<OpRow>(
            "SELECT version, op_id, author, kind, payload, changes, at FROM ops WHERE op_id = ? AND op_id <> ''",
            vec![op_id.into()],
        )?
        .pop()
        .map(OpRow::into_op)
        .transpose()
    }

    fn append_op(&mut self, op: &StoredOp) -> StoreResult<()> {
        let kind = serde_json::to_value(op.kind).map_err(store_error)?;
        let author = serde_json::to_string(&op.author).map_err(store_error)?;
        self.exec(
            "INSERT INTO ops (version, op_id, author, kind, payload, changes, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            vec![
                (op.version as i64).into(),
                op.op_id.as_str().into(),
                author.into(),
                kind.as_str().unwrap_or("cmd").into(),
                op.payload_json.as_str().into(),
                op.changes_json.as_str().into(),
                op.at.as_str().into(),
            ],
        )
    }

    fn write_snapshot(&mut self, doc_json: &str, version: u64) -> StoreResult<()> {
        self.write_doc("snapshot", doc_json)?;
        self.set_meta("doc_version", &version.to_string())
    }

    fn write_checkpoint(&mut self, version: u64, doc_json: &str) -> StoreResult<()> {
        self.write_doc(&format!("checkpoint:{version}"), doc_json)
    }

    fn epoch(&self) -> StoreResult<Option<String>> {
        #[derive(Deserialize)]
        struct Row {
            at: String,
        }
        Ok(self
            .rows::<Row>("SELECT at FROM ops WHERE version = 0", vec![])?
            .pop()
            .map(|r| r.at))
    }

    fn wipe(&mut self) -> StoreResult<()> {
        for table in ["docs", "meta", "ops", "revoked"] {
            self.exec(&format!("DELETE FROM {table}"), vec![])?;
        }
        Ok(())
    }
}

#[durable_object]
pub struct TreeRoom {
    state: State,
    env: Env,
    core: RefCell<Option<RoomCore<SqlStore>>>,
}

fn attachment(req: &Request) -> Option<Attachment> {
    let header = req.headers().get(ATTACHMENT_HEADER).ok()??;
    serde_json::from_str(&header).ok()
}

fn webp(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

fn unavailable() -> Result<Response> {
    Response::error("storage unavailable", 503)
}

impl TreeRoom {
    fn store(&self) -> StoreResult<SqlStore> {
        SqlStore::new(self.state.storage().sql())
    }

    /// Runs `f` on the room, opening it from storage after a wake-up.
    fn with_core<T>(
        &self,
        f: impl FnOnce(&mut RoomCore<SqlStore>) -> T,
    ) -> std::result::Result<T, RoomError> {
        let mut core = self.core.borrow_mut();
        if core.is_none() {
            *core = Some(RoomCore::open(self.store()?)?);
        }
        Ok(f(core.as_mut().expect("just opened")))
    }

    fn tree_id(&self) -> StoreResult<Option<String>> {
        self.store()?.meta("tree_id")
    }

    async fn init(&self, mut req: Request) -> Result<Response> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Init {
            doc: TreeDocument,
            author: Author,
            tree_id: String,
        }
        let init: Init = req.json().await?;
        let Ok(store) = self.store() else {
            return unavailable();
        };
        match store.load() {
            Ok(Some(_)) => return Response::error("exists", 409),
            Ok(None) => {}
            Err(_) => return unavailable(),
        }
        if store.set_meta("tree_id", &init.tree_id).is_err() {
            return unavailable();
        }
        match RoomCore::create(store, init.doc, init.author, &iso(now_ms())) {
            Ok(core) => {
                *self.core.borrow_mut() = Some(core);
                Ok(Response::empty()?.with_status(201))
            }
            Err(_) => unavailable(),
        }
    }

    fn accept_socket(&self, req: &Request) -> Result<Response> {
        let Some(att) = attachment(req) else {
            return Response::error("no attachment", 400);
        };
        // A link turned off while this request was on its way here.
        if let Some(link) = &att.link_id {
            match self.store().and_then(|s| s.is_revoked(link)) {
                Ok(true) => return Response::error("link off", 401),
                Ok(false) => {}
                Err(_) => return unavailable(),
            }
        }
        match self.with_core(|_| ()) {
            Ok(()) => {}
            Err(RoomError::NoTree) => return Response::error("no tree", 404),
            Err(_) => return unavailable(),
        }
        let pair = WebSocketPair::new()?;
        let tag = att.link_id.clone().unwrap_or_else(|| "owner".into());
        self.state.accept_websocket_with_tags(&pair.server, &[&tag]);
        pair.server.serialize_attachment(&att)?;
        Ok(ResponseBuilder::new()
            .with_status(101)
            .with_websocket(pair.client)
            .empty())
    }

    /// Closes sockets with a close code, saying so in a `closed` message first: a close frame does
    /// not always reach the client (it does not through `wrangler dev`), a message does.
    fn close_all(&self, sockets: Vec<WebSocket>, code: u16, reason: &str) {
        let notice = json!({ "type": "closed", "code": code, "reason": reason }).to_string();
        for ws in sockets {
            let _ = ws.send_with_str(&notice);
            let _ = ws.close(Some(code), Some(reason));
        }
    }

    async fn close_link(&self, mut req: Request) -> Result<Response> {
        let body: Value = req.json().await?;
        let link = body["linkId"].as_str().unwrap_or_default();
        if self.store().and_then(|s| s.revoke(link)).is_err() {
            return unavailable();
        }
        self.close_all(
            self.state.get_websockets_with_tag(link),
            CLOSE_REVOKED,
            "link off",
        );
        Ok(Response::empty()?.with_status(204))
    }

    /// Everything about the tree goes: sockets, photos (every page of them), storage, the alarm.
    async fn destroy(&self) -> Result<Response> {
        self.close_all(self.state.get_websockets(), CLOSE_DELETED, "tree deleted");
        let Ok(tree_id) = self.tree_id() else {
            return unavailable();
        };
        if let Some(tree_id) = tree_id {
            let bucket = self.env.bucket("PHOTOS")?;
            let mut cursor: Option<String> = None;
            loop {
                let mut list = bucket.list().prefix(format!("photos/{tree_id}/"));
                if let Some(c) = cursor.take() {
                    list = list.cursor(c);
                }
                let page = list.execute().await?;
                let keys: Vec<String> = page.objects().iter().map(|o| o.key()).collect();
                if !keys.is_empty() {
                    bucket.delete_multiple(keys).await?;
                }
                if !page.truncated() {
                    break;
                }
                cursor = page.cursor();
            }
        }
        *self.core.borrow_mut() = None;
        self.state.storage().delete_alarm().await?;
        self.state.storage().delete_all().await?;
        Ok(Response::empty()?.with_status(204))
    }

    async fn photo(&self, mut req: Request, photo_id: &str) -> Result<Response> {
        let Some(att) = attachment(&req) else {
            return Response::error("no attachment", 400);
        };
        let Ok(Some(tree_id)) = self.tree_id() else {
            return Response::error("no tree", 404);
        };
        let key = format!("photos/{tree_id}/{photo_id}.webp");
        let bucket = self.env.bucket("PHOTOS")?;
        if req.method() == Method::Put {
            if !att.role.can_edit() || att.hide_living {
                return Response::error("forbidden", 403);
            }
            let known = self.with_core(|core| photo_owner(core.doc(), photo_id).is_some());
            if !matches!(known, Ok(true)) {
                return Response::error("no such photo", 404);
            }
            let bytes = req.bytes().await?;
            if bytes.len() > MAX_PHOTO_BYTES {
                return Response::error("too large", 413);
            }
            if !webp(&bytes) {
                return Response::error("not webp", 415);
            }
            bucket.put(key, bytes).execute().await?;
            return Ok(Response::empty()?.with_status(204));
        }
        let access = self.with_core(|core| core.photo_access(&att, photo_id));
        if !matches!(access, Ok(PhotoAccess::Allowed)) {
            return Response::error("not found", 404);
        }
        let Some(object) = bucket.get(key).execute().await? else {
            return Response::error("not found", 404);
        };
        let Some(body) = object.body() else {
            return Response::error("not found", 404);
        };
        let res = Response::from_bytes(body.bytes().await?)?;
        res.headers().set("Content-Type", "image/webp")?;
        res.headers()
            .set("Cache-Control", "private, max-age=31536000, immutable")?;
        Ok(res)
    }
}

impl DurableObject for TreeRoom {
    fn new(state: State, env: Env) -> Self {
        Self {
            state,
            env,
            core: RefCell::new(None),
        }
    }

    async fn fetch(&self, req: Request) -> Result<Response> {
        let path = req.path();
        match (req.method(), path.as_str()) {
            (Method::Post, "/init") => self.init(req).await,
            (Method::Get, "/ws") => self.accept_socket(&req),
            (Method::Post, "/close-link") => self.close_link(req).await,
            (Method::Post, "/destroy") => self.destroy().await,
            // Tests only (the Worker routes here only in dev): forget the room in memory, as
            // hibernation does, so the next message reloads it from SQLite.
            (Method::Post, "/evict") => {
                *self.core.borrow_mut() = None;
                Ok(Response::empty()?.with_status(204))
            }
            (_, p) if p.starts_with("/photo/") => {
                let id = p.trim_start_matches("/photo/").to_owned();
                self.photo(req, &id).await
            }
            _ => Response::error("not found", 404),
        }
    }

    async fn websocket_message(
        &self,
        ws: WebSocket,
        message: WebSocketIncomingMessage,
    ) -> Result<()> {
        let Some(att) = ws.deserialize_attachment::<Attachment>()? else {
            return Ok(());
        };
        let WebSocketIncomingMessage::String(text) = message else {
            ws.send_with_str(json!({"type": "rejected", "code": "BAD_MESSAGE"}).to_string())?;
            return Ok(());
        };
        let outcome = self.with_core(|core| {
            (
                core.on_message(&att, &text, &iso(now_ms()), now_ms()),
                core.flush_due(),
            )
        });
        let (out, flush_due) = match outcome {
            Ok(done) => done,
            Err(RoomError::NoTree) => {
                self.close_all(vec![ws], CLOSE_DELETED, "tree deleted");
                return Ok(());
            }
            Err(_) => {
                // Storage is unavailable: the client keeps its edits and tries again.
                ws.send_with_str(json!({"type": "busy", "retryAfter": 30}).to_string())?;
                return Ok(());
            }
        };
        for reply in &out.reply {
            ws.send_with_str(reply)?;
        }
        if let Some(b) = out.broadcast {
            for socket in self.state.get_websockets() {
                let hidden = socket
                    .deserialize_attachment::<Attachment>()
                    .ok()
                    .flatten()
                    .is_none_or(|a| a.hide_living);
                let _ = socket.send_with_str(if hidden { &b.redacted } else { &b.full });
            }
        }
        if flush_due && self.state.storage().get_alarm().await?.is_none() {
            self.state
                .storage()
                .set_alarm((now_ms() + FLUSH_AFTER_MS) as i64)
                .await?;
        }
        Ok(())
    }

    async fn websocket_close(
        &self,
        ws: WebSocket,
        _code: usize,
        _reason: String,
        _clean: bool,
    ) -> Result<()> {
        if let Ok(Some(att)) = ws.deserialize_attachment::<Attachment>() {
            let _ = self.with_core(|core| core.on_close(&att.socket_id));
        }
        let _ = ws.close(Some(1000), Some("closed"));
        Ok(())
    }

    async fn alarm(&self) -> Result<Response> {
        let flushed = self.with_core(|core| core.flush()).unwrap_or(false);
        if !flushed {
            // Try again later; the ops are already logged, so nothing is lost meanwhile.
            self.state
                .storage()
                .set_alarm((now_ms() + FLUSH_AFTER_MS) as i64)
                .await?;
        }
        Response::empty()
    }
}
