//! Port of `people.ts`.

use super::Ctx;
use super::decode::{PersonPatch, UnionPatch};
use super::union_order::{insert_union_in_order, require_person, require_union};
use crate::dates::{js_trim, same_fuzzy_date};
use crate::error::{CommandError, ErrorCode, err};
use crate::model::{Gender, Person, TreeDocument};

type Result = std::result::Result<(), CommandError>;

/// Sets a patch field by field. A removal (`Some(None)`) clears an optional field; the required
/// fields (`firstName`, `lastName`, `gender`, `isLiving`) ignore removal, as in TS `assignPatch`.
fn assign_patch(person: &mut Person, patch: &PersonPatch) {
    fn set<T: Clone>(target: &mut Option<T>, field: &Option<Option<T>>) {
        if let Some(value) = field {
            target.clone_from(value);
        }
    }
    if let Some(Some(v)) = &patch.first_name {
        person.first_name.clone_from(v);
    }
    if let Some(Some(v)) = &patch.last_name {
        person.last_name.clone_from(v);
    }
    if let Some(Some(v)) = patch.gender {
        person.gender = v;
    }
    if let Some(Some(v)) = patch.is_living {
        person.is_living = v;
    }
    set(&mut person.nickname, &patch.nickname);
    set(&mut person.native_name, &patch.native_name);
    set(&mut person.is_placeholder, &patch.is_placeholder);
    set(&mut person.birth, &patch.birth);
    set(&mut person.death, &patch.death);
    set(&mut person.photo_id, &patch.photo_id);
    set(&mut person.notes, &patch.notes);
}

pub fn build_person(input: &PersonPatch, id: String) -> Person {
    let mut person = Person {
        id,
        first_name: String::new(),
        last_name: String::new(),
        nickname: None,
        native_name: None,
        gender: input.gender.flatten().unwrap_or(Gender::Male),
        is_placeholder: None,
        is_living: true,
        birth: None,
        death: None,
        photo_id: None,
        notes: None,
    };
    assign_patch(&mut person, input);
    person
}

/// Builds the person, adds it and records it as created; returns its id.
pub fn add_new_person(
    doc: &mut TreeDocument,
    input: &PersonPatch,
    ctx: &mut Ctx,
) -> std::result::Result<String, CommandError> {
    let person = build_person(input, (ctx.new_id)()?);
    let id = person.id.clone();
    doc.persons.insert(id.clone(), person);
    ctx.created.push(id.clone());
    Ok(id)
}

pub fn add_person(doc: &mut TreeDocument, input: &PersonPatch, ctx: &mut Ctx) -> Result {
    let id = add_new_person(doc, input, ctx)?;
    if doc.root_person_id.is_none() {
        doc.root_person_id = Some(id);
    }
    Ok(())
}

pub fn update_person(doc: &mut TreeDocument, person_id: &str, patch: &PersonPatch) -> Result {
    require_person(doc, person_id)?;
    let person = doc.persons.get_mut(person_id).unwrap();
    let names = [&patch.first_name, &patch.last_name]
        .iter()
        .any(|name| matches!(name, Some(Some(n)) if !js_trim(n).is_empty()));
    let names_placeholder =
        person.is_placeholder == Some(true) && patch.is_placeholder.is_none() && names;
    assign_patch(person, patch);
    if names_placeholder {
        person.is_placeholder = None;
    }
    Ok(())
}

pub fn update_union(doc: &mut TreeDocument, union_id: &str, patch: &UnionPatch) -> Result {
    require_union(doc, union_id)?;
    let union = doc.unions.get_mut(union_id).unwrap();
    let old_start = union.start.clone();
    if let Some(status) = patch.status {
        union.status = status;
    }
    if let Some(start) = &patch.start {
        union.start.clone_from(start);
    }
    if let Some(end) = &patch.end {
        union.end.clone_from(end);
    }
    if !same_fuzzy_date(old_start.as_ref(), union.start.as_ref()) {
        // FR-R9: unions are ordered by start date, so reposition this one for each partner.
        let partners = union.partners.clone();
        for partner in partners {
            if let Some(order) = doc.union_order.get_mut(&partner)
                && let Some(at) = order.iter().position(|id| id == union_id)
            {
                order.remove(at);
            }
            insert_union_in_order(doc, &partner, union_id);
        }
    }
    Ok(())
}

pub fn set_root(doc: &mut TreeDocument, person_id: &str) -> Result {
    require_person(doc, person_id)?;
    doc.root_person_id = Some(person_id.to_owned());
    Ok(())
}

pub fn rename_tree(doc: &mut TreeDocument, name: &str) -> Result {
    let name = js_trim(name);
    if name.is_empty() {
        return err(ErrorCode::Invalid);
    }
    doc.name = name.to_owned();
    Ok(())
}
