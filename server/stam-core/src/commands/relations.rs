//! Port of `relations.ts`. Helpers return union ids so the caller can keep mutating the document.

use std::cmp::Ordering;

use super::Ctx;
use super::decode::PersonPatch;
use super::people::add_new_person;
use super::union_order::{insert_union_in_order, require_person, require_union};
use super::valid_actions::{parent_can_join, union_accepts_child};
use crate::dates::{compare_fuzzy_date, dated_year};
use crate::error::{CommandError, ErrorCode, err};
use crate::model::{ChildLink, ChildType, Gender, TreeDocument, Union, UnionStatus};
use crate::tree::{parent_union_of, unions_of};

type Result<T = ()> = std::result::Result<T, CommandError>;

fn link(person_id: &str, kind: ChildType) -> ChildLink {
    ChildLink {
        person_id: person_id.to_owned(),
        kind,
    }
}

pub fn create_union(
    doc: &mut TreeDocument,
    partners: Vec<String>,
    status: UnionStatus,
    children: Vec<ChildLink>,
    ctx: &mut Ctx,
) -> Result<String> {
    let id = (ctx.new_id)()?;
    let union = Union {
        id: id.clone(),
        partners: partners.clone(),
        status,
        start: None,
        end: None,
        children,
    };
    doc.unions.insert(id.clone(), union);
    for partner in &partners {
        insert_union_in_order(doc, partner, &id);
    }
    Ok(id)
}

/// FR-R8: before the first sibling born later; undated children go last.
fn child_insert_index(doc: &TreeDocument, union_id: &str, child_id: &str) -> usize {
    let union = &doc.unions[union_id];
    let birth = |id: &str| {
        doc.persons
            .get(id)
            .and_then(|p| p.birth.as_ref())
            .and_then(|b| b.date.as_ref())
    };
    let Some(born) = dated_year(birth(child_id)) else {
        return union.children.len();
    };
    union
        .children
        .iter()
        .position(|c| {
            let other = dated_year(birth(&c.person_id));
            other.is_some() && compare_fuzzy_date(other, Some(born)) == Ordering::Greater
        })
        .unwrap_or(union.children.len())
}

fn resolve_parent_union(
    doc: &mut TreeDocument,
    parent_id: &str,
    union_id: Option<&str>,
    ctx: &mut Ctx,
) -> Result<String> {
    if let Some(union_id) = union_id {
        require_union(doc, union_id)?;
        if !doc.unions[union_id].partners.iter().any(|p| p == parent_id) {
            return err(ErrorCode::Invalid);
        }
        return Ok(union_id.to_owned());
    }
    let unions = unions_of(doc, parent_id);
    match unions.len() {
        0 => create_union(
            doc,
            vec![parent_id.to_owned()],
            UnionStatus::Partner,
            vec![],
            ctx,
        ),
        1 => Ok(unions[0].clone()),
        _ => err(ErrorCode::AmbiguousUnion),
    }
}

/// Makes an existing person a child of `parent_id` (in `union_id`, or the only/new union).
pub fn link_child(
    doc: &mut TreeDocument,
    parent_id: &str,
    union_id: Option<&str>,
    child_id: &str,
    kind: ChildType,
    ctx: &mut Ctx,
) -> Result<String> {
    require_person(doc, parent_id)?;
    require_person(doc, child_id)?;
    let union_id = resolve_parent_union(doc, parent_id, union_id, ctx)?;
    if !union_accepts_child(doc, &doc.unions[&union_id].partners, child_id) {
        return err(ErrorCode::Cycle);
    }
    if doc.unions[&union_id]
        .children
        .iter()
        .any(|c| c.person_id == child_id)
    {
        return err(ErrorCode::AlreadyLinked);
    }
    if kind == ChildType::Biological
        && parent_union_of(doc, child_id, ChildType::Biological).is_some()
    {
        return err(ErrorCode::Invalid);
    }
    let at = child_insert_index(doc, &union_id, child_id);
    doc.unions
        .get_mut(&union_id)
        .unwrap()
        .children
        .insert(at, link(child_id, kind));
    Ok(union_id)
}

pub fn link_spouse(
    doc: &mut TreeDocument,
    person_id: &str,
    spouse_id: &str,
    status: UnionStatus,
    fill_single_parent_union: bool,
    ctx: &mut Ctx,
) -> Result {
    let single = if fill_single_parent_union {
        unions_of(doc, person_id)
            .into_iter()
            .find(|u| doc.unions[u].partners.len() == 1)
    } else {
        None
    };
    match single {
        Some(union_id) => {
            let union = doc.unions.get_mut(&union_id).unwrap();
            union.partners = vec![person_id.to_owned(), spouse_id.to_owned()];
            union.status = status;
            insert_union_in_order(doc, spouse_id, &union_id);
        }
        None => {
            create_union(
                doc,
                vec![person_id.to_owned(), spouse_id.to_owned()],
                status,
                vec![],
                ctx,
            )?;
        }
    }
    Ok(())
}

/// Root stays on top: the root moves to the new parent union's first partner.
pub fn move_root_up(doc: &mut TreeDocument, child_id: &str, union_id: &str) {
    if doc.root_person_id.as_deref() == Some(child_id) {
        doc.root_person_id = doc.unions[union_id].partners.first().cloned();
    }
}

/// Makes an existing person a biological parent of `child_id`.
pub fn link_parent(
    doc: &mut TreeDocument,
    child_id: &str,
    parent_id: &str,
    ctx: &mut Ctx,
) -> Result {
    require_person(doc, child_id)?;
    require_person(doc, parent_id)?;
    if !parent_can_join(doc, child_id, parent_id) {
        return err(ErrorCode::Cycle);
    }
    let union_id = match parent_union_of(doc, child_id, ChildType::Biological) {
        None => create_union(
            doc,
            vec![parent_id.to_owned()],
            UnionStatus::Partner,
            vec![link(child_id, ChildType::Biological)],
            ctx,
        )?,
        Some(union_id) => {
            let union = doc.unions.get_mut(&union_id).unwrap();
            if union.partners.iter().any(|p| p == parent_id) {
                return err(ErrorCode::AlreadyLinked);
            }
            if union.partners.len() >= 2 {
                return err(ErrorCode::ParentsFull);
            }
            union.partners = vec![union.partners[0].clone(), parent_id.to_owned()];
            union.status = UnionStatus::Married;
            insert_union_in_order(doc, parent_id, &union_id);
            union_id
        }
    };
    move_root_up(doc, child_id, &union_id);
    Ok(())
}

pub fn add_child(
    doc: &mut TreeDocument,
    parent_id: &str,
    union_id: Option<&str>,
    child: &PersonPatch,
    kind: Option<ChildType>,
    ctx: &mut Ctx,
) -> Result {
    require_person(doc, parent_id)?;
    let child_id = add_new_person(doc, child, ctx)?;
    link_child(
        doc,
        parent_id,
        union_id,
        &child_id,
        kind.unwrap_or(ChildType::Biological),
        ctx,
    )?;
    Ok(())
}

pub fn add_spouse(
    doc: &mut TreeDocument,
    person_id: &str,
    spouse: &PersonPatch,
    status: Option<UnionStatus>,
    ctx: &mut Ctx,
) -> Result {
    require_person(doc, person_id)?;
    let spouse_id = add_new_person(doc, spouse, ctx)?;
    link_spouse(
        doc,
        person_id,
        &spouse_id,
        status.unwrap_or(UnionStatus::Married),
        true,
        ctx,
    )
}

pub fn add_parent(
    doc: &mut TreeDocument,
    child_id: &str,
    parent: &PersonPatch,
    ctx: &mut Ctx,
) -> Result {
    require_person(doc, child_id)?;
    let parent_id = add_new_person(doc, parent, ctx)?;
    link_parent(doc, child_id, &parent_id, ctx)
}

pub fn insert_parent(
    doc: &mut TreeDocument,
    child_id: &str,
    parent: &PersonPatch,
    union_id: Option<&str>,
    ctx: &mut Ctx,
) -> Result {
    require_person(doc, child_id)?;
    let union_id = match union_id {
        Some(id) => {
            require_union(doc, id)?;
            Some(id.to_owned())
        }
        None => parent_union_of(doc, child_id, ChildType::Biological),
    };
    // No parents yet (the root, for one): there is nothing to go between, so it is addParent.
    let Some(union_id) = union_id else {
        let parent_id = add_new_person(doc, parent, ctx)?;
        return link_parent(doc, child_id, &parent_id, ctx);
    };
    let Some(index) = doc.unions[&union_id]
        .children
        .iter()
        .position(|c| c.person_id == child_id)
    else {
        return err(ErrorCode::NotFound);
    };
    let kind = doc.unions[&union_id].children[index].kind;
    if kind != ChildType::Biological
        && parent_union_of(doc, child_id, ChildType::Biological).is_some()
    {
        return err(ErrorCode::Invalid);
    }
    let parent_id = add_new_person(doc, parent, ctx)?;
    doc.unions.get_mut(&union_id).unwrap().children[index] = link(&parent_id, kind);
    create_union(
        doc,
        vec![parent_id],
        UnionStatus::Partner,
        vec![link(child_id, ChildType::Biological)],
        ctx,
    )?;
    Ok(())
}

pub fn add_sibling(
    doc: &mut TreeDocument,
    person_id: &str,
    sibling: &PersonPatch,
    ctx: &mut Ctx,
) -> Result {
    require_person(doc, person_id)?;
    let sibling_id = add_new_person(doc, sibling, ctx)?;
    if let Some(union_id) = parent_union_of(doc, person_id, ChildType::Biological) {
        doc.unions
            .get_mut(&union_id)
            .unwrap()
            .children
            .push(link(&sibling_id, ChildType::Biological));
        return Ok(());
    }
    // FR-R5/R6: no parents yet, so stand-ins hold the family together until the user names them.
    let placeholder = |gender| PersonPatch {
        gender: Some(Some(gender)),
        is_placeholder: Some(Some(true)),
        is_living: Some(Some(true)),
        ..PersonPatch::default()
    };
    let father = add_new_person(doc, &placeholder(Gender::Male), ctx)?;
    let mother = add_new_person(doc, &placeholder(Gender::Female), ctx)?;
    let union_id = create_union(
        doc,
        vec![father, mother],
        UnionStatus::Married,
        vec![
            link(person_id, ChildType::Biological),
            link(&sibling_id, ChildType::Biological),
        ],
        ctx,
    )?;
    move_root_up(doc, person_id, &union_id);
    Ok(())
}

pub fn reorder_child(
    doc: &mut TreeDocument,
    union_id: &str,
    person_id: &str,
    to_index: f64,
) -> Result {
    require_union(doc, union_id)?;
    if !to_index.is_finite() {
        return err(ErrorCode::Invalid);
    }
    let union = doc.unions.get_mut(union_id).unwrap();
    let Some(from) = union.children.iter().position(|c| c.person_id == person_id) else {
        return err(ErrorCode::NotFound);
    };
    let last = (union.children.len() - 1) as f64;
    let to = to_index.trunc().max(0.0).min(last) as usize;
    let moved = union.children.remove(from);
    union.children.insert(to, moved);
    Ok(())
}

pub fn set_child_type(
    doc: &mut TreeDocument,
    union_id: &str,
    person_id: &str,
    kind: ChildType,
) -> Result {
    require_union(doc, union_id)?;
    let Some(index) = doc.unions[union_id]
        .children
        .iter()
        .position(|c| c.person_id == person_id)
    else {
        return err(ErrorCode::NotFound);
    };
    if kind == ChildType::Biological
        && let Some(bio) = parent_union_of(doc, person_id, ChildType::Biological)
        && bio != union_id
    {
        return err(ErrorCode::Invalid);
    }
    doc.unions.get_mut(union_id).unwrap().children[index].kind = kind;
    Ok(())
}
