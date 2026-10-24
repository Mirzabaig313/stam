use serde_json::{Value, json};
use stam_core::{TreeDocument, apply_privacy, diff_docs, parse_tree_document};
use stam_room::{
    Attachment, Author, AuthorKind, MemoryStore, Outbox, PhotoAccess, Role, RoomCore, RoomStore,
};

const NOW: &str = "2026-05-06T07:08:09.000Z";

fn family() -> TreeDocument {
    parse_tree_document(include_str!(
        "../../stam-core/tests/fixtures/remarriage.json"
    ))
    .unwrap()
}

fn att(socket: &str, role: Role, hide_living: bool) -> Attachment {
    Attachment {
        socket_id: socket.into(),
        role,
        link_id: (role != Role::Owner).then(|| "link1".into()),
        hide_living,
        author: Author {
            kind: if role == Role::Owner {
                AuthorKind::Owner
            } else {
                AuthorKind::Link
            },
            id: if role == Role::Owner {
                "user1".into()
            } else {
                String::new()
            },
            name: if role == Role::Owner {
                "Mirza".into()
            } else {
                String::new()
            },
        },
    }
}

fn owner() -> Attachment {
    att("s-owner", Role::Owner, false)
}

fn room() -> RoomCore<MemoryStore> {
    RoomCore::create(MemoryStore::default(), family(), owner().author, NOW).unwrap()
}

fn send(room: &mut RoomCore<MemoryStore>, who: &Attachment, msg: Value) -> Outbox {
    room.on_message(who, &msg.to_string(), NOW, 0.0)
}

fn parse(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

fn rename(op: &str, name: &str) -> Value {
    json!({"type": "op", "opId": op, "cmd": {"type": "renameTree", "name": name}})
}

fn first_person(doc: &TreeDocument) -> String {
    doc.persons.keys().next().unwrap().clone()
}

#[test]
fn owner_op_is_applied_and_broadcast() {
    let mut r = room();
    let out = send(&mut r, &owner(), rename("aaaaaaaaaa", "New"));
    assert!(out.reply.is_empty());
    let full = parse(&out.broadcast.as_ref().unwrap().full);
    assert_eq!(full["type"], "applied");
    assert_eq!(full["version"], 1);
    assert_eq!(full["opId"], "aaaaaaaaaa");
    assert_eq!(full["author"], json!({"kind": "owner", "name": "Mirza"}));
    assert_eq!(full["changes"]["tree"]["name"], "New");
    assert_eq!(r.version(), 1);
}

#[test]
fn viewer_op_is_forbidden() {
    let mut r = room();
    let out = send(
        &mut r,
        &att("s1", Role::View, false),
        rename("aaaaaaaaaa", "X"),
    );
    assert!(out.broadcast.is_none());
    assert_eq!(
        parse(&out.reply[0]),
        json!({"type": "rejected", "opId": "aaaaaaaaaa", "code": "FORBIDDEN"})
    );
    assert_eq!(r.version(), 0);
}

#[test]
fn refused_command_is_rejected_with_its_code() {
    let mut r = room();
    let out = send(
        &mut r,
        &owner(),
        json!({"type": "op", "opId": "aaaaaaaaaa", "cmd": {"type": "setRoot", "personId": "ghost"}}),
    );
    assert_eq!(parse(&out.reply[0])["code"], "NOT_FOUND");
    assert!(out.broadcast.is_none());
}

#[test]
fn resent_op_is_answered_once_and_not_reapplied() {
    let mut r = room();
    send(&mut r, &owner(), rename("aaaaaaaaaa", "New"));
    let again = send(&mut r, &owner(), rename("aaaaaaaaaa", "Other"));
    assert!(again.broadcast.is_none());
    let reply = parse(&again.reply[0]);
    assert_eq!(
        (reply["type"].as_str(), reply["version"].as_u64()),
        (Some("applied"), Some(1))
    );
    assert_eq!(reply["changes"]["tree"]["name"], "New");
    assert_eq!(r.version(), 1);
}

#[test]
fn welcome_sends_ops_within_1000_else_doc() {
    let mut r = room();
    for i in 0..3 {
        send(
            &mut r,
            &owner(),
            rename(&format!("op{i:08}"), &format!("N{i}")),
        );
    }
    let w = parse(&send(&mut r, &owner(), json!({"type": "hello", "lastVersion": 1})).reply[0]);
    assert_eq!(w["type"], "welcome");
    assert_eq!(w["version"], 3);
    assert_eq!(w["role"], "owner");
    assert!(w.get("doc").is_none());
    assert_eq!(
        w["ops"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["version"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        vec![2, 3]
    );
    let fresh = parse(&send(&mut r, &owner(), json!({"type": "hello"})).reply[0]);
    assert_eq!(fresh["doc"]["name"], "N2");
    assert!(fresh.get("ops").is_none());
    let ahead = parse(&send(&mut r, &owner(), json!({"type": "hello", "lastVersion": 9})).reply[0]);
    assert!(ahead.get("doc").is_some());
}

#[test]
fn hide_living_welcome_is_redacted() {
    let mut doc = family();
    let p = first_person(&doc);
    let person = doc.persons.get_mut(&p).unwrap();
    person.is_living = true;
    person.death = None;
    person.notes = Some("secret".into());
    let mut r = RoomCore::create(MemoryStore::default(), doc, owner().author, NOW).unwrap();
    let viewer = att("s2", Role::View, true);
    let w = parse(&send(&mut r, &viewer, json!({"type": "hello", "lastVersion": 0})).reply[0]);
    assert!(w["doc"]["persons"][&p].get("notes").is_none());
    assert_eq!(w["hideLiving"], true);
    assert!(!w.to_string().contains("secret"));
}

#[test]
fn redacted_broadcast_hides_details_of_the_living() {
    let mut r = room();
    let p = first_person(&r.doc().clone());
    let out = send(
        &mut r,
        &owner(),
        json!({"type": "op", "opId": "aaaaaaaaaa", "cmd": {"type": "updatePerson", "personId": p, "patch": {"isLiving": true, "death": null, "notes": "secret"}}}),
    );
    let b = out.broadcast.unwrap();
    assert!(b.full.contains("secret"));
    assert!(!b.redacted.contains("secret"));
}

#[test]
fn busy_blocks_the_socket_until_retry_so_ops_stay_in_order() {
    let mut r = room();
    for i in 0..61 {
        r.on_message(
            &owner(),
            &rename(&format!("op{i:08}"), &format!("N{i}")).to_string(),
            NOW,
            0.0,
        );
    }
    // Tokens refill between messages, but the socket stays blocked until retryAfter passes.
    let early = r.on_message(
        &owner(),
        &rename("lateopxxxx", "Late").to_string(),
        NOW,
        100.0,
    );
    assert_eq!(parse(&early.reply[0])["type"], "busy");
    assert_eq!(r.version(), 60);
    let after = r.on_message(
        &owner(),
        &rename("op00000060", "N60").to_string(),
        NOW,
        1100.0,
    );
    assert!(after.broadcast.is_some());
}

#[test]
fn resends_of_applied_ops_do_not_use_tokens() {
    let mut r = room();
    send(&mut r, &owner(), rename("aaaaaaaaaa", "New"));
    for _ in 0..100 {
        let out = send(&mut r, &owner(), rename("aaaaaaaaaa", "New"));
        assert_eq!(parse(&out.reply[0])["type"], "applied");
    }
}

#[test]
fn hello_lists_which_pending_ops_the_room_already_has() {
    let mut r = room();
    send(&mut r, &owner(), rename("aaaaaaaaaa", "New"));
    let w = parse(
        &send(
            &mut r,
            &owner(),
            json!({"type": "hello", "lastVersion": 0, "pending": ["aaaaaaaaaa", "bbbbbbbbbb"]}),
        )
        .reply[0],
    );
    assert_eq!(w["known"], json!(["aaaaaaaaaa"]));
}

#[test]
fn hide_living_sockets_cannot_edit_or_replay() {
    let mut r = room();
    send(&mut r, &owner(), rename("aaaaaaaaaa", "New"));
    let hidden_editor = att("s9", Role::Edit, true);
    let out = send(&mut r, &hidden_editor, rename("aaaaaaaaaa", "New"));
    assert_eq!(parse(&out.reply[0])["code"], "FORBIDDEN");
}

#[test]
fn malformed_op_ids_and_oversized_messages_are_refused() {
    let mut r = room();
    for op in ["", "short", "waytoolongopid"] {
        let out = send(&mut r, &owner(), rename(op, "X"));
        assert_eq!(parse(&out.reply[0])["code"], "INVALID", "{op}");
    }
    let huge = json!({"type": "op", "opId": "aaaaaaaaaa", "cmd": {"type": "renameTree", "name": "x".repeat(300_000)}});
    let out = send(&mut r, &owner(), huge);
    assert_eq!(parse(&out.reply[0])["code"], "TOO_LARGE");
    assert_eq!(r.version(), 0);
}

#[test]
fn hello_is_rate_limited_too() {
    let mut r = room();
    let viewer = att("s5", Role::View, false);
    let busy = (0..80)
        .filter(|_| {
            parse(&send(&mut r, &viewer, json!({"type": "hello"})).reply[0])["type"] == "busy"
        })
        .count();
    assert!(busy > 0);
    r.on_close("s5");
}

#[test]
fn catch_up_limit_is_configurable() {
    let mut r = room();
    r.set_catch_up_limit(1);
    send(&mut r, &owner(), rename("aaaaaaaaaa", "A"));
    send(&mut r, &owner(), rename("bbbbbbbbbb", "B"));
    let w = parse(&send(&mut r, &owner(), json!({"type": "hello", "lastVersion": 0})).reply[0]);
    assert!(w.get("doc").is_some());
}

#[test]
fn rate_limit_returns_busy() {
    let mut r = room();
    let mut busy = 0;
    for i in 0..70 {
        let out = send(
            &mut r,
            &owner(),
            rename(&format!("op{i:08}"), &format!("N{i}")),
        );
        if out
            .reply
            .first()
            .is_some_and(|m| parse(m)["type"] == "busy")
        {
            busy += 1;
        }
    }
    assert_eq!(busy, 10, "a burst of 60, then busy at the same instant");
    let later = r.on_message(
        &owner(),
        &rename("zzzzzzzzzz", "Later").to_string(),
        NOW,
        1000.0,
    );
    assert!(later.broadcast.is_some(), "30 tokens a second come back");
}

#[test]
fn too_large_is_rejected() {
    let mut r = room();
    let p = first_person(r.doc());
    let mut last = Value::Null;
    // The fixture is small; the limit is checked against the result, so set it via the API.
    r.set_people_limit(r.doc().persons.len());
    let union = r.doc().union_order[&p][0].clone();
    let out = send(
        &mut r,
        &owner(),
        json!({"type": "op", "opId": "aaaaaaaaaa", "cmd": {"type": "addChild", "parentId": p, "child": {"gender": "male"}, "unionId": union}}),
    );
    if let Some(m) = out.reply.first() {
        last = parse(m);
    }
    assert_eq!(last["code"], "TOO_LARGE");
}

#[test]
fn bad_message_rejected() {
    let mut r = room();
    for text in [
        "not json",
        "{}",
        r#"{"type":"explode"}"#,
        r#"{"type":"op"}"#,
    ] {
        let out = r.on_message(&owner(), text, NOW, 0.0);
        assert_eq!(parse(&out.reply[0])["code"], "BAD_MESSAGE", "{text}");
    }
}

#[test]
fn snapshot_every_50_and_checkpoint_every_500() {
    let mut r = room();
    for i in 0..501 {
        r.on_message(
            &owner(),
            &rename(&format!("op{i:08}"), &format!("N{i}")).to_string(),
            NOW,
            i as f64 * 1000.0,
        );
    }
    let store = r.store();
    assert_eq!(store.load().unwrap().unwrap().doc_version, 500);
    assert!(store.checkpoints.contains_key(&500));
    assert!(store.checkpoints.contains_key(&0));
    assert!(r.flush_due());
    r.flush();
    assert_eq!(r.store().load().unwrap().unwrap().doc_version, 501);
    assert!(!r.flush_due());
}

#[test]
fn open_replays_ops_after_snapshot() {
    let mut r = room();
    for i in 0..7 {
        send(
            &mut r,
            &owner(),
            rename(&format!("op{i:08}"), &format!("N{i}")),
        );
    }
    let doc = r.doc().clone();
    let reopened = RoomCore::open(r.into_store()).unwrap();
    assert_eq!(reopened.version(), 7);
    assert_eq!(reopened.doc(), &doc);
}

#[test]
fn revert_undoes_own_edit_and_reports_conflicts() {
    let mut r = room();
    let before = r.doc().clone();
    send(&mut r, &owner(), rename("aaaaaaaaaa", "Mine"));
    let entries = json!([{"key": "tree/name", "before": before.name, "after": "Mine"}]);
    let out = send(
        &mut r,
        &owner(),
        json!({"type": "revert", "opId": "bbbbbbbbbb", "entries": entries, "direction": "undo"}),
    );
    assert_eq!(
        parse(&out.broadcast.unwrap().full)["changes"]["tree"]["name"],
        before.name.as_str()
    );
    let conflict = send(
        &mut r,
        &owner(),
        json!({"type": "revert", "opId": "cccccccccc", "entries": entries, "direction": "undo"}),
    );
    let reply = parse(&conflict.reply[0]);
    assert_eq!(
        (reply["code"].as_str(), reply["key"].as_str()),
        (Some("CONFLICT"), Some("tree/name"))
    );
}

#[test]
fn photo_of_living_person_hidden_from_hide_living() {
    let mut doc = family();
    let p = first_person(&doc);
    let person = doc.persons.get_mut(&p).unwrap();
    person.is_living = true;
    person.death = None;
    person.photo_id = Some("ph1".into());
    let r = RoomCore::create(MemoryStore::default(), doc, owner().author, NOW).unwrap();
    assert_eq!(
        r.photo_access(&att("s", Role::View, false), "ph1"),
        PhotoAccess::Allowed
    );
    assert_eq!(
        r.photo_access(&att("s", Role::View, true), "ph1"),
        PhotoAccess::NotFound
    );
    assert_eq!(r.photo_access(&owner(), "nope"), PhotoAccess::NotFound);
}

mod properties {
    use proptest::prelude::*;

    use super::*;

    fn cmd_for(doc: &TreeDocument, n: usize, k: u8) -> Value {
        let people: Vec<&String> = doc.persons.keys().collect();
        let p = people[n % people.len()];
        match k % 4 {
            0 => {
                json!({"type": "updatePerson", "personId": p, "patch": {"isLiving": n.is_multiple_of(2), "death": null, "notes": "n"}})
            }
            1 => {
                json!({"type": "updatePerson", "personId": p, "patch": {"death": {"place": "Here"}}})
            }
            2 => {
                json!({"type": "addSpouse", "personId": p, "spouse": {"gender": "female", "notes": "s"}})
            }
            _ => json!({"type": "deletePerson", "personId": p, "mode": "person"}),
        }
    }

    proptest! {
        #[test]
        fn redacted_broadcast_equals_full_privacy_diff(steps in prop::collection::vec((0usize..50, 0u8..4), 1..20)) {
            let mut r = room();
            for (i, (n, k)) in steps.into_iter().enumerate() {
                if r.doc().persons.is_empty() { break; }
                let before = r.doc().clone();
                let cmd = cmd_for(&before, n, k);
                let out = r.on_message(&owner(), &json!({"type": "op", "opId": format!("op{i:08}"), "cmd": cmd}).to_string(), NOW, i as f64 * 1000.0);
                let Some(b) = out.broadcast else { continue };
                let got = parse(&b.redacted)["changes"].clone();
                let want = serde_json::to_value(diff_docs(&apply_privacy(&before), &apply_privacy(r.doc()))).unwrap();
                prop_assert_eq!(&got, &want);
                let got_keys: Vec<_> = got["persons"].as_object().unwrap().keys().cloned().collect();
                let want_keys: Vec<_> = want["persons"].as_object().unwrap().keys().cloned().collect();
                prop_assert_eq!(got_keys, want_keys);
            }
        }
    }
}

#[test]
fn a_store_that_cannot_write_answers_busy_and_applies_nothing() {
    let mut r = room();
    r.store_mut().failing = true;
    let out = send(&mut r, &owner(), rename("aaaaaaaaaa", "New"));
    assert!(out.broadcast.is_none());
    assert_eq!(parse(&out.reply[0])["type"], "busy");
    assert_eq!(r.version(), 0);
    assert_ne!(r.doc().name, "New");
    // Once storage works again the same op goes through.
    r.store_mut().failing = false;
    assert!(
        send(&mut r, &owner(), rename("aaaaaaaaaa", "New"))
            .broadcast
            .is_some()
    );
}

#[test]
fn a_failed_flush_stays_due() {
    let mut r = room();
    send(&mut r, &owner(), rename("aaaaaaaaaa", "New"));
    r.store_mut().failing = true;
    r.flush();
    assert!(r.flush_due());
    let w = send(&mut r, &owner(), json!({"type": "hello", "lastVersion": 0}));
    assert_eq!(parse(&w.reply[0])["type"], "busy");
}

#[test]
fn open_tells_no_tree_from_broken_storage() {
    assert!(matches!(
        RoomCore::open(MemoryStore::default()),
        Err(stam_room::RoomError::NoTree)
    ));
    let mut store = room().into_store();
    store.failing = true;
    assert!(matches!(
        RoomCore::open(store),
        Err(stam_room::RoomError::Store(_))
    ));
}

#[test]
fn welcome_names_the_room_epoch_which_survives_a_restart() {
    let mut r = room();
    let w = parse(&send(&mut r, &owner(), json!({"type": "hello"})).reply[0]);
    assert_eq!(w["epoch"], NOW);
    let mut reopened = RoomCore::open(r.into_store()).unwrap();
    let again = parse(
        &send(
            &mut reopened,
            &owner(),
            json!({"type": "hello", "lastVersion": 0}),
        )
        .reply[0],
    );
    assert_eq!(again["epoch"], NOW);
}
