//! JSON-in, JSON-out bindings for the parity suite (`tests/parity` in the app), which runs the
//! TypeScript and Rust rules side by side. Built only with the `wasm` feature.

use serde_json::{Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{
    Applied, CommandError, TreeDocument, apply_command, apply_privacy, apply_revert,
    decode_command, parse_tree_document, validate,
};

fn doc(text: &str) -> TreeDocument {
    serde_json::from_str(text).expect("the parity suite passes well-formed documents")
}

fn result(r: Result<Applied, CommandError>) -> String {
    match r {
        Ok(a) => json!({"ok": {"doc": a.doc, "changes": a.changes, "createdIds": a.created_ids}}),
        Err(e) => json!({"err": e}),
    }
    .to_string()
}

#[wasm_bindgen]
pub fn apply_command_json(doc_json: &str, cmd_json: &str, now: &str, op_id: &str) -> String {
    let cmd: Value = serde_json::from_str(cmd_json).unwrap_or(Value::Null);
    result(decode_command(&cmd).and_then(|cmd| apply_command(&doc(doc_json), &cmd, now, op_id)))
}

#[wasm_bindgen]
pub fn apply_revert_json(doc_json: &str, entries_json: &str, direction: &str, now: &str) -> String {
    let entries: Value = serde_json::from_str(entries_json).unwrap_or(Value::Null);
    result(apply_revert(&doc(doc_json), &entries, direction, now))
}

#[wasm_bindgen]
pub fn parse_tree_json(text: &str) -> String {
    match parse_tree_document(text) {
        Ok(d) => json!({"ok": d}),
        Err(_) => json!({"err": "INVALID_TREE"}),
    }
    .to_string()
}

#[wasm_bindgen]
pub fn validate_json(doc_json: &str) -> String {
    serde_json::to_string(&validate(&doc(doc_json))).unwrap()
}

#[wasm_bindgen]
pub fn apply_privacy_json(doc_json: &str) -> String {
    serde_json::to_string(&apply_privacy(&doc(doc_json))).unwrap()
}
