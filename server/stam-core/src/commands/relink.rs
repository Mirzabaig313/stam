//! Port of `relink.ts` and `remove.ts`.

use indexmap::IndexSet;

use super::Ctx;
use super::decode::DeleteMode;
use super::relations::{link_child, link_parent, link_spouse, move_root_up};
use super::union_order::require_person;
use super::valid_actions::{DropAction, drop_blocker};
use crate::error::{CommandError, err};
use crate::model::{ChildType, TreeDocument, UnionStatus};
use crate::tree::{children_of, descendants_of, parent_union_of, partners_of};

type Result = std::result::Result<(), CommandError>;

/// Same rules the drop menu uses, so a command can never do what the menu would not offer.
fn assert_drop_allowed(
    doc: &TreeDocument,
    action: DropAction,
    dragged: &str,
    target: &str,
) -> Result {
    require_person(doc, dragged)?;
    require_person(doc, target)?;
    match drop_blocker(doc, action, dragged, target) {
        Some(code) => err(code),
        None => Ok(()),
    }
}

pub fn relink_as_child(
    doc: &mut TreeDocument,
    person_id: &str,
    parent_id: &str,
    union_id: Option<&str>,
    ctx: &mut Ctx,
) -> Result {
    assert_drop_allowed(doc, DropAction::Child, person_id, parent_id)?;
    // Only the biological link moves; adopted, step and foster links stay where they are.
    if let Some(old) = parent_union_of(doc, person_id, ChildType::Biological) {
        let children = &mut doc.unions.get_mut(&old).unwrap().children;
        if let Some(index) = children
            .iter()
            .position(|c| c.person_id == person_id && c.kind == ChildType::Biological)
        {
            children.remove(index);
        }
    }
    let union_id = link_child(
        doc,
        parent_id,
        union_id,
        person_id,
        ChildType::Biological,
        ctx,
    )?;
    move_root_up(doc, person_id, &union_id);
    Ok(())
}

pub fn relink_as_spouse(
    doc: &mut TreeDocument,
    person_id: &str,
    target_id: &str,
    ctx: &mut Ctx,
) -> Result {
    assert_drop_allowed(doc, DropAction::Spouse, person_id, target_id)?;
    link_spouse(doc, target_id, person_id, UnionStatus::Married, false, ctx)
}

pub fn relink_as_parent(
    doc: &mut TreeDocument,
    person_id: &str,
    child_id: &str,
    ctx: &mut Ctx,
) -> Result {
    assert_drop_allowed(doc, DropAction::Parent, person_id, child_id)?;
    link_parent(doc, child_id, person_id, ctx)
}

/// Old root's first remaining partner, else first remaining child, else first remaining person.
fn successor_root(
    doc: &TreeDocument,
    old_root: &str,
    removed: &IndexSet<String>,
) -> Option<String> {
    let remaining = |id: &String| !removed.contains(id);
    partners_of(doc, old_root)
        .into_iter()
        .find(remaining)
        .or_else(|| children_of(doc, old_root).into_iter().find(remaining))
        .or_else(|| doc.persons.keys().find(|id| remaining(id)).cloned())
}

pub fn delete_person(doc: &mut TreeDocument, person_id: &str, mode: DeleteMode) -> Result {
    require_person(doc, person_id)?;
    let mut removed = IndexSet::from([person_id.to_owned()]);
    if mode == DeleteMode::WithDescendants {
        removed.extend(descendants_of(doc, person_id));
    }
    let next_root = match &doc.root_person_id {
        Some(root) if removed.contains(root) => successor_root(doc, root, &removed),
        other => other.clone(),
    };

    let union_ids: Vec<String> = doc.unions.keys().cloned().collect();
    for union_id in union_ids {
        let union = doc.unions.get_mut(&union_id).unwrap();
        let partners: Vec<String> = union
            .partners
            .iter()
            .filter(|p| !removed.contains(*p))
            .cloned()
            .collect();
        if partners.is_empty() {
            // No partner left: the union goes, and its children lose that parent link.
            doc.unions.shift_remove(&union_id);
            continue;
        }
        if partners.len() != union.partners.len() {
            union.partners = partners;
        }
        union.children.retain(|c| !removed.contains(&c.person_id));
    }
    for id in &removed {
        doc.persons.shift_remove(id);
        doc.union_order.shift_remove(id);
    }
    doc.root_person_id = next_root;
    Ok(())
}
