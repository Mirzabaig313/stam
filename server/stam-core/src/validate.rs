//! Port of `src/core/model/validate.ts`: the same checks, in the same order, giving the same codes
//! and ids. Messages are not ported; the parity suite compares codes and ids.

use std::collections::{HashMap, HashSet};

use indexmap::{IndexMap, IndexSet};
use serde::Serialize;

use crate::model::{ChildType, TreeDocument};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IssueCode {
    DanglingRef,
    MultipleBioParents,
    Cycle,
    EmptyUnion,
    BadRoot,
    UnionOrderMismatch,
    DuplicateChild,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Issue {
    pub code: IssueCode,
    pub ids: Vec<String>,
}

fn issue(code: IssueCode, ids: &[&str]) -> Issue {
    Issue {
        code,
        ids: ids.iter().map(|s| (*s).to_owned()).collect(),
    }
}

/// Checks the invariants of PRD section 9. Linear time, never recurses.
pub fn validate(doc: &TreeDocument) -> Vec<Issue> {
    let mut issues = Vec::new();
    let has = |id: &str| doc.persons.contains_key(id);

    if let Some(root) = &doc.root_person_id
        && !has(root)
    {
        issues.push(issue(IssueCode::BadRoot, &[root]));
    }

    let mut bio_unions_of: IndexMap<String, Vec<String>> = IndexMap::new();
    let mut edges: HashMap<String, IndexSet<String>> = HashMap::new();

    for union in doc.unions.values() {
        if union.partners.is_empty() {
            issues.push(issue(IssueCode::EmptyUnion, &[&union.id]));
        }
        for partner in &union.partners {
            if !has(partner) {
                issues.push(issue(IssueCode::DanglingRef, &[&union.id, partner]));
            } else if !doc
                .union_order
                .get(partner)
                .is_some_and(|o| o.contains(&union.id))
            {
                issues.push(issue(IssueCode::UnionOrderMismatch, &[&union.id, partner]));
            }
        }

        let mut seen_children = HashSet::new();
        for child in &union.children {
            if !seen_children.insert(child.person_id.as_str()) {
                issues.push(issue(
                    IssueCode::DuplicateChild,
                    &[&union.id, &child.person_id],
                ));
                continue;
            }
            if !has(&child.person_id) {
                issues.push(issue(
                    IssueCode::DanglingRef,
                    &[&union.id, &child.person_id],
                ));
                continue;
            }
            if child.kind == ChildType::Biological {
                bio_unions_of
                    .entry(child.person_id.clone())
                    .or_default()
                    .push(union.id.clone());
            }
            for partner in &union.partners {
                if !has(partner) {
                    continue;
                }
                edges
                    .entry(partner.clone())
                    .or_default()
                    .insert(child.person_id.clone());
            }
        }
    }

    for (person_id, order) in &doc.union_order {
        if !has(person_id) {
            issues.push(issue(IssueCode::DanglingRef, &[person_id]));
            continue;
        }
        let mut seen = HashSet::new();
        for union_id in order {
            match doc.unions.get(union_id) {
                None => issues.push(issue(IssueCode::DanglingRef, &[person_id, union_id])),
                Some(u) if !u.partners.contains(person_id) => {
                    issues.push(issue(IssueCode::UnionOrderMismatch, &[person_id, union_id]))
                }
                Some(_) if seen.contains(union_id.as_str()) => {
                    issues.push(issue(IssueCode::UnionOrderMismatch, &[person_id, union_id]))
                }
                Some(_) => {}
            }
            seen.insert(union_id.as_str());
        }
    }

    for (person_id, union_ids) in &bio_unions_of {
        if union_ids.len() > 1 {
            let mut ids = vec![person_id.clone()];
            ids.extend(union_ids.iter().cloned());
            issues.push(Issue {
                code: IssueCode::MultipleBioParents,
                ids,
            });
        }
    }

    issues.extend(find_cycles(doc, &edges));
    issues
}

#[derive(Clone, Copy, PartialEq)]
enum Colour {
    Grey,
    Black,
}

/// Iterative three-colour DFS over parent -> child edges; one issue per back edge.
fn find_cycles(doc: &TreeDocument, edges: &HashMap<String, IndexSet<String>>) -> Vec<Issue> {
    let empty = IndexSet::new();
    let mut issues = Vec::new();
    let mut colour: HashMap<&str, Colour> = HashMap::new();

    for start in doc.persons.keys() {
        if colour.contains_key(start.as_str()) {
            continue;
        }
        let mut path: Vec<&str> = vec![start];
        // Each frame walks one person's children by index.
        let mut frames: Vec<(&IndexSet<String>, usize)> =
            vec![(edges.get(start).unwrap_or(&empty), 0)];
        colour.insert(start, Colour::Grey);

        while let Some(frame) = frames.last_mut() {
            let Some(child) = frame.0.get_index(frame.1) else {
                colour.insert(path.pop().unwrap(), Colour::Black);
                frames.pop();
                continue;
            };
            frame.1 += 1;
            match colour.get(child.as_str()) {
                Some(Colour::Grey) => {
                    let at = path.iter().position(|p| *p == child).unwrap();
                    issues.push(Issue {
                        code: IssueCode::Cycle,
                        ids: path[at..].iter().map(|s| (*s).to_owned()).collect(),
                    });
                }
                None => {
                    colour.insert(child, Colour::Grey);
                    path.push(child);
                    frames.push((edges.get(child).unwrap_or(&empty), 0));
                }
                Some(Colour::Black) => {}
            }
        }
    }
    issues
}
