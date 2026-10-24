//! Who is in a room (P2): link users' names and the person each has selected.

use serde_json::{Value, json};
use stam_core::{TreeDocument, parse_tree_document};
use stam_room::{
    Attachment, Author, AuthorKind, MemoryStore, Outbox, Role, RoomCore, presence_id,
    presence_message,
};

const NOW: &str = "2026-05-06T07:08:09.000Z";

fn family() -> TreeDocument {
    parse_tree_document(include_str!(
        "../../stam-core/tests/fixtures/remarriage.json"
    ))
    .unwrap()
}

fn owner() -> Attachment {
    Attachment {
        socket_id: "s-owner".into(),
        role: Role::Owner,
        link_id: None,
        hide_living: false,
        author: Author {
            kind: AuthorKind::Owner,
            id: "user1".into(),
            name: "Mirza".into(),
        },
        joined: false,
        selected: None,
    }
}

fn editor() -> Attachment {
    Attachment {
        socket_id: "s-edit".into(),
        role: Role::Edit,
        link_id: Some("link1".into()),
        hide_living: false,
        author: Author {
            kind: AuthorKind::Link,
            id: String::new(),
            name: String::new(),
        },
        joined: false,
        selected: None,
    }
}

fn room() -> RoomCore<MemoryStore> {
    RoomCore::create(MemoryStore::default(), family(), owner().author, NOW).unwrap()
}

fn send(room: &mut RoomCore<MemoryStore>, who: &Attachment, msg: Value) -> Outbox {
    room.on_message(who, &msg.to_string(), NOW, 0.0)
}

#[test]
fn hello_names_a_link_user_and_says_presence_changed() {
    let mut r = room();
    let out = send(
        &mut r,
        &editor(),
        json!({"type": "hello", "clientId": "ignored", "name": "  Ali\u{7}  Khan  "}),
    );
    let att = out.attachment.expect("the socket's attachment changes");
    assert!(att.joined);
    assert_eq!(att.author.name, "Ali Khan");
    assert!(out.presence);
    assert_eq!(out.reply.len(), 1, "the welcome");
}

#[test]
fn the_owner_keeps_the_account_name() {
    let mut r = room();
    let out = send(
        &mut r,
        &owner(),
        json!({"type": "hello", "name": "Someone else"}),
    );
    let att = out.attachment.unwrap();
    assert_eq!(att.author.name, "Mirza");
    let renamed = send(&mut r, &att, json!({"type": "name", "name": "Imposter"}));
    assert!(renamed.attachment.is_none());
}

#[test]
fn names_are_cut_to_40_characters() {
    let mut r = room();
    let long = "ب".repeat(60);
    let out = send(&mut r, &editor(), json!({"type": "hello", "name": long}));
    assert_eq!(out.attachment.unwrap().author.name.chars().count(), 40);
}

#[test]
fn a_name_given_later_signs_the_edits_after_it() {
    let mut r = room();
    let named = send(&mut r, &editor(), json!({"type": "name", "name": "Sara"}))
        .attachment
        .unwrap();
    assert_eq!(named.author.name, "Sara");
    let out = send(
        &mut r,
        &named,
        json!({"type": "op", "opId": "aaaaaaaaaa", "cmd": {"type": "renameTree", "name": "X"}}),
    );
    let applied: Value = serde_json::from_str(&out.broadcast.unwrap().full).unwrap();
    assert_eq!(applied["author"], json!({"kind": "link", "name": "Sara"}));
}

#[test]
fn presence_keeps_a_selected_person_of_the_tree_only() {
    let mut r = room();
    let person = r.doc().persons.keys().next().unwrap().clone();
    let out = send(
        &mut r,
        &editor(),
        json!({"type": "presence", "selectedPersonId": person}),
    );
    assert!(out.presence);
    assert_eq!(
        out.attachment.unwrap().selected.as_deref(),
        Some(person.as_str())
    );
    let unknown = send(
        &mut r,
        &editor(),
        json!({"type": "presence", "selectedPersonId": "nobody"}),
    );
    assert_eq!(unknown.attachment.unwrap().selected, None);
    let cleared = send(&mut r, &editor(), json!({"type": "presence"}));
    assert_eq!(cleared.attachment.unwrap().selected, None);
}

#[test]
fn each_socket_sees_the_others_by_a_server_made_id() {
    let mut a = owner();
    a.joined = true;
    a.selected = Some("p1".into());
    let mut b = editor();
    b.joined = true;
    b.author.name = "Sara".into();
    let mut b2 = b.clone();
    b2.socket_id = "s-edit-2-longer-than-twelve".into();
    let not_yet = editor(); // never said hello
    let sockets = [&a, &b, &b2, &not_yet];
    let for_owner: Value =
        serde_json::from_str(&presence_message(sockets.into_iter(), "s-owner", &[])).unwrap();
    assert_eq!(for_owner["type"], "presence");
    assert_eq!(
        for_owner["people"],
        json!([
            {"id": "s-edit", "name": "Sara", "kind": "link"},
            {"id": "s-edit-2-lon", "name": "Sara", "kind": "link"}
        ])
    );
    let for_editor: Value = serde_json::from_str(&presence_message(
        sockets.into_iter(),
        "s-edit",
        &["s-edit-2-longer-than-twelve"],
    ))
    .unwrap();
    assert_eq!(
        for_editor["people"],
        json!([{"id": "s-owner", "name": "Mirza", "kind": "owner", "selectedPersonId": "p1"}])
    );
    assert_eq!(presence_id("s-edit-2-longer-than-twelve"), "s-edit-2-lon");
}

#[test]
fn a_link_user_signed_in_with_google_keeps_the_account_name() {
    let mut r = room();
    let mut signed_in = editor();
    signed_in.author.id = "user9".into();
    signed_in.author.name = "Hana Ali".into();
    let hello = send(&mut r, &signed_in, json!({"type": "hello", "name": "Fake"}));
    let att = hello.attachment.unwrap();
    assert_eq!(att.author.name, "Hana Ali");
    let renamed = send(&mut r, &att, json!({"type": "name", "name": "Fake"}));
    assert!(renamed.attachment.is_none());
}
