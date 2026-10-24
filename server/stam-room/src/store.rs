//! Where a room keeps its tree. The Durable Object implements this over its SQLite storage, which
//! is synchronous; `MemoryStore` is for tests and the WASM harness.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::protocol::Author;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpKind {
    Upload,
    Cmd,
    Revert,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredOp {
    pub version: u64,
    pub op_id: String,
    pub author: Author,
    pub kind: OpKind,
    /// The command or revert as the client sent it.
    pub payload_json: String,
    /// The resulting `Changes`, which replay applies without re-running the command.
    pub changes_json: String,
    pub at: String,
}

/// The tree as of `doc_version`; `version` is the newest op.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub doc_json: String,
    pub doc_version: u64,
    pub version: u64,
}

pub trait RoomStore {
    fn load(&self) -> Option<Snapshot>;
    /// Ops with a version above `version`, oldest first, at most `limit`.
    fn ops_after(&self, version: u64, limit: u32) -> Vec<StoredOp>;
    fn find_op(&self, op_id: &str) -> Option<StoredOp>;
    fn append_op(&mut self, op: &StoredOp);
    fn write_snapshot(&mut self, doc_json: &str, version: u64);
    fn write_checkpoint(&mut self, version: u64, doc_json: &str);
    fn wipe(&mut self);
}

#[derive(Clone, Debug, Default)]
pub struct MemoryStore {
    pub snapshot: Option<(String, u64)>,
    pub ops: Vec<StoredOp>,
    pub checkpoints: BTreeMap<u64, String>,
}

impl RoomStore for MemoryStore {
    fn load(&self) -> Option<Snapshot> {
        let (doc_json, doc_version) = self.snapshot.clone()?;
        let version = self.ops.last().map_or(doc_version, |op| op.version);
        Some(Snapshot {
            doc_json,
            doc_version,
            version,
        })
    }

    fn ops_after(&self, version: u64, limit: u32) -> Vec<StoredOp> {
        self.ops
            .iter()
            .filter(|op| op.version > version)
            .take(limit as usize)
            .cloned()
            .collect()
    }

    fn find_op(&self, op_id: &str) -> Option<StoredOp> {
        self.ops.iter().find(|op| op.op_id == op_id).cloned()
    }

    fn append_op(&mut self, op: &StoredOp) {
        self.ops.push(op.clone());
    }

    fn write_snapshot(&mut self, doc_json: &str, version: u64) {
        self.snapshot = Some((doc_json.to_owned(), version));
    }

    fn write_checkpoint(&mut self, version: u64, doc_json: &str) {
        self.checkpoints.insert(version, doc_json.to_owned());
    }

    fn wipe(&mut self) {
        *self = Self::default();
    }
}
