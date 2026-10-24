//! The Stam tree rules in Rust: a port of the TypeScript core (`src/core`) that the server runs to
//! referee shared trees. It must behave exactly like the TS; `tests/parity` in the app proves it.

pub mod model;
pub mod parse;
pub mod tree;
pub mod validate;

pub use model::*;
pub use parse::{ParseError, is_safe_id, parse_tree_document, parse_tree_value};
pub use validate::{Issue, IssueCode, validate};
