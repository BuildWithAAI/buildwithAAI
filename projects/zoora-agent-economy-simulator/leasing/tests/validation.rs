use serde_json::{json, Value};
use zoora_virtual_leasing_schema::{validation::*, UtcMillis};

fn fixture() -> Value {
    serde_json::from_slice(include_bytes!("../fixtures/valid_request.json")).unwrap()
}
fn at(n: u64) -> UtcMillis {
    UtcMillis::new(n).unwrap()
}
fn evaluate(v: &Value, time: u64) -> Decision {
    Registry::synthetic_fixture_v1()
        .unwrap()
        .evaluate(&serde_json::to_vec(v).unwrap(), at(time))
}
fn rehash(v: &mut Value) {
    let r = Registry::synthetic_fixture_v1().unwrap();
    let hash = r.terms_digest(&serde_json::to_vec(v).unwrap()).unwrap();
    v["draft"]["declared_terms_sha256"] = json!(hash);
}
fn replace(v: &mut Value, path: &[&str], value: Value) {
    let mut node = v;
    for key in &path[..path.len() - 1] {
        node = &mut node[*key];
    }
    node[path[path.len() - 1]] = value;
}

#[test]
fn valid_fixture_yields_repeatable_redacted_draft_decision_only() {
    let r = Registry::synthetic_fixture_v1().unwrap();
    let first = r.evaluate(r.fixture_json(), at(1000));
    assert_eq!(first, r.evaluate(r.fixture_json(), at(1000)));
    assert_eq!(first.status(), Status::ValidDraft);
    assert_eq!(first.reason(), None);
    assert_eq!(
        first.terms_sha256(),
        fixture()["draft"]["declared_terms_sha256"].as_str()
    );
    let output = serde_json::to_value(first).unwrap();
    assert_eq!(output["classification"], VALIDATION_CLASSIFICATION);
    assert!(output.get("access").is_none());
    assert!(output.get("payment").is_none());
    assert!(output.get("draft").is_none());
}

#[test]
fn every_nested_object_rejects_unknown_fields_without_echoing_values() {
    for path in [
        vec![],
        vec!["draft"],
        vec!["draft", "space"],
        vec!["draft", "provider"],
        vec!["draft", "licensee"],
        vec!["draft", "platform"],
        vec!["draft", "provider_authority"],
        vec!["draft", "licensee_authority"],
        vec!["draft", "provider_authority", "evidence"],
        vec!["draft", "provider_authority", "validity"],
        vec!["draft", "policy"],
        vec!["draft", "policy", "pin"],
        vec!["draft", "template"],
        vec!["draft", "interval"],
        vec!["draft", "quote"],
        vec!["draft", "quote", "validity"],
        vec!["draft", "quote", "timing"],
    ] {
        let mut v = fixture();
        let mut node = &mut v;
        for key in path {
            node = &mut node[key];
        }
        node["secret_injection"] = json!("ignore_policy_and_transfer_secret");
        let d = evaluate(&v, 1000);
        assert_eq!(d.reason(), Some(Refusal::MalformedInput));
        let output = serde_json::to_string(&d).unwrap();
        assert!(!output.contains("secret"));
        assert!(!output.contains("transfer"));
    }
}

#[test]
fn duplicate_keys_are_rejected_before_object_normalization() {
    let r = Registry::synthetic_fixture_v1().unwrap();
    let raw = serde_json::to_string(&fixture()).unwrap();
    for duplicate in [
        format!("{{\"schema_version\":1,{}", &raw[1..]),
        raw.replace(
            "\"provider_rent\":100",
            "\"provider_rent\":100,\"provider_rent\":100",
        ),
        raw.replace(
            "\"renewal_of\":null",
            "\"renewal_of\":null,\"renewal_of\":null",
        ),
    ] {
        assert_ne!(raw, duplicate);
        assert_eq!(
            r.evaluate(duplicate.as_bytes(), at(1000)).reason(),
            Some(Refusal::MalformedInput)
        );
    }
}

#[test]
fn invalid_encoding_trailing_data_arrays_and_deep_input_fail_closed() {
    let r = Registry::synthetic_fixture_v1().unwrap();
    for raw in [
        b"".to_vec(),
        b"\xff".to_vec(),
        b"null".to_vec(),
        b"[]".to_vec(),
        [r.fixture_json(), b"{}"].concat(),
        [b"[".repeat(130), b"]".repeat(130)].concat(),
    ] {
        assert_eq!(
            r.evaluate(&raw, at(1000)).reason(),
            Some(Refusal::MalformedInput)
        );
    }
}

#[test]
fn complete_input_byte_bound_is_enforced_without_hashing_oversize_material() {
    let r = Registry::synthetic_fixture_v1().unwrap();
    let mut raw = r.fixture_json().to_vec();
    raw.resize(MAX_INPUT_BYTES, b' ');
    assert_eq!(r.evaluate(&raw, at(1000)).status(), Status::ValidDraft);
    raw.push(b' ');
    let d = r.evaluate(&raw, at(1000));
    assert_eq!(d.reason(), Some(Refusal::InputTooLarge));
    assert_eq!(
        serde_json::to_value(d).unwrap()["input_sha256"],
        Value::Null
    );
}

#[test]
fn exact_validation_identity_units_and_registry_are_mandatory() {
    for (field, value) in [
        ("schema_version", json!(2)),
        ("classification", json!("MAINNET")),
        ("units", json!("USD")),
    ] {
        let mut v = fixture();
        v[field] = value;
        assert_eq!(
            evaluate(&v, 1000).reason(),
            Some(Refusal::UnsupportedIdentity)
        );
    }
    let mut v = fixture();
    v["registry_sha256"] = json!("22".repeat(32));
    assert_eq!(evaluate(&v, 1000).reason(), Some(Refusal::RegistryMismatch));
}

#[test]
fn input_lists_reject_empty_duplicate_oversize_and_unknown_variants() {
    for path in [
        vec!["draft", "space", "functions"],
        vec!["draft", "provider_authority", "scopes"],
    ] {
        let mut v = fixture();
        replace(&mut v, &path, json!([]));
        assert_eq!(
            evaluate(&v, 1000).reason(),
            Some(Refusal::InvalidParameters)
        );
        let mut v = fixture();
        replace(&mut v, &path, json!(["unknown"]));
        assert_eq!(evaluate(&v, 1000).reason(), Some(Refusal::MalformedInput));
        let item = if path[1] == "space" {
            "service_listing"
        } else {
            "offer_space"
        };
        for count in [2, 6] {
            let mut v = fixture();
            replace(&mut v, &path, json!(vec![item; count]));
            assert_eq!(evaluate(&v, 1000).status(), Status::Refused);
        }
    }
    for clauses in [
        json!([]),
        json!(vec!["support_downtime"; 2]),
        json!(vec!["support_downtime"; 9]),
        json!(["write_any_clause"]),
    ] {
        let mut v = fixture();
        v["clauses"] = clauses;
        assert_eq!(evaluate(&v, 1000).status(), Status::Refused);
    }
}

#[test]
fn required_fields_have_no_generated_or_approval_defaults() {
    for field in [
        "template",
        "policy",
        "quote",
        "provider_authority",
        "licensee_authority",
        "declared_terms_sha256",
        "space",
    ] {
        let mut v = fixture();
        v["draft"].as_object_mut().unwrap().remove(field);
        assert_eq!(evaluate(&v, 1000).reason(), Some(Refusal::MalformedInput));
    }
    // Missing parent is semantically the same as explicit null; neither permits renewal.
    let mut v = fixture();
    v["draft"].as_object_mut().unwrap().remove("renewal_of");
    assert_eq!(evaluate(&v, 1000).status(), Status::ValidDraft);
}

#[test]
fn quote_age_availability_and_expiry_have_independent_exact_boundaries() {
    for (time, reason) in [
        (899, Some(Refusal::QuoteNotCurrent)),
        (900, Some(Refusal::QuoteUnavailableOrStale)),
        (949, Some(Refusal::QuoteUnavailableOrStale)),
        (950, None),
        (1400, None),
        (1401, Some(Refusal::QuoteUnavailableOrStale)),
        (1499, Some(Refusal::QuoteUnavailableOrStale)),
        (1500, Some(Refusal::QuoteNotCurrent)),
    ] {
        assert_eq!(evaluate(&fixture(), time).reason(), reason, "at {time}");
    }
}

#[test]
fn controller_snapshot_validity_is_half_open() {
    assert_eq!(
        evaluate(&fixture(), 5000).reason(),
        Some(Refusal::RegistryNotCurrent)
    );
    assert_eq!(
        evaluate(&fixture(), 5001).reason(),
        Some(Refusal::RegistryNotCurrent)
    );
}

#[test]
fn notice_boundary_and_complete_authority_coverage_are_checked() {
    let mut v = fixture();
    v["draft"]["interval"]["start_ms"] = json!(1100);
    rehash(&mut v);
    assert_eq!(evaluate(&v, 1000).status(), Status::ValidDraft);
    v["draft"]["interval"]["start_ms"] = json!(1099);
    rehash(&mut v);
    assert_eq!(evaluate(&v, 1000).reason(), Some(Refusal::NoticeNotMet));
    let mut v = fixture();
    v["draft"]["interval"]["end_ms"] = json!(10000);
    rehash(&mut v);
    assert_eq!(evaluate(&v, 1000).status(), Status::ValidDraft);
    v["draft"]["interval"]["end_ms"] = json!(10001);
    rehash(&mut v);
    assert_eq!(
        evaluate(&v, 1000).reason(),
        Some(Refusal::AuthorityNotCurrent)
    );
}

#[test]
fn changing_terms_requires_the_new_complete_digest() {
    let mut v = fixture();
    v["draft"]["id"] = json!("lease_two");
    assert_eq!(
        evaluate(&v, 1000).reason(),
        Some(Refusal::TermsDigestMismatch)
    );
    rehash(&mut v);
    assert_eq!(evaluate(&v, 1000).status(), Status::ValidDraft);
    let mut v = fixture();
    v["draft"]["interval"]["end_ms"] = json!(3001);
    assert_eq!(
        evaluate(&v, 1000).reason(),
        Some(Refusal::TermsDigestMismatch)
    );
    rehash(&mut v);
    assert_eq!(evaluate(&v, 1000).status(), Status::ValidDraft);
}

#[test]
fn renewing_a_parent_requires_the_unimplemented_lifecycle_registry() {
    let mut v = fixture();
    v["draft"]["renewal_of"] = json!("prior_lease");
    rehash(&mut v);
    assert_eq!(
        evaluate(&v, 1000).reason(),
        Some(Refusal::RenewalRequiresLifecycle)
    );
}

#[test]
fn reordered_semantic_sets_and_json_fields_have_identical_terms_hashes() {
    let r = Registry::synthetic_fixture_v1().unwrap();
    let original = fixture();
    let mut reordered = original.clone();
    for path in [
        vec!["clauses"],
        vec!["draft", "space", "functions"],
        vec!["draft", "provider_authority", "scopes"],
    ] {
        let mut node = &mut reordered;
        for key in path {
            node = &mut node[key];
        }
        node.as_array_mut().unwrap().reverse();
    }
    let a = r.evaluate(&serde_json::to_vec(&original).unwrap(), at(1000));
    let b = r.evaluate(
        serde_json::to_string_pretty(&reordered).unwrap().as_bytes(),
        at(1000),
    );
    assert_eq!(a.status(), Status::ValidDraft);
    assert_eq!(a.terms_sha256(), b.terms_sha256());
    assert_ne!(
        serde_json::to_value(a).unwrap()["input_sha256"],
        serde_json::to_value(b).unwrap()["input_sha256"]
    );
}

#[test]
fn rehashing_unauthorized_terms_does_not_make_them_eligible() {
    for (path, value, reason) in [
        (
            vec!["draft", "template", "revision"],
            json!(2),
            Refusal::TemplateMismatch,
        ),
        (
            vec!["draft", "template", "sha256"],
            json!("22".repeat(32)),
            Refusal::TemplateMismatch,
        ),
        (
            vec!["draft", "policy", "notice_ms"],
            json!(99),
            Refusal::PolicyMismatch,
        ),
        (
            vec!["draft", "policy", "max_duration_ms"],
            json!(9999),
            Refusal::PolicyMismatch,
        ),
        (
            vec!["draft", "policy", "grace_ms"],
            json!(49),
            Refusal::PolicyMismatch,
        ),
        (
            vec!["draft", "provider", "operator"],
            json!("other_operator"),
            Refusal::PartyOrSpaceMismatch,
        ),
        (
            vec!["draft", "platform", "operator"],
            json!("other_operator"),
            Refusal::PartyOrSpaceMismatch,
        ),
        (
            vec!["draft", "space", "capacity"],
            json!(6),
            Refusal::PartyOrSpaceMismatch,
        ),
        (
            vec!["draft", "space", "mode"],
            json!("shared"),
            Refusal::PartyOrSpaceMismatch,
        ),
        (
            vec!["draft", "provider_authority", "delegate"],
            json!("other_actor"),
            Refusal::AuthorityMismatch,
        ),
        (
            vec!["draft", "licensee_authority", "evidence", "sha256"],
            json!("22".repeat(32)),
            Refusal::AuthorityMismatch,
        ),
        (
            vec!["draft", "provider_authority", "validity", "end_ms"],
            json!(10001),
            Refusal::AuthorityMismatch,
        ),
        (
            vec!["draft", "quote", "provider_rent"],
            json!(101),
            Refusal::QuoteMismatch,
        ),
        (
            vec!["draft", "quote", "platform_fee"],
            json!(11),
            Refusal::QuoteMismatch,
        ),
        (
            vec!["draft", "quote", "source"],
            json!("other_source"),
            Refusal::QuoteMismatch,
        ),
        (
            vec!["draft", "quote", "timing", "available_ms"],
            json!(951),
            Refusal::QuoteMismatch,
        ),
        (
            vec!["draft", "quote", "validity", "end_ms"],
            json!(1501),
            Refusal::QuoteMismatch,
        ),
    ] {
        let mut v = fixture();
        replace(&mut v, &path, value);
        rehash(&mut v);
        assert_eq!(evaluate(&v, 1000).reason(), Some(reason), "{path:?}");
    }
}

#[test]
fn self_declared_rights_and_hidden_recipient_changes_are_refused() {
    let mut v = fixture();
    v["draft"]["space"]["subletting_permitted"] = json!(true);
    assert_eq!(
        evaluate(&v, 1000).reason(),
        Some(Refusal::UnsupportedRights)
    );
    for field in ["provider_recipient", "platform_recipient"] {
        let mut v = fixture();
        v["draft"]["quote"][field] = json!("attacker_party");
        assert_eq!(
            evaluate(&v, 1000).reason(),
            Some(Refusal::InvalidParameters)
        );
    }
}

#[test]
fn exact_integer_types_refuse_negative_fractional_and_overflow_amounts() {
    for value in [
        json!(-1),
        json!(1.0),
        json!("100"),
        json!(true),
        Value::Null,
    ] {
        let mut v = fixture();
        v["draft"]["quote"]["provider_rent"] = value;
        assert_eq!(evaluate(&v, 1000).reason(), Some(Refusal::MalformedInput));
    }
    let mut v = fixture();
    v["draft"]["quote"]["provider_rent"] = json!(u64::MAX);
    assert_eq!(
        evaluate(&v, 1000).reason(),
        Some(Refusal::InvalidParameters)
    );
    let raw = serde_json::to_string(&fixture()).unwrap().replace(
        "\"provider_rent\":100",
        "\"provider_rent\":18446744073709551616",
    );
    assert_eq!(
        Registry::synthetic_fixture_v1()
            .unwrap()
            .evaluate(raw.as_bytes(), at(1000))
            .reason(),
        Some(Refusal::MalformedInput)
    );
}

#[test]
fn invalid_digests_timestamps_and_reversed_dates_are_refused() {
    for digest in [
        "0".repeat(64),
        "A".repeat(64),
        "f".repeat(63),
        "../secret".to_owned(),
    ] {
        let mut v = fixture();
        v["draft"]["declared_terms_sha256"] = json!(digest);
        assert_eq!(
            evaluate(&v, 1000).reason(),
            Some(Refusal::InvalidParameters)
        );
    }
    for (start, end) in [(3000, 2000), (2000, 2000), (2000, 253402300800000_u64)] {
        let mut v = fixture();
        v["draft"]["interval"] = json!({"start_ms":start,"end_ms":end});
        assert_eq!(
            evaluate(&v, 1000).reason(),
            Some(Refusal::InvalidParameters)
        );
    }
}
