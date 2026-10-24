use serde_json::{Value, json};
use stam_core::{IssueCode, parse_tree_document, validate};

const FIXTURES: &[(&str, &str)] = &[
    ("remarriage", include_str!("fixtures/remarriage.json")),
    ("adoption", include_str!("fixtures/adoption.json")),
    (
        "cousin-marriage",
        include_str!("fixtures/cousin-marriage.json"),
    ),
    ("half-siblings", include_str!("fixtures/half-siblings.json")),
    ("deep-family", include_str!("fixtures/deep-family.json")),
    ("gedcom-551", include_str!("fixtures/gedcom-551.json")),
];

fn base() -> Value {
    serde_json::from_str(include_str!("fixtures/remarriage.json")).unwrap()
}

fn codes(doc: &Value) -> Vec<IssueCode> {
    // Build the document without parse's validation so broken ones can be checked.
    let doc = serde_json::from_value(doc.clone()).expect("shape");
    validate(&doc).into_iter().map(|i| i.code).collect()
}

#[test]
fn fixtures_round_trip() {
    for (name, text) in FIXTURES {
        let doc = parse_tree_document(text).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut input: Value = serde_json::from_str(text).unwrap();
        let output = serde_json::to_value(&doc).unwrap();
        if input.get("rootPersonId").is_none() {
            // withRoot fills a missing root.
            assert!(output.get("rootPersonId").is_some(), "{name}");
            input["rootPersonId"] = output["rootPersonId"].clone();
        }
        assert_eq!(output, input, "{name}");
        let keys: Vec<_> = doc.persons.keys().cloned().collect();
        let input_keys: Vec<_> = input["persons"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, input_keys, "{name}: person order");
    }
}

#[test]
fn fixtures_have_no_issues() {
    for (name, text) in FIXTURES {
        let doc = parse_tree_document(text).unwrap();
        assert!(validate(&doc).is_empty(), "{name}");
    }
}

#[test]
fn each_issue_code_is_found() {
    let first_union = |d: &Value| {
        d["unions"]
            .as_object()
            .unwrap()
            .keys()
            .next()
            .unwrap()
            .clone()
    };
    let first_person = |d: &Value| {
        d["persons"]
            .as_object()
            .unwrap()
            .keys()
            .next()
            .unwrap()
            .clone()
    };

    let mut d = base();
    let u = first_union(&d);
    d["unions"][&u]["children"]
        .as_array_mut()
        .unwrap()
        .push(json!({"personId": "ghost", "type": "biological"}));
    assert!(codes(&d).contains(&IssueCode::DanglingRef));

    let mut d = base();
    let u = first_union(&d);
    d["unions"][&u]["partners"] = json!([]);
    assert!(codes(&d).contains(&IssueCode::EmptyUnion));

    let mut d = base();
    d["rootPersonId"] = json!("ghost");
    assert_eq!(codes(&d), vec![IssueCode::BadRoot]);

    let mut d = base();
    let p = first_person(&d);
    d["unionOrder"][&p] = json!([]);
    assert!(codes(&d).contains(&IssueCode::UnionOrderMismatch));

    let mut d = base();
    let u = first_union(&d);
    let child = d["unions"][&u]["children"][0].clone();
    d["unions"][&u]["children"]
        .as_array_mut()
        .unwrap()
        .push(child);
    assert!(codes(&d).contains(&IssueCode::DuplicateChild));

    // A second union that also lists a biological child of the first.
    let mut d = base();
    let u = first_union(&d);
    let child = d["unions"][&u]["children"][0]["personId"].clone();
    let partner = d["unions"][&u]["partners"][0].clone();
    d["unions"]["extra"] = json!({"id": "extra", "partners": [partner], "status": "partner",
        "children": [{"personId": child, "type": "biological"}]});
    d["unionOrder"][partner.as_str().unwrap()]
        .as_array_mut()
        .unwrap()
        .push(json!("extra"));
    assert!(codes(&d).contains(&IssueCode::MultipleBioParents));

    // A child made a parent of their own parent.
    let mut d = base();
    let u = first_union(&d);
    let child = d["unions"][&u]["children"][0]["personId"]
        .as_str()
        .unwrap()
        .to_owned();
    let partner = d["unions"][&u]["partners"][0].clone();
    d["unions"]["loop"] = json!({"id": "loop", "partners": [child], "status": "partner",
        "children": [{"personId": partner, "type": "adopted"}]});
    d["unionOrder"][&child] = json!(["loop"]);
    assert!(codes(&d).contains(&IssueCode::Cycle));
}

#[test]
fn issue_codes_serialize_as_in_typescript() {
    assert_eq!(
        serde_json::to_value(IssueCode::MultipleBioParents).unwrap(),
        json!("MULTIPLE_BIO_PARENTS")
    );
}

#[test]
fn parse_refuses_bad_documents() {
    let refuse = |mutate: &dyn Fn(&mut Value)| {
        let mut d = base();
        mutate(&mut d);
        assert!(parse_tree_document(&d.to_string()).is_err(), "accepted {d}");
    };
    let first_person = |d: &Value| {
        d["persons"]
            .as_object()
            .unwrap()
            .keys()
            .next()
            .unwrap()
            .clone()
    };
    refuse(&|d| d["schemaVersion"] = json!(2));
    refuse(&|d| d["schemaVersion"] = json!("1"));
    refuse(&|d| {
        let p = first_person(d);
        d["persons"][&p]["birth"] = json!({"date": {"year": 1990.5}});
    });
    refuse(&|d| {
        let p = first_person(d);
        d["persons"][&p]["id"] = json!("other");
    });
    refuse(&|d| {
        let u = d["unions"]
            .as_object()
            .unwrap()
            .keys()
            .next()
            .unwrap()
            .clone();
        d["unions"][&u]["partners"] = json!([]);
    });
    refuse(&|d| {
        let p = first_person(d);
        let person = d["persons"][&p].clone();
        d["persons"]["a/b"] = person;
    });
    refuse(&|d| {
        let p = first_person(d);
        d["persons"][&p]["nickname"] = Value::Null;
    });
    refuse(&|d| d["persons"]["constructor"] = json!({"id": "constructor"}));
    refuse(&|d| d["settings"]["direction"] = json!("up"));
    assert!(parse_tree_document("[]").is_err());
    assert!(parse_tree_document("not json").is_err());
}

#[test]
fn parse_accepts_whole_floats_and_drops_unknown_fields() {
    let mut d = base();
    let p = d["persons"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    d["persons"][&p]["birth"] = json!({"date": {"year": 1990.0}});
    d["persons"][&p]["extra"] = json!(true);
    d["extra"] = json!(1);
    let doc = parse_tree_document(&d.to_string()).unwrap();
    let out = serde_json::to_value(&doc).unwrap();
    assert_eq!(out["persons"][&p]["birth"]["date"]["year"], json!(1990));
    assert!(out["persons"][&p].get("extra").is_none());
    assert!(out.get("extra").is_none());
}
