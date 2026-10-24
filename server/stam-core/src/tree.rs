//! Port of the queries in `src/core/model/tree.ts` that the commands and parser use. Iteration
//! order matches the TS (map insertion order), because results such as "the first union that
//! holds this child" depend on it. Queries return ids, so callers can mutate the document after.

use indexmap::IndexSet;

use crate::model::{ChildType, TreeDocument};

/// The person's unions, in `unionOrder` order (ids of unions that exist).
pub fn unions_of(doc: &TreeDocument, person_id: &str) -> Vec<String> {
    doc.union_order
        .get(person_id)
        .map(|order| {
            order
                .iter()
                .filter(|id| doc.unions.contains_key(*id))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// The union the person is a child of with the given link type, if any.
pub fn parent_union_of(doc: &TreeDocument, person_id: &str, kind: ChildType) -> Option<String> {
    doc.unions
        .values()
        .find(|u| {
            u.children
                .iter()
                .any(|c| c.person_id == person_id && c.kind == kind)
        })
        .map(|u| u.id.clone())
}

/// Children from every union, any link type, without duplicates.
pub fn children_of(doc: &TreeDocument, person_id: &str) -> Vec<String> {
    let mut seen = IndexSet::new();
    for union_id in unions_of(doc, person_id) {
        for child in &doc.unions[&union_id].children {
            seen.insert(child.person_id.clone());
        }
    }
    seen.into_iter().collect()
}

pub fn partners_of(doc: &TreeDocument, person_id: &str) -> Vec<String> {
    let mut seen = IndexSet::new();
    for union_id in unions_of(doc, person_id) {
        for partner in &doc.unions[&union_id].partners {
            if partner != person_id {
                seen.insert(partner.clone());
            }
        }
    }
    seen.into_iter().collect()
}

/// True when `ancestor_id` is a proper ancestor of `person_id` (any child type).
pub fn is_ancestor(doc: &TreeDocument, ancestor_id: &str, person_id: &str) -> bool {
    let mut seen = std::collections::HashSet::new();
    let mut stack = vec![ancestor_id.to_owned()];
    while let Some(current) = stack.pop() {
        for union_id in unions_of(doc, &current) {
            for child in &doc.unions[&union_id].children {
                if child.person_id == person_id {
                    return true;
                }
                if seen.insert(child.person_id.clone()) {
                    stack.push(child.person_id.clone());
                }
            }
        }
    }
    false
}

/// Every person below `person_id`, any child type, in the order the TS walk finds them.
pub fn descendants_of(doc: &TreeDocument, person_id: &str) -> IndexSet<String> {
    let mut seen = IndexSet::new();
    let mut stack = vec![person_id.to_owned()];
    while let Some(current) = stack.pop() {
        for union_id in unions_of(doc, &current) {
            for child in &doc.unions[&union_id].children {
                if seen.insert(child.person_id.clone()) {
                    stack.push(child.person_id.clone());
                }
            }
        }
    }
    seen.shift_remove(person_id);
    seen
}

/// Walks up through the first biological parent until a person has none.
pub fn topmost_ancestor(doc: &TreeDocument, person_id: &str) -> String {
    let mut seen = std::collections::HashSet::from([person_id.to_owned()]);
    let mut current = person_id.to_owned();
    loop {
        let parent = parent_union_of(doc, &current, ChildType::Biological)
            .and_then(|u| doc.unions[&u].partners.first().cloned());
        match parent {
            Some(p) if seen.insert(p.clone()) => current = p,
            _ => return current,
        }
    }
}

/// A tree with people but no root gets the topmost ancestor of its first person.
pub fn with_root(mut doc: TreeDocument) -> TreeDocument {
    if doc.root_person_id.is_none()
        && let Some(first) = doc.persons.keys().next().cloned()
    {
        doc.root_person_id = Some(topmost_ancestor(&doc, &first));
    }
    doc
}
