//! Port of `src/core/commands`: the only way the server changes a tree.

mod decode;
mod people;
mod relations;
mod relink;
mod union_order;
mod valid_actions;

pub use decode::{Command, DeleteMode, Field, PersonPatch, UnionPatch, decode_command};

use crate::changes::{Changes, diff_docs};
use crate::error::{CommandError, ErrorCode, err};
use crate::ids::op_id_source;
use crate::model::TreeDocument;
use crate::validate::validate;

/// What the handlers share while one command runs.
pub struct Ctx {
    pub created: Vec<String>,
    pub new_id: Box<dyn FnMut() -> Result<String, CommandError>>,
}

/// An applied command: the new document, what changed, and the persons it created.
#[derive(Clone, Debug, PartialEq)]
pub struct Applied {
    pub doc: TreeDocument,
    pub changes: Changes,
    pub created_ids: Vec<String>,
}

fn dispatch(doc: &mut TreeDocument, cmd: &Command, ctx: &mut Ctx) -> Result<(), CommandError> {
    use Command::*;
    match cmd {
        AddPerson { person } => people::add_person(doc, person, ctx),
        UpdatePerson { person_id, patch } => people::update_person(doc, person_id, patch),
        UpdateUnion { union_id, patch } => people::update_union(doc, union_id, patch),
        SetRoot { person_id } => people::set_root(doc, person_id),
        RenameTree { name } => people::rename_tree(doc, name),
        AddChild {
            parent_id,
            union_id,
            child,
            child_type,
        } => relations::add_child(doc, parent_id, union_id.as_deref(), child, *child_type, ctx),
        AddSpouse {
            person_id,
            spouse,
            status,
        } => relations::add_spouse(doc, person_id, spouse, *status, ctx),
        AddParent { child_id, parent } => relations::add_parent(doc, child_id, parent, ctx),
        InsertParent {
            child_id,
            parent,
            union_id,
        } => relations::insert_parent(doc, child_id, parent, union_id.as_deref(), ctx),
        AddSibling { person_id, sibling } => relations::add_sibling(doc, person_id, sibling, ctx),
        ReorderChild {
            union_id,
            person_id,
            to_index,
        } => relations::reorder_child(doc, union_id, person_id, *to_index),
        SetChildType {
            union_id,
            person_id,
            child_type,
        } => relations::set_child_type(doc, union_id, person_id, *child_type),
        RelinkAsChild {
            person_id,
            parent_id,
            union_id,
        } => relink::relink_as_child(doc, person_id, parent_id, union_id.as_deref(), ctx),
        RelinkAsSpouse {
            person_id,
            target_id,
        } => relink::relink_as_spouse(doc, person_id, target_id, ctx),
        RelinkAsParent {
            person_id,
            child_id,
        } => relink::relink_as_parent(doc, person_id, child_id, ctx),
        DeletePerson { person_id, mode } => relink::delete_person(doc, person_id, *mode),
    }
}

/// Applies `cmd` to a copy of `doc`, creating ids from `op_id` and stamping `now` (an ISO string
/// from JS `toISOString`). Refuses, leaving `doc` as it was, when a rule says no or the result
/// would fail `validate` (INVALID).
pub fn apply_command(
    doc: &TreeDocument,
    cmd: &Command,
    now: &str,
    op_id: &str,
) -> Result<Applied, CommandError> {
    let mut ctx = Ctx {
        created: Vec::new(),
        new_id: Box::new(op_id_source(op_id)?),
    };
    let mut next = doc.clone();
    dispatch(&mut next, cmd, &mut ctx)?;
    next.updated_at = now.to_owned();
    if !validate(&next).is_empty() {
        return err(ErrorCode::Invalid);
    }
    let changes = diff_docs(doc, &next);
    Ok(Applied {
        doc: next,
        changes,
        created_ids: ctx.created,
    })
}
