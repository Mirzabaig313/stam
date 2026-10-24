//! Port of `validActions.ts`: whether a new parent -> child link would close a loop, and why a drop
//! is not allowed.

use crate::error::ErrorCode;
use crate::model::{ChildType, TreeDocument};
use crate::tree::{is_ancestor, parent_union_of, partners_of, unions_of};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DropAction {
    Child,
    Spouse,
    Parent,
}

/// Every partner becomes a parent of `child_id`, so none may be it or descend from it.
pub fn union_accepts_child(doc: &TreeDocument, partners: &[String], child_id: &str) -> bool {
    partners
        .iter()
        .all(|p| p != child_id && !is_ancestor(doc, child_id, p))
}

/// `parent_id` may join the child's biological parent union (or a new one).
pub fn parent_can_join(doc: &TreeDocument, child_id: &str, parent_id: &str) -> bool {
    let children: Vec<String> = match parent_union_of(doc, child_id, ChildType::Biological) {
        Some(u) => doc.unions[&u]
            .children
            .iter()
            .map(|c| c.person_id.clone())
            .collect(),
        None => vec![child_id.to_owned()],
    };
    children
        .iter()
        .all(|id| id != parent_id && !is_ancestor(doc, id, parent_id))
}

pub fn usable_unions_for_child(
    doc: &TreeDocument,
    dragged_id: &str,
    parent_id: &str,
) -> Vec<String> {
    unions_of(doc, parent_id)
        .into_iter()
        .filter(|u| union_accepts_child(doc, &doc.unions[u].partners, dragged_id))
        .collect()
}

pub fn drop_blocker(
    doc: &TreeDocument,
    action: DropAction,
    dragged_id: &str,
    target_id: &str,
) -> Option<ErrorCode> {
    if dragged_id == target_id {
        return Some(ErrorCode::Cycle);
    }
    match action {
        DropAction::Child => {
            let target_unions = unions_of(doc, target_id);
            let possible = if target_unions.is_empty() {
                union_accepts_child(doc, &[target_id.to_owned()], dragged_id)
            } else {
                !usable_unions_for_child(doc, dragged_id, target_id).is_empty()
            };
            if !possible {
                return Some(ErrorCode::Cycle);
            }
            let linked = target_unions.iter().any(|u| {
                doc.unions[u]
                    .children
                    .iter()
                    .any(|c| c.person_id == dragged_id)
            });
            linked.then_some(ErrorCode::AlreadyLinked)
        }
        DropAction::Spouse => {
            if is_ancestor(doc, dragged_id, target_id) || is_ancestor(doc, target_id, dragged_id) {
                return Some(ErrorCode::Cycle);
            }
            partners_of(doc, target_id)
                .iter()
                .any(|p| p == dragged_id)
                .then_some(ErrorCode::AlreadyLinked)
        }
        DropAction::Parent => {
            if !parent_can_join(doc, target_id, dragged_id) {
                return Some(ErrorCode::Cycle);
            }
            let already = unions_of(doc, dragged_id).iter().any(|u| {
                doc.unions[u]
                    .children
                    .iter()
                    .any(|c| c.person_id == target_id)
            });
            if already {
                return Some(ErrorCode::AlreadyLinked);
            }
            let full = parent_union_of(doc, target_id, ChildType::Biological)
                .is_some_and(|u| doc.unions[&u].partners.len() >= 2);
            full.then_some(ErrorCode::ParentsFull)
        }
    }
}
