//! `RoomCore`: one shared tree's referee. It orders every edit, applies it with `stam-core`,
//! logs it and says what to broadcast. No sockets or Cloudflare APIs here; the Durable Object
//! adapts this to its storage, sockets and alarms.

use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use stam_core::{
    Applied, Changes, CommandError, Person, TreeDocument, Union, apply_changes, apply_command,
    apply_privacy, apply_revert, decode_command, is_living_person, photo_owner,
};

use crate::protocol::{Attachment, Author, ClientMessage, PublicAuthor};
use crate::ratelimit::Bucket;
use crate::store::{OpKind, RoomStore, StoredOp};

/// People allowed in a cloud tree (`TUNED_PEOPLE`).
pub const MAX_PEOPLE: usize = 5000;
/// A client further behind than this gets the whole tree instead of the missing ops.
pub const CATCH_UP_OPS: u64 = 1000;
/// The tree is rewritten after this many ops (and when the idle alarm fires).
pub const SNAPSHOT_EVERY: u64 = 50;
/// A whole copy is kept every this many versions, for history.
pub const CHECKPOINT_EVERY: u64 = 500;

/// What to send after a message.
#[derive(Debug, Default)]
pub struct Outbox {
    /// Only to the socket that sent the message.
    pub reply: Vec<String>,
    pub broadcast: Option<Broadcast>,
}

/// Sent to every socket: `redacted` to hide-living sockets, `full` to all others.
#[derive(Debug)]
pub struct Broadcast {
    pub full: String,
    pub redacted: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PhotoAccess {
    Allowed,
    NotFound,
}

#[derive(Debug)]
pub struct RoomError(pub String);

pub struct RoomCore<S: RoomStore> {
    store: S,
    doc: TreeDocument,
    version: u64,
    doc_version: u64,
    max_people: usize,
    buckets: HashMap<String, Bucket>,
}

fn to_json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("serialisable")
}

fn rejected(op_id: Option<&str>, code: &str, key: Option<&str>) -> String {
    let mut msg = json!({"type": "rejected", "code": code});
    if let Some(op_id) = op_id {
        msg["opId"] = json!(op_id);
    }
    if let Some(key) = key {
        msg["key"] = json!(key);
    }
    msg.to_string()
}

fn applied_message(version: u64, op_id: &str, author: &Author, changes: &Value) -> String {
    json!({
        "type": "applied",
        "version": version,
        "opId": op_id,
        "author": PublicAuthor::from(author),
        "changes": changes,
    })
    .to_string()
}

fn code_of(e: &CommandError) -> String {
    serde_json::to_value(e.code)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

impl<S: RoomStore> RoomCore<S> {
    /// A new room for an uploaded tree: version 0, snapshot and checkpoint 0.
    pub fn create(mut store: S, doc: TreeDocument, author: Author, now: &str) -> Self {
        let doc_json = to_json(&doc);
        store.append_op(&StoredOp {
            version: 0,
            op_id: String::new(),
            author,
            kind: OpKind::Upload,
            payload_json: "null".into(),
            changes_json: "null".into(),
            at: now.to_owned(),
        });
        store.write_snapshot(&doc_json, 0);
        store.write_checkpoint(0, &doc_json);
        Self {
            store,
            doc,
            version: 0,
            doc_version: 0,
            max_people: MAX_PEOPLE,
            buckets: HashMap::new(),
        }
    }

    /// Loads the snapshot and applies the logged changes after it.
    pub fn open(store: S) -> Result<Self, RoomError> {
        let snap = store.load().ok_or_else(|| RoomError("no tree".into()))?;
        let mut doc: TreeDocument =
            serde_json::from_str(&snap.doc_json).map_err(|e| RoomError(e.to_string()))?;
        let mut version = snap.doc_version;
        for op in store.ops_after(snap.doc_version, u32::MAX) {
            let changes: Changes =
                serde_json::from_str(&op.changes_json).map_err(|e| RoomError(e.to_string()))?;
            apply_changes(&mut doc, &changes);
            version = op.version;
        }
        Ok(Self {
            store,
            doc,
            version,
            doc_version: snap.doc_version,
            max_people: MAX_PEOPLE,
            buckets: HashMap::new(),
        })
    }

    pub fn doc(&self) -> &TreeDocument {
        &self.doc
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn people_count(&self) -> usize {
        self.doc.persons.len()
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut S {
        &mut self.store
    }

    pub fn into_store(self) -> S {
        self.store
    }

    /// For tests: a smaller people limit.
    pub fn set_people_limit(&mut self, limit: usize) {
        self.max_people = limit;
    }

    /// True when ops arrived since the tree was last written.
    pub fn flush_due(&self) -> bool {
        self.version != self.doc_version
    }

    pub fn flush(&mut self) {
        if self.flush_due() {
            self.store.write_snapshot(&to_json(&self.doc), self.version);
            self.doc_version = self.version;
        }
    }

    /// `now` is an ISO timestamp from JS; `now_ms` drives the rate limit.
    pub fn on_message(&mut self, att: &Attachment, text: &str, now: &str, now_ms: f64) -> Outbox {
        let msg: ClientMessage = match serde_json::from_str(text) {
            Ok(m) => m,
            Err(_) => return reply(rejected(None, "BAD_MESSAGE", None)),
        };
        let (op_id, kind, payload, outcome) = match msg {
            ClientMessage::Hello { last_version } => return reply(self.welcome(att, last_version)),
            ClientMessage::Op { op_id, cmd } => {
                let outcome = self.edit(att, &op_id, now_ms, |doc| {
                    apply_command(doc, &decode_command(&cmd)?, now, &op_id)
                });
                (op_id, OpKind::Cmd, cmd.to_string(), outcome)
            }
            ClientMessage::Revert {
                op_id,
                entries,
                direction,
            } => {
                let outcome = self.edit(att, &op_id, now_ms, |doc| {
                    apply_revert(doc, &entries, &direction, now)
                });
                let payload = json!({"entries": entries, "direction": direction}).to_string();
                (op_id, OpKind::Revert, payload, outcome)
            }
        };
        match outcome {
            Ok(applied) => self.commit(att, &op_id, kind, payload, applied, now),
            Err(text) => reply(text),
        }
    }

    fn welcome(&self, att: &Attachment, last_version: Option<u64>) -> String {
        let mut msg = json!({
            "type": "welcome",
            "role": att.role,
            "hideLiving": att.hide_living,
            "version": self.version,
        });
        let catch_up = last_version
            .filter(|last| !att.hide_living && *last <= self.version)
            .filter(|last| self.version - last <= CATCH_UP_OPS);
        match catch_up {
            Some(last) => {
                let ops: Vec<Value> = self
                    .store
                    .ops_after(last, CATCH_UP_OPS as u32)
                    .iter()
                    .map(|op| {
                        json!({
                            "version": op.version,
                            "opId": op.op_id,
                            "author": PublicAuthor::from(&op.author),
                            "changes": serde_json::from_str::<Value>(&op.changes_json).unwrap_or(Value::Null),
                        })
                    })
                    .collect();
                msg["ops"] = Value::Array(ops);
            }
            None if att.hide_living => msg["doc"] = json!(apply_privacy(&self.doc)),
            None => msg["doc"] = json!(self.doc),
        }
        msg.to_string()
    }

    /// Checks role, rate and idempotence, then runs the edit. `Err` is the reply to send instead.
    fn edit(
        &mut self,
        att: &Attachment,
        op_id: &str,
        now_ms: f64,
        run: impl FnOnce(&TreeDocument) -> Result<Applied, CommandError>,
    ) -> Result<Applied, String> {
        if !att.role.can_edit() {
            return Err(rejected(Some(op_id), "FORBIDDEN", None));
        }
        let bucket = self
            .buckets
            .entry(att.socket_id.clone())
            .or_insert_with(|| Bucket::new(now_ms));
        if !bucket.take(now_ms) {
            return Err(json!({"type": "busy", "retryAfter": 1}).to_string());
        }
        if let Some(op) = self.store.find_op(op_id) {
            let changes = serde_json::from_str(&op.changes_json).unwrap_or(Value::Null);
            return Err(applied_message(op.version, op_id, &op.author, &changes));
        }
        let applied =
            run(&self.doc).map_err(|e| rejected(Some(op_id), &code_of(&e), e.key.as_deref()))?;
        if applied.doc.persons.len() > self.max_people {
            return Err(rejected(Some(op_id), "TOO_LARGE", None));
        }
        Ok(applied)
    }

    fn commit(
        &mut self,
        att: &Attachment,
        op_id: &str,
        kind: OpKind,
        payload: String,
        applied: Applied,
        now: &str,
    ) -> Outbox {
        let before = std::mem::replace(&mut self.doc, applied.doc);
        self.version += 1;
        let changes = serde_json::to_value(&applied.changes).expect("serialisable");
        self.store.append_op(&StoredOp {
            version: self.version,
            op_id: op_id.to_owned(),
            author: att.author.clone(),
            kind,
            payload_json: payload,
            changes_json: changes.to_string(),
            at: now.to_owned(),
        });
        if self.version - self.doc_version >= SNAPSHOT_EVERY {
            self.flush();
        }
        if self.version.is_multiple_of(CHECKPOINT_EVERY) {
            self.store
                .write_checkpoint(self.version, &to_json(&self.doc));
        }
        let redacted = serde_json::to_value(redacted_changes(&before, &self.doc, &applied.changes))
            .expect("serialisable");
        Outbox {
            reply: vec![],
            broadcast: Some(Broadcast {
                full: applied_message(self.version, op_id, &att.author, &changes),
                redacted: applied_message(self.version, op_id, &att.author, &redacted),
            }),
        }
    }

    pub fn photo_access(&self, att: &Attachment, photo_id: &str) -> PhotoAccess {
        match photo_owner(&self.doc, photo_id) {
            Some(p) if !(att.hide_living && is_living_person(p)) => PhotoAccess::Allowed,
            _ => PhotoAccess::NotFound,
        }
    }

    pub fn wipe(&mut self) {
        self.store.wipe();
    }
}

fn reply(text: String) -> Outbox {
    Outbox {
        reply: vec![text],
        broadcast: None,
    }
}

fn redact_person(p: &Person) -> Person {
    let mut p = p.clone();
    if is_living_person(&p) {
        p.birth = None;
        p.death = None;
        p.photo_id = None;
        p.notes = None;
    }
    p
}

fn redact_union(doc: &TreeDocument, u: &Union) -> Union {
    let mut u = u.clone();
    let living = |id: &String| doc.persons.get(id).is_some_and(is_living_person);
    if u.partners.iter().any(living) {
        u.start = None;
        u.end = None;
    }
    u
}

/// The changes a hide-living socket sees: the same as diffing the privacy view before and after,
/// computed only for what the op touched (a person's living status also redacts their unions).
fn redacted_changes(before: &TreeDocument, after: &TreeDocument, changes: &Changes) -> Changes {
    let persons: HashSet<&String> = changes.persons.keys().collect();
    let mut unions: HashSet<&String> = changes.unions.keys().collect();
    for doc in [before, after] {
        for id in &persons {
            for u in doc.union_order.get(*id).into_iter().flatten() {
                unions.insert(u);
            }
        }
    }
    let mut out = Changes {
        union_order: changes.union_order.clone(),
        tree: changes.tree.clone(),
        ..Changes::default()
    };
    for (id, p) in after.persons.iter().filter(|(id, _)| persons.contains(id)) {
        let now = redact_person(p);
        if before.persons.get(id).map(redact_person) != Some(now.clone()) {
            out.persons.insert(id.clone(), Some(now));
        }
    }
    for id in before
        .persons
        .keys()
        .filter(|id| persons.contains(id) && !after.persons.contains_key(*id))
    {
        out.persons.insert(id.clone(), None);
    }
    for (id, u) in after.unions.iter().filter(|(id, _)| unions.contains(id)) {
        let now = redact_union(after, u);
        if before.unions.get(id).map(|b| redact_union(before, b)) != Some(now.clone()) {
            out.unions.insert(id.clone(), Some(now));
        }
    }
    for id in before
        .unions
        .keys()
        .filter(|id| unions.contains(id) && !after.unions.contains_key(*id))
    {
        out.unions.insert(id.clone(), None);
    }
    out
}
