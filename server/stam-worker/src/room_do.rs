//! The `TreeRoom` Durable Object: one per shared tree (spec §3). It adapts `RoomCore` to the
//! object's SQLite storage, hibernating WebSockets (who is on a socket lives in its attachment)
//! and alarms, and serves the tree's photos from R2.

use std::cell::RefCell;

use serde::Deserialize;
use serde_json::{Value, json};
use stam_core::{TreeDocument, photo_owner};
use stam_room::{Attachment, Author, PhotoAccess, RoomCore, RoomStore, Snapshot, StoredOp};
use worker::{
    DurableObject, Env, Method, Request, Response, ResponseBuilder, Result, SqlStorage, State,
    WebSocket, WebSocketIncomingMessage, WebSocketPair, durable_object, wasm_bindgen,
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
    fn into_op(self) -> StoredOp {
        StoredOp {
            version: self.version as u64,
            op_id: self.op_id,
            author: serde_json::from_str(&self.author).expect("stored author"),
            kind: serde_json::from_value(Value::String(self.kind)).expect("stored kind"),
            payload_json: self.payload,
            changes_json: self.changes,
            at: self.at,
        }
    }
}

impl SqlStore {
    fn new(sql: SqlStorage) -> Self {
        for statement in [
            "CREATE TABLE IF NOT EXISTS docs (name TEXT, part INTEGER, data TEXT, PRIMARY KEY (name, part))",
            "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
            "CREATE TABLE IF NOT EXISTS ops (version INTEGER PRIMARY KEY, op_id TEXT NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, changes TEXT NOT NULL, at TEXT NOT NULL)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ops_op_id ON ops (op_id) WHERE op_id <> ''",
        ] {
            sql.exec(statement, None).expect("schema");
        }
        Self { sql }
    }

    fn exec(&self, query: &str, bindings: Vec<worker::SqlStorageValue>) {
        self.sql.exec(query, Some(bindings)).expect("sql");
    }

    fn rows<T: serde::de::DeserializeOwned>(
        &self,
        query: &str,
        bindings: Vec<worker::SqlStorageValue>,
    ) -> Vec<T> {
        self.sql
            .exec(query, Some(bindings))
            .and_then(|c| c.to_array())
            .expect("sql")
    }

    fn write_doc(&self, name: &str, json: &str) {
        self.exec("DELETE FROM docs WHERE name = ?", vec![name.into()]);
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
            );
            start = end;
            part += 1;
        }
    }

    fn read_doc(&self, name: &str) -> Option<String> {
        let parts: Vec<Part> = self.rows(
            "SELECT data FROM docs WHERE name = ? ORDER BY part",
            vec![name.into()],
        );
        (!parts.is_empty()).then(|| parts.into_iter().map(|p| p.data).collect())
    }

    fn meta(&self, key: &str) -> Option<String> {
        #[derive(Deserialize)]
        struct Row {
            v: String,
        }
        self.rows::<Row>("SELECT v FROM meta WHERE k = ?", vec![key.into()])
            .pop()
            .map(|r| r.v)
    }

    fn set_meta(&self, key: &str, value: &str) {
        self.exec(
            "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
            vec![key.into(), value.into()],
        );
    }
}

impl RoomStore for SqlStore {
    fn load(&self) -> Option<Snapshot> {
        let doc_json = self.read_doc("snapshot")?;
        let doc_version: u64 = self.meta("doc_version")?.parse().ok()?;
        #[derive(Deserialize)]
        struct Max {
            v: Option<f64>,
        }
        let version = self
            .rows::<Max>("SELECT MAX(version) AS v FROM ops", vec![])
            .pop()
            .and_then(|m| m.v)
            .map_or(doc_version, |v| v as u64);
        Some(Snapshot {
            doc_json,
            doc_version,
            version,
        })
    }

    fn ops_after(&self, version: u64, limit: u32) -> Vec<StoredOp> {
        self.rows::<OpRow>(
            "SELECT version, op_id, author, kind, payload, changes, at FROM ops WHERE version > ? ORDER BY version LIMIT ?",
            vec![(version as i64).into(), i64::from(limit).into()],
        )
        .into_iter()
        .map(OpRow::into_op)
        .collect()
    }

    fn find_op(&self, op_id: &str) -> Option<StoredOp> {
        self.rows::<OpRow>(
            "SELECT version, op_id, author, kind, payload, changes, at FROM ops WHERE op_id = ? AND op_id <> ''",
            vec![op_id.into()],
        )
        .pop()
        .map(OpRow::into_op)
    }

    fn append_op(&mut self, op: &StoredOp) {
        let kind = serde_json::to_value(op.kind).expect("kind");
        self.exec(
            "INSERT INTO ops (version, op_id, author, kind, payload, changes, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            vec![
                (op.version as i64).into(),
                op.op_id.as_str().into(),
                serde_json::to_string(&op.author).expect("author").into(),
                kind.as_str().unwrap_or("cmd").into(),
                op.payload_json.as_str().into(),
                op.changes_json.as_str().into(),
                op.at.as_str().into(),
            ],
        );
    }

    fn write_snapshot(&mut self, doc_json: &str, version: u64) {
        self.write_doc("snapshot", doc_json);
        self.set_meta("doc_version", &version.to_string());
    }

    fn write_checkpoint(&mut self, version: u64, doc_json: &str) {
        self.write_doc(&format!("checkpoint:{version}"), doc_json);
    }

    fn wipe(&mut self) {
        for table in ["docs", "meta", "ops"] {
            self.exec(&format!("DELETE FROM {table}"), vec![]);
        }
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

impl TreeRoom {
    /// Runs `f` on the room, opening it from storage after a wake-up. None when there is no tree.
    fn with_core<T>(&self, f: impl FnOnce(&mut RoomCore<SqlStore>) -> T) -> Option<T> {
        let mut core = self.core.borrow_mut();
        if core.is_none() {
            let store = SqlStore::new(self.state.storage().sql());
            *core = RoomCore::open(store).ok();
        }
        core.as_mut().map(f)
    }

    fn tree_id(&self) -> Option<String> {
        SqlStore::new(self.state.storage().sql()).meta("tree_id")
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
        let store = SqlStore::new(self.state.storage().sql());
        if store.load().is_some() {
            return Response::error("exists", 409);
        }
        store.set_meta("tree_id", &init.tree_id);
        *self.core.borrow_mut() = Some(RoomCore::create(
            store,
            init.doc,
            init.author,
            &iso(now_ms()),
        ));
        Ok(Response::empty()?.with_status(201))
    }

    fn accept_socket(&self, req: &Request) -> Result<Response> {
        let Some(att) = attachment(req) else {
            return Response::error("no attachment", 400);
        };
        if self.with_core(|_| ()).is_none() {
            return Response::error("no tree", 404);
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

    async fn destroy(&self) -> Result<Response> {
        self.close_all(self.state.get_websockets(), CLOSE_DELETED, "tree deleted");
        if let Some(tree_id) = self.tree_id() {
            let bucket = self.env.bucket("PHOTOS")?;
            let listed = bucket
                .list()
                .prefix(format!("photos/{tree_id}/"))
                .execute()
                .await?;
            let keys: Vec<String> = listed.objects().iter().map(|o| o.key()).collect();
            if !keys.is_empty() {
                bucket.delete_multiple(keys).await?;
            }
        }
        self.with_core(|core| core.wipe());
        SqlStore::new(self.state.storage().sql()).wipe();
        *self.core.borrow_mut() = None;
        Ok(Response::empty()?.with_status(204))
    }

    async fn photo(&self, mut req: Request, photo_id: &str) -> Result<Response> {
        let Some(att) = attachment(&req) else {
            return Response::error("no attachment", 400);
        };
        let Some(tree_id) = self.tree_id() else {
            return Response::error("no tree", 404);
        };
        let key = format!("photos/{tree_id}/{photo_id}.webp");
        let bucket = self.env.bucket("PHOTOS")?;
        if req.method() == Method::Put {
            if !att.role.can_edit() || att.hide_living {
                return Response::error("forbidden", 403);
            }
            if self.with_core(|core| photo_owner(core.doc(), photo_id).is_some()) != Some(true) {
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
        if self.with_core(|core| core.photo_access(&att, photo_id)) != Some(PhotoAccess::Allowed) {
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
            (Method::Post, "/close-link") => {
                let mut req = req;
                let body: Value = req.json().await?;
                let link = body["linkId"].as_str().unwrap_or_default();
                self.close_all(
                    self.state.get_websockets_with_tag(link),
                    CLOSE_REVOKED,
                    "link off",
                );
                Ok(Response::empty()?.with_status(204))
            }
            (Method::Post, "/destroy") => self.destroy().await,
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
        let Some((out, flush_due)) = self.with_core(|core| {
            (
                core.on_message(&att, &text, &iso(now_ms()), now_ms()),
                core.flush_due(),
            )
        }) else {
            self.close_all(vec![ws], CLOSE_DELETED, "tree deleted");
            return Ok(());
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
            self.with_core(|core| core.on_close(&att.socket_id));
        }
        let _ = ws.close(Some(1000), Some("closed"));
        Ok(())
    }

    async fn alarm(&self) -> Result<Response> {
        self.with_core(|core| core.flush());
        Response::empty()
    }
}
