//! Port of `applyRevert` in `src/sync/revert.ts`: collaborative undo and redo of one's own edit.
//! Entries arrive from a client, so every value written is checked like an uploaded tree.

use serde_json::Value;

use crate::changes::diff_docs;
use crate::commands::Applied;
use crate::error::{CommandError, ErrorCode, err};
use crate::model::TreeDocument;
use crate::parse::{is_safe_id, parse_tree_value};
use crate::validate::validate;

fn invalid<T>() -> Result<T, CommandError> {
    err(ErrorCode::Invalid)
}

enum Key<'a> {
    Person(&'a str),
    Union(&'a str),
    UnionOrder(&'a str),
    Name,
    Root,
}

fn parse_key(key: &str) -> Result<Key<'_>, CommandError> {
    let entity = |prefix: &str| key.strip_prefix(prefix).filter(|id| is_safe_id(id));
    if key == "tree/name" {
        Ok(Key::Name)
    } else if key == "tree/rootPersonId" {
        Ok(Key::Root)
    } else if let Some(id) = entity("persons/") {
        Ok(Key::Person(id))
    } else if let Some(id) = entity("unions/") {
        Ok(Key::Union(id))
    } else if let Some(id) = entity("unionOrder/") {
        Ok(Key::UnionOrder(id))
    } else {
        invalid()
    }
}

fn as_value<T: serde::Serialize>(v: Option<&T>) -> Value {
    v.map_or(Value::Null, |v| {
        serde_json::to_value(v).unwrap_or(Value::Null)
    })
}

fn current(doc: &TreeDocument, key: &Key) -> Value {
    match key {
        Key::Person(id) => as_value(doc.persons.get(*id)),
        Key::Union(id) => as_value(doc.unions.get(*id)),
        Key::UnionOrder(id) => as_value(doc.union_order.get(*id)),
        Key::Name => Value::String(doc.name.clone()),
        Key::Root => as_value(doc.root_person_id.as_ref()),
    }
}

/// `entries` is the client's JSON list of `{key, before, after}`; `direction` is "undo" or
/// "redo". Refuses with CONFLICT (naming the entity) when one changed since, and with INVALID for
/// malformed entries or a result that breaks the tree.
pub fn apply_revert(
    doc: &TreeDocument,
    entries: &Value,
    direction: &str,
    now: &str,
) -> Result<Applied, CommandError> {
    let undo = match direction {
        "undo" => true,
        "redo" => false,
        _ => return invalid(),
    };
    let Some(entries) = entries.as_array() else {
        return invalid();
    };

    // Writes go into the document as JSON, then the whole document is checked like an upload.
    let mut next = serde_json::to_value(doc).map_err(|_| CommandError::new(ErrorCode::Invalid))?;
    for entry in entries {
        let (Some(key), Some(before), Some(after)) = (
            entry.get("key").and_then(Value::as_str),
            entry.get("before"),
            entry.get("after"),
        ) else {
            return invalid();
        };
        let parsed = parse_key(key)?;
        let (expected, value) = if undo {
            (after, before)
        } else {
            (before, after)
        };
        if current(doc, &parsed) != *expected {
            return Err(CommandError {
                code: ErrorCode::Conflict,
                key: Some(key.to_owned()),
            });
        }
        let (map, id) = match parsed {
            Key::Person(id) => ("persons", id),
            Key::Union(id) => ("unions", id),
            Key::UnionOrder(id) => ("unionOrder", id),
            Key::Name => {
                if !value.is_string() {
                    return invalid();
                }
                next["name"] = value.clone();
                continue;
            }
            Key::Root => {
                match value {
                    Value::Null => {
                        next.as_object_mut().unwrap().shift_remove("rootPersonId");
                    }
                    v => next["rootPersonId"] = v.clone(),
                }
                continue;
            }
        };
        let target = next[map].as_object_mut().unwrap();
        if value.is_null() {
            target.shift_remove(id);
        } else {
            target.insert(id.to_owned(), value.clone());
        }
    }
    next["updatedAt"] = Value::String(now.to_owned());
    // parse_tree_value checks every field and runs validate; it also fills a missing root, which
    // a revert must not do, so the root is restored afterwards.
    let root = next.get("rootPersonId").cloned();
    let mut parsed = parse_tree_value(&next).map_err(|_| CommandError::new(ErrorCode::Invalid))?;
    if root.is_none() {
        parsed.root_person_id = None;
        if !validate(&parsed).is_empty() {
            return invalid();
        }
    }
    let changes = diff_docs(doc, &parsed);
    Ok(Applied {
        doc: parsed,
        changes,
        created_ids: vec![],
    })
}
