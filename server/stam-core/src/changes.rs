//! Port of `src/sync/changes.ts`: an op's effect, entity by entity, in the same JSON shape.

use serde::{Deserialize, Serialize};

use crate::model::{Map, Person, TreeDocument, Union};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeChanges {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Absent: unchanged. `null`: the root was removed.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "::serde_with::rust::double_option"
    )]
    pub root_person_id: Option<Option<String>>,
    pub updated_at: String,
}

/// `None` (JSON `null`) removes the entity.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub persons: Map<Option<Person>>,
    pub unions: Map<Option<Union>>,
    pub union_order: Map<Option<Vec<String>>>,
    pub tree: TreeChanges,
}

fn diff_map<T: Clone + PartialEq>(before: &Map<T>, after: &Map<T>) -> Map<Option<T>> {
    let mut out = Map::new();
    for (id, value) in after {
        if before.get(id) != Some(value) {
            out.insert(id.clone(), Some(value.clone()));
        }
    }
    for id in before.keys() {
        if !after.contains_key(id) {
            out.insert(id.clone(), None);
        }
    }
    out
}

/// New entities in `after`'s order, then removals; tree fields only when they changed.
pub fn diff_docs(before: &TreeDocument, after: &TreeDocument) -> Changes {
    Changes {
        persons: diff_map(&before.persons, &after.persons),
        unions: diff_map(&before.unions, &after.unions),
        union_order: diff_map(&before.union_order, &after.union_order),
        tree: TreeChanges {
            name: (after.name != before.name).then(|| after.name.clone()),
            root_person_id: (after.root_person_id != before.root_person_id)
                .then(|| after.root_person_id.clone()),
            updated_at: after.updated_at.clone(),
        },
    }
}

/// `null` removes (keeping the others' order), an existing key is replaced in place, a new key
/// is appended in the order `changes` lists it.
pub fn apply_map<T: Clone>(map: &mut Map<T>, changes: &Map<Option<T>>) {
    for (id, value) in changes {
        match value {
            None => {
                map.shift_remove(id);
            }
            Some(v) => {
                map.insert(id.clone(), v.clone());
            }
        }
    }
}

pub fn apply_changes(doc: &mut TreeDocument, changes: &Changes) {
    apply_map(&mut doc.persons, &changes.persons);
    apply_map(&mut doc.unions, &changes.unions);
    apply_map(&mut doc.union_order, &changes.union_order);
    if let Some(name) = &changes.tree.name {
        doc.name.clone_from(name);
    }
    if let Some(root) = &changes.tree.root_person_id {
        doc.root_person_id.clone_from(root);
    }
    doc.updated_at.clone_from(&changes.tree.updated_at);
}
