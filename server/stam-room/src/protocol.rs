//! The messages on a tree's WebSocket (spec §5.3, P1 subset). `src/sync/protocol.ts` mirrors them;
//! the protocol and convergence suites run the TS client against this room compiled to WASM.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    View,
    Comment,
    Edit,
}

impl Role {
    pub fn can_edit(self) -> bool {
        matches!(self, Role::Owner | Role::Edit)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthorKind {
    Owner,
    Link,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Author {
    pub kind: AuthorKind,
    pub id: String,
    pub name: String,
}

/// Who is on a socket. The Worker decides it at connect time; the Durable Object keeps it in the
/// socket's serialized attachment, so it survives hibernation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub socket_id: String,
    pub role: Role,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_id: Option<String>,
    pub hide_living: bool,
    pub author: Author,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ClientMessage {
    Hello {
        #[serde(default)]
        last_version: Option<u64>,
        /// The client's unconfirmed op ids; the welcome names those already applied.
        #[serde(default)]
        pending: Vec<String>,
    },
    Op {
        op_id: String,
        cmd: Value,
    },
    Revert {
        op_id: String,
        entries: Value,
        direction: String,
    },
}

/// The author as other clients see it: no account id.
#[derive(Clone, Debug, Serialize)]
pub struct PublicAuthor<'a> {
    pub kind: AuthorKind,
    pub name: &'a str,
}

impl<'a> From<&'a Author> for PublicAuthor<'a> {
    fn from(a: &'a Author) -> Self {
        Self {
            kind: a.kind,
            name: &a.name,
        }
    }
}
