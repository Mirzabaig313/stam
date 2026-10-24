//! The tree document, in the same JSON shape as `src/core/model/types.ts`.
//!
//! Maps are `IndexMap`s because the commands depend on insertion order, as JS objects do: a
//! removal must use `shift_remove`, never `swap_remove`.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

pub type Map<V> = IndexMap<String, V>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Gender {
    Male,
    Female,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Qualifier {
    About,
    Before,
    After,
    Between,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnionStatus {
    Married,
    Partner,
    Engaged,
    Divorced,
    Separated,
    Widowed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChildType {
    Biological,
    Adopted,
    Step,
    Foster,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Ltr,
    Rtl,
}

/// Numbers are whole (the parser checks); `i64` holds every whole number a JS client can send
/// below 2^53.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FuzzyDate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qualifier: Option<Qualifier>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub month: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_year: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Event {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<FuzzyDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_name: Option<String>,
    pub gender: Gender,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_placeholder: Option<bool>,
    pub is_living: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub birth: Option<Event>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub death: Option<Event>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photo_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildLink {
    pub person_id: String,
    #[serde(rename = "type")]
    pub kind: ChildType,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Union {
    pub id: String,
    /// One or two person ids (the parser checks).
    pub partners: Vec<String>,
    pub status: UnionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<FuzzyDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<FuzzyDate>,
    /// Array order is sibling order.
    pub children: Vec<ChildLink>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub color_mode: String,
    pub direction: Direction,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeDocument {
    pub id: String,
    pub name: String,
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_person_id: Option<String>,
    pub persons: Map<Person>,
    pub unions: Map<Union>,
    /// personId -> ordered union ids.
    pub union_order: Map<Vec<String>>,
    pub settings: Settings,
    pub created_at: String,
    pub updated_at: String,
}
