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

/// Storage failed (a full disk, the free plan's daily write limit): the room answers `busy`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoreError(pub String);

pub type StoreResult<T> = Result<T, StoreError>;

pub trait RoomStore {
    fn load(&self) -> StoreResult<Option<Snapshot>>;
    /// Ops with a version above `version`, oldest first, at most `limit`.
    fn ops_after(&self, version: u64, limit: u32) -> StoreResult<Vec<StoredOp>>;
    fn find_op(&self, op_id: &str) -> StoreResult<Option<StoredOp>>;
    fn append_op(&mut self, op: &StoredOp) -> StoreResult<()>;
    fn write_snapshot(&mut self, doc_json: &str, version: u64) -> StoreResult<()>;
    fn write_checkpoint(&mut self, version: u64, doc_json: &str) -> StoreResult<()>;
    fn wipe(&mut self) -> StoreResult<()>;
}

#[derive(Clone, Debug, Default)]
pub struct MemoryStore {
    pub snapshot: Option<(String, u64)>,
    pub ops: Vec<StoredOp>,
    pub checkpoints: BTreeMap<u64, String>,
    /// For tests: every call fails, as a broken disk would.
    pub failing: bool,
}

impl MemoryStore {
    fn check(&self) -> StoreResult<()> {
        if self.failing {
            Err(StoreError("failing".into()))
        } else {
            Ok(())
        }
    }
}

impl RoomStore for MemoryStore {
    fn load(&self) -> StoreResult<Option<Snapshot>> {
        self.check()?;
        let Some((doc_json, doc_version)) = self.snapshot.clone() else {
            return Ok(None);
        };
        let version = self.ops.last().map_or(doc_version, |op| op.version);
        Ok(Some(Snapshot {
            doc_json,
            doc_version,
            version,
        }))
    }

    fn ops_after(&self, version: u64, limit: u32) -> StoreResult<Vec<StoredOp>> {
        self.check()?;
        Ok(self
            .ops
            .iter()
            .filter(|op| op.version > version)
            .take(limit as usize)
            .cloned()
            .collect())
    }

    fn find_op(&self, op_id: &str) -> StoreResult<Option<StoredOp>> {
        self.check()?;
        Ok(self.ops.iter().find(|op| op.op_id == op_id).cloned())
    }

    fn append_op(&mut self, op: &StoredOp) -> StoreResult<()> {
        self.check()?;
        self.ops.push(op.clone());
        Ok(())
    }

    fn write_snapshot(&mut self, doc_json: &str, version: u64) -> StoreResult<()> {
        self.check()?;
        self.snapshot = Some((doc_json.to_owned(), version));
        Ok(())
    }

    fn write_checkpoint(&mut self, version: u64, doc_json: &str) -> StoreResult<()> {
        self.check()?;
        self.checkpoints.insert(version, doc_json.to_owned());
        Ok(())
    }

    fn wipe(&mut self) -> StoreResult<()> {
        *self = Self::default();
        Ok(())
    }
}
