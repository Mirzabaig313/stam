//! Port of `src/io/json/parseTree.ts` for schema version 1 (the client migrates older trees before
//! upload): check every field by hand, rebuild the document from checked fields only, fill a
//! missing root, then `validate`. Accepts and refuses exactly what the TS parser does.

use serde_json::{Map as JsonMap, Value};
use thiserror::Error;

use crate::model::*;
use crate::tree::with_root;
use crate::validate::validate;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error, PartialEq, Eq)]
#[error("invalid tree: {0}")]
pub struct ParseError(pub String);

type Result<T> = std::result::Result<T, ParseError>;

fn invalid(what: impl Into<String>) -> ParseError {
    ParseError(what.into())
}

/// Names on `Object.prototype`, which the TS refuses as ids because ids become object keys.
const PROTOTYPE_NAMES: &[&str] = &[
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

/// A key JS objects order before all others ("7"); Rust maps keep insertion order, so shared
/// trees never use one. Mirrors `isIndexKey` in `parseTree.ts`.
pub fn is_index_key(value: &str) -> bool {
    let digits = value.len() <= 10 && value.bytes().all(|b| b.is_ascii_digit());
    digits
        && (value == "0" || !value.starts_with('0'))
        && value.parse::<u64>().is_ok_and(|n| n <= 4_294_967_294)
}

/// `^[A-Za-z0-9_-]{1,64}$`, not a built-in property name, and not an array index (see
/// `is_index_key`). The TS `isSharedId`.
pub fn is_safe_id(value: &str) -> bool {
    !value.is_empty()
        && !is_index_key(value)
        && (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        && !PROTOTYPE_NAMES.contains(&value)
}

pub(crate) fn record<'a>(value: &'a Value, what: &str) -> Result<&'a JsonMap<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{what} is malformed")))
}

pub(crate) fn read_id(value: &Value, what: &str) -> Result<String> {
    match value.as_str() {
        Some(s) if is_safe_id(s) => Ok(s.to_owned()),
        _ => Err(invalid(format!("{what} is not a valid id"))),
    }
}

pub(crate) fn read_string(value: &Value, what: &str) -> Result<String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| invalid(format!("{what} is not a string")))
}

pub(crate) fn read_bool(value: &Value, what: &str) -> Result<bool> {
    value
        .as_bool()
        .ok_or_else(|| invalid(format!("{what} is not a boolean")))
}

/// JS `Number.isInteger`: any whole number, also one written as `1990.0`.
pub(crate) fn read_int(value: &Value, what: &str) -> Result<i64> {
    let err = || invalid(format!("{what} is not a whole number"));
    if let Some(n) = value.as_i64() {
        return Ok(n);
    }
    match value.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() <= 9_007_199_254_740_991.0 => Ok(f as i64),
        _ => Err(err()),
    }
}

/// Reads a string-valued enum by its serde name.
pub(crate) fn read_enum<T: serde::de::DeserializeOwned>(value: &Value, what: &str) -> Result<T> {
    if !value.is_string() {
        return Err(invalid(format!("{what} is not one of the allowed values")));
    }
    serde_json::from_value(value.clone())
        .map_err(|_| invalid(format!("{what} is not one of the allowed values")))
}

/// TS `readOptional`: absent is None; anything else, `null` included, must read.
fn optional<T>(
    obj: &JsonMap<String, Value>,
    key: &str,
    read: impl FnOnce(&Value) -> Result<T>,
) -> Result<Option<T>> {
    obj.get(key).map(read).transpose()
}

pub(crate) fn read_fuzzy_date(value: &Value, what: &str) -> Result<FuzzyDate> {
    let v = record(value, what)?;
    Ok(FuzzyDate {
        qualifier: optional(v, "qualifier", |q| read_enum(q, what))?,
        year: optional(v, "year", |n| read_int(n, what))?,
        month: optional(v, "month", |n| read_int(n, what))?,
        day: optional(v, "day", |n| read_int(n, what))?,
        to_year: optional(v, "toYear", |n| read_int(n, what))?,
    })
}

fn read_event(value: &Value, what: &str) -> Result<Event> {
    let v = record(value, what)?;
    Ok(Event {
        date: optional(v, "date", |d| read_fuzzy_date(d, what))?,
        place: optional(v, "place", |p| read_string(p, what))?,
    })
}

fn read_person(key: &str, value: &Value) -> Result<Person> {
    let what = format!("Person {key}");
    let v = record(value, &what)?;
    if read_id(v.get("id").unwrap_or(&Value::Null), &what)? != key {
        return Err(invalid(format!("{what} has a different id from its key")));
    }
    let is_living = read_bool(v.get("isLiving").unwrap_or(&Value::Null), &what)?;
    let req = |k: &str| read_string(v.get(k).unwrap_or(&Value::Null), &what);
    Ok(Person {
        id: key.to_owned(),
        first_name: req("firstName")?,
        last_name: req("lastName")?,
        nickname: optional(v, "nickname", |s| read_string(s, &what))?,
        native_name: optional(v, "nativeName", |s| read_string(s, &what))?,
        gender: read_enum(v.get("gender").unwrap_or(&Value::Null), &what)?,
        is_placeholder: optional(v, "isPlaceholder", |b| read_bool(b, &what))?,
        is_living,
        birth: optional(v, "birth", |e| read_event(e, &what))?,
        death: optional(v, "death", |e| read_event(e, &what))?,
        photo_id: optional(v, "photoId", |id| read_id(id, &what))?,
        notes: optional(v, "notes", |s| read_string(s, &what))?,
    })
}

fn read_union(key: &str, value: &Value) -> Result<Union> {
    let what = format!("Union {key}");
    let v = record(value, &what)?;
    if read_id(v.get("id").unwrap_or(&Value::Null), &what)? != key {
        return Err(invalid(format!("{what} has a different id from its key")));
    }
    let partners = match v.get("partners").and_then(Value::as_array) {
        Some(list) if (1..=2).contains(&list.len()) => list
            .iter()
            .map(|p| read_id(p, &what))
            .collect::<Result<Vec<_>>>()?,
        _ => return Err(invalid(format!("{what} must have one or two partners"))),
    };
    let children = v
        .get("children")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{what} children is not a list")))?
        .iter()
        .map(|child| {
            let c = record(child, &what)?;
            Ok(ChildLink {
                person_id: read_id(c.get("personId").unwrap_or(&Value::Null), &what)?,
                kind: read_enum(c.get("type").unwrap_or(&Value::Null), &what)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Union {
        id: key.to_owned(),
        partners,
        status: read_enum(v.get("status").unwrap_or(&Value::Null), &what)?,
        start: optional(v, "start", |d| read_fuzzy_date(d, &what))?,
        end: optional(v, "end", |d| read_fuzzy_date(d, &what))?,
        children,
    })
}

/// Parses untrusted JSON into a valid tree, or refuses it.
pub fn parse_tree_document(text: &str) -> Result<TreeDocument> {
    let raw: Value = serde_json::from_str(text).map_err(|_| invalid("not JSON"))?;
    parse_tree_value(&raw)
}

pub fn parse_tree_value(raw: &Value) -> Result<TreeDocument> {
    let tree = record(raw, "The tree")?;
    match tree
        .get("schemaVersion")
        .map(|v| read_int(v, "schemaVersion"))
    {
        Some(Ok(v)) if v == i64::from(CURRENT_SCHEMA_VERSION) => {}
        _ => return Err(invalid("The tree has the wrong schema version")),
    }

    let mut persons = Map::new();
    for (key, value) in record(tree.get("persons").unwrap_or(&Value::Null), "The people")? {
        persons.insert(
            read_id(&Value::String(key.clone()), "A person key")?,
            read_person(key, value)?,
        );
    }
    let mut unions = Map::new();
    for (key, value) in record(tree.get("unions").unwrap_or(&Value::Null), "The unions")? {
        unions.insert(
            read_id(&Value::String(key.clone()), "A union key")?,
            read_union(key, value)?,
        );
    }
    let mut union_order = Map::new();
    for (key, value) in record(
        tree.get("unionOrder").unwrap_or(&Value::Null),
        "The union order",
    )? {
        let list = value
            .as_array()
            .ok_or_else(|| invalid("A union order is not a list"))?;
        let ids = list
            .iter()
            .map(|id| read_id(id, "A union order entry"))
            .collect::<Result<_>>()?;
        union_order.insert(
            read_id(&Value::String(key.clone()), "A union order key")?,
            ids,
        );
    }

    let settings = record(
        tree.get("settings").unwrap_or(&Value::Null),
        "The tree settings",
    )?;
    let field = |obj: &JsonMap<String, Value>, k: &str| obj.get(k).cloned().unwrap_or(Value::Null);
    let doc = TreeDocument {
        id: read_string(&field(tree, "id"), "The tree id")?,
        name: read_string(&field(tree, "name"), "The tree name")?,
        schema_version: CURRENT_SCHEMA_VERSION,
        root_person_id: optional(tree, "rootPersonId", |id| read_id(id, "The root person id"))?,
        persons,
        unions,
        union_order,
        settings: Settings {
            theme: read_string(&field(settings, "theme"), "The theme")?,
            color_mode: read_string(&field(settings, "colorMode"), "The color mode")?,
            direction: read_enum(&field(settings, "direction"), "The direction")?,
        },
        created_at: read_string(&field(tree, "createdAt"), "createdAt")?,
        updated_at: read_string(&field(tree, "updatedAt"), "updatedAt")?,
    };

    let doc = with_root(doc);
    let issues = validate(&doc);
    if !issues.is_empty() {
        return Err(invalid(format!("{} issue(s)", issues.len())));
    }
    Ok(doc)
}
