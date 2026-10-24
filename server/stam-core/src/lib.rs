//! The Stam tree rules in Rust: a port of the TypeScript core (`src/core`) that the server runs to
//! referee shared trees. It must behave exactly like the TS; `tests/parity` in the app proves it.

pub mod changes;
pub mod commands;
pub mod dates;
pub mod error;
pub mod ids;
pub mod model;
pub mod parse;
pub mod privacy;
pub mod revert;
pub mod tree;
pub mod validate;
#[cfg(feature = "wasm")]
mod wasm;

pub use changes::{Changes, TreeChanges, apply_changes, diff_docs};
pub use commands::{Applied, Command, apply_command, decode_command};
pub use error::{CommandError, ErrorCode};
pub use ids::{is_op_id, op_id_source};
pub use model::*;
pub use parse::{ParseError, is_safe_id, parse_tree_document, parse_tree_value};
pub use privacy::{apply_privacy, is_living_person, photo_owner};
pub use revert::apply_revert;
pub use validate::{Issue, IssueCode, validate};
