//! Port of `decodeCommand` in `src/sync/wire.ts`: reads a command from untrusted JSON, checking
//! every field it uses and dropping unknown ones. In a patch, `null` means "remove the field";
//! elsewhere an optional `null` means "not given".

use serde_json::{Map as JsonMap, Value};

use crate::error::{CommandError, ErrorCode};
use crate::model::*;
use crate::parse::{read_bool, read_enum, read_id, read_int, read_string, record};

/// A field in a patch: absent, removed (`null`), or set.
pub type Field<T> = Option<Option<T>>;

/// A person patch (`updatePerson`) or input (the `add*` commands, which never remove).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PersonPatch {
    pub first_name: Field<String>,
    pub last_name: Field<String>,
    pub nickname: Field<String>,
    pub native_name: Field<String>,
    pub gender: Field<Gender>,
    pub is_placeholder: Field<bool>,
    pub is_living: Field<bool>,
    pub birth: Field<Event>,
    pub death: Field<Event>,
    pub photo_id: Field<String>,
    pub notes: Field<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct UnionPatch {
    pub status: Option<UnionStatus>,
    pub start: Field<FuzzyDate>,
    pub end: Field<FuzzyDate>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeleteMode {
    Person,
    WithDescendants,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    AddPerson {
        person: PersonPatch,
    },
    UpdatePerson {
        person_id: String,
        patch: PersonPatch,
    },
    UpdateUnion {
        union_id: String,
        patch: UnionPatch,
    },
    SetRoot {
        person_id: String,
    },
    RenameTree {
        name: String,
    },
    AddChild {
        parent_id: String,
        union_id: Option<String>,
        child: PersonPatch,
        child_type: Option<ChildType>,
    },
    AddSpouse {
        person_id: String,
        spouse: PersonPatch,
        status: Option<UnionStatus>,
    },
    AddParent {
        child_id: String,
        parent: PersonPatch,
    },
    InsertParent {
        child_id: String,
        parent: PersonPatch,
        union_id: Option<String>,
    },
    AddSibling {
        person_id: String,
        sibling: PersonPatch,
    },
    ReorderChild {
        union_id: String,
        person_id: String,
        to_index: f64,
    },
    SetChildType {
        union_id: String,
        person_id: String,
        child_type: ChildType,
    },
    RelinkAsChild {
        person_id: String,
        parent_id: String,
        union_id: Option<String>,
    },
    RelinkAsSpouse {
        person_id: String,
        target_id: String,
    },
    RelinkAsParent {
        person_id: String,
        child_id: String,
    },
    DeletePerson {
        person_id: String,
        mode: DeleteMode,
    },
}

type Result<T> = std::result::Result<T, CommandError>;

fn bad<T>() -> Result<T> {
    Err(CommandError::new(ErrorCode::Invalid))
}

fn ok<T, E>(r: std::result::Result<T, E>) -> Result<T> {
    r.or_else(|_| bad())
}

fn get<'a>(obj: &'a JsonMap<String, Value>, key: &str) -> &'a Value {
    obj.get(key).unwrap_or(&Value::Null)
}

fn id(obj: &JsonMap<String, Value>, key: &str) -> Result<String> {
    ok(read_id(get(obj, key), key))
}

/// Absent and null optional fields are both "not given".
fn opt<T>(
    obj: &JsonMap<String, Value>,
    key: &str,
    read: impl FnOnce(&Value) -> Result<T>,
) -> Result<Option<T>> {
    match obj.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => read(v).map(Some),
    }
}

/// In a patch: absent is None, null is Some(None), a value is Some(Some(..)).
fn field<T>(
    obj: &JsonMap<String, Value>,
    key: &str,
    read: impl FnOnce(&Value) -> Result<T>,
) -> Result<Field<T>> {
    match obj.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(v) => read(v).map(|x| Some(Some(x))),
    }
}

/// A date in a command: unlike in a stored tree, a null field means "not given".
fn fuzzy_date(v: &Value) -> Result<FuzzyDate> {
    let o = ok(record(v, "date"))?;
    let int = |v: &Value| ok(read_int(v, "number"));
    Ok(FuzzyDate {
        qualifier: opt(o, "qualifier", enumerated)?,
        year: opt(o, "year", int)?,
        month: opt(o, "month", int)?,
        day: opt(o, "day", int)?,
        to_year: opt(o, "toYear", int)?,
    })
}

fn event(v: &Value) -> Result<Event> {
    let o = ok(record(v, "event"))?;
    Ok(Event {
        date: opt(o, "date", fuzzy_date)?,
        place: opt(o, "place", |p| ok(read_string(p, "place")))?,
    })
}

fn person_patch(v: &Value) -> Result<PersonPatch> {
    let o = ok(record(v, "patch"))?;
    let s = |v: &Value| ok(read_string(v, "string"));
    let b = |v: &Value| ok(read_bool(v, "bool"));
    Ok(PersonPatch {
        first_name: field(o, "firstName", s)?,
        last_name: field(o, "lastName", s)?,
        nickname: field(o, "nickname", s)?,
        native_name: field(o, "nativeName", s)?,
        gender: field(o, "gender", |v| ok(read_enum(v, "gender")))?,
        is_placeholder: field(o, "isPlaceholder", b)?,
        is_living: field(o, "isLiving", b)?,
        birth: field(o, "birth", event)?,
        death: field(o, "death", event)?,
        photo_id: field(o, "photoId", |v| ok(read_id(v, "photoId")))?,
        notes: field(o, "notes", s)?,
    })
}

/// A new person's fields: like a patch, but null means "not given" and gender is required.
fn person_input(v: &Value) -> Result<PersonPatch> {
    let mut input = person_patch(v)?;
    for f in [
        &mut input.first_name,
        &mut input.last_name,
        &mut input.nickname,
        &mut input.native_name,
        &mut input.photo_id,
        &mut input.notes,
    ] {
        if *f == Some(None) {
            *f = None;
        }
    }
    for f in [&mut input.is_placeholder, &mut input.is_living] {
        if *f == Some(None) {
            *f = None;
        }
    }
    for f in [&mut input.birth, &mut input.death] {
        if *f == Some(None) {
            *f = None;
        }
    }
    match input.gender {
        Some(Some(_)) => Ok(input),
        _ => bad(),
    }
}

fn enumerated<T: serde::de::DeserializeOwned>(v: &Value) -> Result<T> {
    ok(read_enum(v, "enum"))
}

pub fn decode_command(raw: &Value) -> Result<Command> {
    let c = ok(record(raw, "body"))?;
    let opt_id = |key: &str| opt(c, key, |v| ok(read_id(v, key)));
    Ok(match c.get("type").and_then(Value::as_str) {
        Some("addPerson") => Command::AddPerson {
            person: person_input(get(c, "person"))?,
        },
        Some("updatePerson") => Command::UpdatePerson {
            person_id: id(c, "personId")?,
            patch: person_patch(get(c, "patch"))?,
        },
        Some("updateUnion") => {
            let o = ok(record(get(c, "patch"), "patch"))?;
            Command::UpdateUnion {
                union_id: id(c, "unionId")?,
                patch: UnionPatch {
                    status: opt(o, "status", enumerated)?,
                    start: field(o, "start", fuzzy_date)?,
                    end: field(o, "end", fuzzy_date)?,
                },
            }
        }
        Some("setRoot") => Command::SetRoot {
            person_id: id(c, "personId")?,
        },
        Some("renameTree") => Command::RenameTree {
            name: ok(read_string(get(c, "name"), "name"))?,
        },
        Some("addChild") => Command::AddChild {
            parent_id: id(c, "parentId")?,
            union_id: opt_id("unionId")?,
            child: person_input(get(c, "child"))?,
            child_type: opt(c, "childType", enumerated)?,
        },
        Some("addSpouse") => Command::AddSpouse {
            person_id: id(c, "personId")?,
            spouse: person_input(get(c, "spouse"))?,
            status: opt(c, "status", enumerated)?,
        },
        Some("addParent") => Command::AddParent {
            child_id: id(c, "childId")?,
            parent: person_input(get(c, "parent"))?,
        },
        Some("insertParent") => Command::InsertParent {
            child_id: id(c, "childId")?,
            parent: person_input(get(c, "parent"))?,
            union_id: opt_id("unionId")?,
        },
        Some("addSibling") => Command::AddSibling {
            person_id: id(c, "personId")?,
            sibling: person_input(get(c, "sibling"))?,
        },
        Some("reorderChild") => Command::ReorderChild {
            union_id: id(c, "unionId")?,
            person_id: id(c, "personId")?,
            to_index: match get(c, "toIndex").as_f64() {
                Some(n) => n,
                None => return bad(),
            },
        },
        Some("setChildType") => Command::SetChildType {
            union_id: id(c, "unionId")?,
            person_id: id(c, "personId")?,
            child_type: enumerated(get(c, "childType"))?,
        },
        Some("relinkAsChild") => Command::RelinkAsChild {
            person_id: id(c, "personId")?,
            parent_id: id(c, "parentId")?,
            union_id: opt_id("unionId")?,
        },
        Some("relinkAsSpouse") => Command::RelinkAsSpouse {
            person_id: id(c, "personId")?,
            target_id: id(c, "targetId")?,
        },
        Some("relinkAsParent") => Command::RelinkAsParent {
            person_id: id(c, "personId")?,
            child_id: id(c, "childId")?,
        },
        Some("deletePerson") => Command::DeletePerson {
            person_id: id(c, "personId")?,
            mode: match get(c, "mode").as_str() {
                Some("person") => DeleteMode::Person,
                Some("withDescendants") => DeleteMode::WithDescendants,
                _ => return bad(),
            },
        },
        _ => return bad(),
    })
}
