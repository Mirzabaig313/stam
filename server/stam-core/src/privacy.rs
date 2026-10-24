//! Port of `src/core/model/privacy.ts` (`applyPrivacy`), the filter for hide-living links.

use std::collections::HashSet;

use crate::model::{Person, TreeDocument};

/// Living as the card reads it: a death record makes a person deceased whatever `isLiving` says.
pub fn is_living_person(p: &Person) -> bool {
    p.is_living && p.death.is_none()
}

/// A living person keeps their names and nothing else personal (no dates, places, photo or
/// notes); a union with a living partner loses its dates. Deceased people are kept as they are.
pub fn apply_privacy(doc: &TreeDocument) -> TreeDocument {
    let living: HashSet<&str> = doc
        .persons
        .values()
        .filter(|p| is_living_person(p))
        .map(|p| p.id.as_str())
        .collect();
    let mut out = doc.clone();
    for person in out.persons.values_mut() {
        if living.contains(person.id.as_str()) {
            person.birth = None;
            person.death = None;
            person.photo_id = None;
            person.notes = None;
        }
    }
    for union in out.unions.values_mut() {
        if union.partners.iter().any(|p| living.contains(p.as_str())) {
            union.start = None;
            union.end = None;
        }
    }
    out
}

/// The person whose photo this is, if any.
pub fn photo_owner<'a>(doc: &'a TreeDocument, photo_id: &str) -> Option<&'a Person> {
    doc.persons
        .values()
        .find(|p| p.photo_id.as_deref() == Some(photo_id))
}
