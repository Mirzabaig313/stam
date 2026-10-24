//! `RoomHarness`: the real room in memory, with sockets, for the TS protocol and convergence suites
//! (`tests/sync` in the app). Built only with the `wasm` feature.

use serde_json::json;
use stam_core::TreeDocument;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{Attachment, Author, AuthorKind, MemoryStore, RoomCore};

#[wasm_bindgen]
pub struct RoomHarness {
    core: RoomCore<MemoryStore>,
    sockets: Vec<Attachment>,
}

#[wasm_bindgen]
impl RoomHarness {
    #[wasm_bindgen(constructor)]
    pub fn new(doc_json: &str, now: &str) -> RoomHarness {
        let doc: TreeDocument = serde_json::from_str(doc_json).expect("a well-formed document");
        let owner = Author {
            kind: AuthorKind::Owner,
            id: "owner".into(),
            name: "Owner".into(),
        };
        RoomHarness {
            core: RoomCore::create(MemoryStore::default(), doc, owner, now).expect("memory store"),
            sockets: vec![],
        }
    }

    /// Opens a socket with this attachment (JSON); returns its socket id.
    pub fn connect(&mut self, attachment_json: &str) -> String {
        let att: Attachment = serde_json::from_str(attachment_json).expect("an attachment");
        let id = att.socket_id.clone();
        self.sockets.push(att);
        id
    }

    pub fn disconnect(&mut self, socket_id: &str) {
        self.sockets.retain(|s| s.socket_id != socket_id);
        self.core.on_close(socket_id);
    }

    /// The Durable Object waking from hibernation: memory is gone, storage stays; sockets survive.
    pub fn restart(&mut self) {
        let store = std::mem::take(self.core.store_mut());
        self.core = RoomCore::open(store).expect("a stored room");
    }

    pub fn set_catch_up_limit(&mut self, ops: f64) {
        self.core.set_catch_up_limit(ops as u64);
    }

    /// Handles one message; returns `[{to, text}]` for every socket that gets something.
    pub fn message(&mut self, socket_id: &str, text: &str, now: &str, now_ms: f64) -> String {
        let Some(att) = self
            .sockets
            .iter()
            .find(|s| s.socket_id == socket_id)
            .cloned()
        else {
            return "[]".into();
        };
        let out = self.core.on_message(&att, text, now, now_ms);
        let mut sends: Vec<_> = out
            .reply
            .iter()
            .map(|t| json!({"to": socket_id, "text": t}))
            .collect();
        if let Some(b) = out.broadcast {
            for s in &self.sockets {
                let text = if s.hide_living { &b.redacted } else { &b.full };
                sends.push(json!({"to": s.socket_id, "text": text}));
            }
        }
        serde_json::to_string(&sends).unwrap()
    }

    pub fn doc_json(&self) -> String {
        serde_json::to_string(self.core.doc()).unwrap()
    }

    pub fn version(&self) -> f64 {
        self.core.version() as f64
    }
}
