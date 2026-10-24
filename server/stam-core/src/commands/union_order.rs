//! Port of `lookup.ts` and `unionOrder.ts`.

use std::cmp::Ordering;

use crate::dates::{compare_fuzzy_date, dated_year};
use crate::error::{CommandError, ErrorCode, err};
use crate::model::TreeDocument;

pub fn require_person(doc: &TreeDocument, person_id: &str) -> Result<(), CommandError> {
    if doc.persons.contains_key(person_id) {
        Ok(())
    } else {
        err(ErrorCode::NotFound)
    }
}

pub fn require_union(doc: &TreeDocument, union_id: &str) -> Result<(), CommandError> {
    if doc.unions.contains_key(union_id) {
        Ok(())
    } else {
        err(ErrorCode::NotFound)
    }
}

/// FR-R9: before the first union that starts later, otherwise last. Creates the person's order.
pub fn insert_union_in_order(doc: &mut TreeDocument, person_id: &str, union_id: &str) {
    let start = doc
        .unions
        .get(union_id)
        .and_then(|u| dated_year(u.start.as_ref()))
        .cloned();
    let index = {
        let order = doc
            .union_order
            .get(person_id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        start
            .and_then(|start| {
                order.iter().position(|id| {
                    let other = doc
                        .unions
                        .get(id)
                        .and_then(|u| dated_year(u.start.as_ref()));
                    other.is_some() && compare_fuzzy_date(other, Some(&start)) == Ordering::Greater
                })
            })
            .unwrap_or(order.len())
    };
    doc.union_order
        .entry(person_id.to_owned())
        .or_default()
        .insert(index, union_id.to_owned());
}
