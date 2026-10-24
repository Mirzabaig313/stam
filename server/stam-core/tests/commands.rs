use serde_json::{Value, json};
use stam_core::{
    Changes, CommandError, Direction, ErrorCode, TreeDocument, apply_changes, apply_command,
    apply_privacy, apply_revert, decode_command, diff_docs, op_id_source, parse_tree_document,
    photo_owner,
};

const NOW: &str = "2026-05-06T07:08:09.000Z";
const LATER: &str = "2026-06-01T00:00:00.000Z";

fn remarriage() -> TreeDocument {
    parse_tree_document(include_str!("fixtures/remarriage.json")).unwrap()
}

fn empty() -> TreeDocument {
    let mut doc = remarriage();
    doc.persons.clear();
    doc.unions.clear();
    doc.union_order.clear();
    doc.root_person_id = None;
    doc
}

fn run(doc: &TreeDocument, cmd: Value, op: &str) -> Result<stam_core::Applied, CommandError> {
    apply_command(doc, &decode_command(&cmd)?, NOW, op)
}

fn code(result: Result<stam_core::Applied, CommandError>) -> ErrorCode {
    result.expect_err("expected a refusal").code
}

fn first_person(doc: &TreeDocument) -> String {
    doc.persons.keys().next().unwrap().clone()
}

#[test]
fn op_id_source_counts_like_the_typescript() {
    let mut next = op_id_source("abcdefghij").unwrap();
    let ids: Vec<String> = (0..4096).map(|_| next().unwrap()).collect();
    assert_eq!(ids[0], "abcdefghijAA");
    assert_eq!(ids[62], "abcdefghijA-");
    assert_eq!(ids[63], "abcdefghijA_");
    assert_eq!(ids[64], "abcdefghijBA");
    assert!(next().is_err());
    assert!(op_id_source("short").is_err());
}

#[test]
fn add_person_on_empty_tree_becomes_root() {
    let applied = run(
        &empty(),
        json!({"type": "addPerson", "person": {"gender": "male"}}),
        "opopopopop",
    )
    .unwrap();
    assert_eq!(applied.created_ids, vec!["opopopopopAA"]);
    assert_eq!(applied.doc.root_person_id.as_deref(), Some("opopopopopAA"));
    assert_eq!(applied.doc.updated_at, NOW);
    let p = &applied.doc.persons["opopopopopAA"];
    assert_eq!((p.first_name.as_str(), p.is_living), ("", true));
}

#[test]
fn add_sibling_without_parents_creates_placeholders_in_order() {
    let root = run(
        &empty(),
        json!({"type": "addPerson", "person": {"gender": "male"}}),
        "rootrootro",
    )
    .unwrap()
    .doc;
    let applied = run(
        &root,
        json!({"type": "addSibling", "personId": "rootrootroAA", "sibling": {"gender": "female"}}),
        "abcdefghij",
    )
    .unwrap();
    assert_eq!(
        applied.created_ids,
        vec!["abcdefghijAA", "abcdefghijAB", "abcdefghijAC"]
    );
    assert_eq!(
        applied.doc.unions.keys().collect::<Vec<_>>(),
        vec!["abcdefghijAD"]
    );
    assert_eq!(
        applied.doc.persons["abcdefghijAB"].is_placeholder,
        Some(true)
    );
    // Root stays on top: it moves to the new parent union's first partner.
    assert_eq!(applied.doc.root_person_id.as_deref(), Some("abcdefghijAB"));
}

#[test]
fn every_command_type_applies_on_a_real_family() {
    let doc = remarriage();
    let p = first_person(&doc);
    let union_id = doc.unions.keys().next().unwrap().clone();
    let child = doc.unions[&union_id].children[0].person_id.clone();
    let cmds = [
        json!({"type": "updatePerson", "personId": p, "patch": {"firstName": "X", "nickname": null}}),
        json!({"type": "updateUnion", "unionId": union_id, "patch": {"status": "divorced", "start": {"year": 1970}}}),
        json!({"type": "setRoot", "personId": child}),
        json!({"type": "renameTree", "name": "  Renamed  "}),
        json!({"type": "addChild", "parentId": p, "unionId": union_id, "child": {"gender": "male"}, "childType": "adopted"}),
        json!({"type": "addSpouse", "personId": child, "spouse": {"gender": "female"}}),
        json!({"type": "insertParent", "childId": child, "parent": {"gender": "male"}}),
        json!({"type": "reorderChild", "unionId": union_id, "personId": child, "toIndex": 99}),
        json!({"type": "setChildType", "unionId": union_id, "personId": child, "childType": "step"}),
        json!({"type": "deletePerson", "personId": child, "mode": "withDescendants"}),
    ];
    for cmd in cmds {
        let applied =
            run(&doc, cmd.clone(), "abcdefghij").unwrap_or_else(|e| panic!("{cmd}: {e:?}"));
        assert!(stam_core::validate(&applied.doc).is_empty(), "{cmd}");
    }
    let renamed = run(
        &doc,
        json!({"type": "renameTree", "name": "  Renamed  "}),
        "abcdefghij",
    )
    .unwrap();
    assert_eq!(renamed.doc.name, "Renamed");
}

#[test]
fn refusals_carry_the_typescript_codes() {
    let doc = remarriage();
    let p = first_person(&doc);
    assert_eq!(
        code(run(
            &doc,
            json!({"type": "setRoot", "personId": "ghost"}),
            "abcdefghij"
        )),
        ErrorCode::NotFound
    );
    assert_eq!(
        code(run(
            &doc,
            json!({"type": "renameTree", "name": "   "}),
            "abcdefghij"
        )),
        ErrorCode::Invalid
    );
    assert_eq!(
        code(run(
            &doc,
            json!({"type": "relinkAsChild", "personId": p, "parentId": p}),
            "abcdefghij"
        )),
        ErrorCode::Cycle
    );
    assert_eq!(
        code(run(&doc, json!({"type": "explode"}), "abcdefghij")),
        ErrorCode::Invalid
    );
    assert_eq!(
        code(run(&doc, json!({"type": "setRoot", "personId": p}), "bad")),
        ErrorCode::Invalid
    );
    assert_eq!(
        serde_json::to_value(ErrorCode::AmbiguousUnion).unwrap(),
        json!("AMBIGUOUS_UNION")
    );
}

#[test]
fn changes_rebuild_the_document_with_map_order() {
    let doc = remarriage();
    let p = first_person(&doc);
    for cmd in [
        json!({"type": "deletePerson", "personId": p, "mode": "person"}),
        json!({"type": "addSibling", "personId": p, "sibling": {"gender": "female"}}),
        json!({"type": "addParent", "childId": p, "parent": {"gender": "male"}}),
    ] {
        let Ok(applied) = run(&doc, cmd, "abcdefghij") else {
            continue;
        };
        let mut rebuilt = doc.clone();
        apply_changes(&mut rebuilt, &applied.changes);
        assert_eq!(rebuilt, applied.doc);
        assert_eq!(
            rebuilt.persons.keys().collect::<Vec<_>>(),
            applied.doc.persons.keys().collect::<Vec<_>>()
        );
        let json: Changes =
            serde_json::from_value(serde_json::to_value(&applied.changes).unwrap()).unwrap();
        assert_eq!(json, applied.changes);
    }
}

#[test]
fn changes_serialize_removals_as_null() {
    let doc = remarriage();
    let p = first_person(&doc);
    let applied = run(
        &doc,
        json!({"type": "deletePerson", "personId": p, "mode": "person"}),
        "abcdefghij",
    )
    .unwrap();
    let v = serde_json::to_value(diff_docs(&doc, &applied.doc)).unwrap();
    assert_eq!(v["persons"][&p], Value::Null);
    assert_eq!(v["tree"]["updatedAt"], json!(NOW));
}

fn entries(before: &TreeDocument, changes: &Changes) -> Value {
    let mut out = vec![];
    for (id, after) in &changes.persons {
        out.push(json!({"key": format!("persons/{id}"), "before": before.persons.get(id), "after": after}));
    }
    for (id, after) in &changes.unions {
        out.push(
            json!({"key": format!("unions/{id}"), "before": before.unions.get(id), "after": after}),
        );
    }
    for (id, after) in &changes.union_order {
        out.push(json!({"key": format!("unionOrder/{id}"), "before": before.union_order.get(id), "after": after}));
    }
    Value::Array(out)
}

#[test]
fn revert_undo_and_redo_are_symmetric() {
    let doc = remarriage();
    let p = first_person(&doc);
    let applied = run(&doc, json!({"type": "addChild", "parentId": p, "child": {"gender": "male"}, "unionId": doc.unions.keys().next()}), "abcdefghij").unwrap();
    let e = entries(&doc, &applied.changes);
    let undone = apply_revert(&applied.doc, &e, "undo", LATER).unwrap();
    let mut expected = doc.clone();
    expected.updated_at = LATER.into();
    assert_eq!(undone.doc, expected);
    let redone = apply_revert(&undone.doc, &e, "redo", LATER).unwrap();
    let mut expected = applied.doc.clone();
    expected.updated_at = LATER.into();
    assert_eq!(redone.doc, expected);
}

#[test]
fn revert_conflict_names_the_entity() {
    let doc = remarriage();
    let p = first_person(&doc);
    let mine = run(
        &doc,
        json!({"type": "updatePerson", "personId": p, "patch": {"firstName": "Mine"}}),
        "abcdefghij",
    )
    .unwrap();
    let theirs = run(
        &mine.doc,
        json!({"type": "updatePerson", "personId": p, "patch": {"notes": "theirs"}}),
        "bbcdefghij",
    )
    .unwrap();
    let err = apply_revert(&theirs.doc, &entries(&doc, &mine.changes), "undo", LATER).unwrap_err();
    assert_eq!(err.code, ErrorCode::Conflict);
    assert_eq!(err.key.as_deref(), Some(format!("persons/{p}").as_str()));
}

#[test]
fn revert_refuses_malformed_entries() {
    let doc = remarriage();
    let p = first_person(&doc);
    let bad =
        json!([{"key": format!("persons/{p}"), "before": {"id": p}, "after": doc.persons[&p]}]);
    assert_eq!(
        apply_revert(&doc, &bad, "undo", LATER).unwrap_err().code,
        ErrorCode::Invalid
    );
    let bad_key = json!([{"key": "bogus/x", "before": null, "after": null}]);
    assert_eq!(
        apply_revert(&doc, &bad_key, "undo", LATER)
            .unwrap_err()
            .code,
        ErrorCode::Invalid
    );
}

#[test]
fn revert_refuses_empty_and_repeated_entries() {
    let doc = remarriage();
    let p = first_person(&doc);
    assert_eq!(
        apply_revert(&doc, &json!([]), "undo", LATER)
            .unwrap_err()
            .code,
        ErrorCode::Invalid
    );
    let same =
        json!({"key": format!("persons/{p}"), "before": doc.persons[&p], "after": doc.persons[&p]});
    let twice = json!([same, same]);
    assert_eq!(
        apply_revert(&doc, &twice, "undo", LATER).unwrap_err().code,
        ErrorCode::Invalid
    );
}

#[test]
fn privacy_keeps_only_names_of_living_people() {
    let mut doc = remarriage();
    let p = first_person(&doc);
    {
        let person = doc.persons.get_mut(&p).unwrap();
        person.is_living = true;
        person.death = None;
        person.notes = Some("secret".into());
        person.photo_id = Some("ph1".into());
        person.nickname = Some("Nick".into());
    }
    let private = apply_privacy(&doc);
    let out = &private.persons[&p];
    assert_eq!(out.notes, None);
    assert_eq!(out.photo_id, None);
    assert_eq!(out.birth, None);
    assert_eq!(out.nickname.as_deref(), Some("Nick"));
    for union in private.unions.values().filter(|u| u.partners.contains(&p)) {
        assert!(union.start.is_none() && union.end.is_none());
    }
    assert_eq!(
        photo_owner(&doc, "ph1").map(|x| x.id.as_str()),
        Some(p.as_str())
    );
    assert_eq!(doc.settings.direction, Direction::Ltr);
}
