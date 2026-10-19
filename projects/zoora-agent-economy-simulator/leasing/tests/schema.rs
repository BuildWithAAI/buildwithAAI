use zoora_virtual_leasing_schema::*;

fn id(value: &str) -> Identifier {
    Identifier::new(value).unwrap()
}
fn pin(value: &str) -> VersionPin {
    VersionPin::new(id(value), 1, Digest::new([1; 32]).unwrap()).unwrap()
}
fn interval(start: u64, end: u64) -> Interval {
    Interval::new(UtcMillis::new(start).unwrap(), UtcMillis::new(end).unwrap()).unwrap()
}
fn claim(party: &str, scope: AuthorityScope) -> AuthorityClaim {
    AuthorityClaim::new(
        id("claim_one"),
        id(party),
        id("actor_one"),
        id("space_one"),
        vec![scope],
        interval(0, 100),
        pin("evidence_one"),
    )
    .unwrap()
}
fn fact_time() -> FactTime {
    FactTime::new(UtcMillis::new(0).unwrap(), UtcMillis::new(0).unwrap()).unwrap()
}
fn draft() -> DraftInput {
    DraftInput {
        id: id("lease_one"),
        instance: id("instance_one"),
        space: Space::new(
            id("space_one"),
            id("provider_one"),
            UseMode::Exclusive,
            5,
            vec![BusinessFunction::ProjectCollaboration],
        )
        .unwrap(),
        provider: Party::new(id("provider_one"), id("operator_one")),
        licensee: Party::new(id("licensee_one"), id("operator_two")),
        platform: Party::new(id("platform_one"), id("operator_three")),
        provider_authority: claim("provider_one", AuthorityScope::OfferSpace),
        licensee_authority: claim("licensee_one", AuthorityScope::AcceptLease),
        policy: Policy::new(pin("policy_one"), 100, 10, 5).unwrap(),
        template: pin("template_one"),
        declared_terms_digest: Digest::new([2; 32]).unwrap(),
        interval: interval(10, 90),
        quote: Quote::new(
            SyntheticUnits::new(100),
            SyntheticUnits::new(10),
            id("fixture_quote"),
            interval(0, 10),
            fact_time(),
            id("provider_one"),
            id("platform_one"),
        )
        .unwrap(),
        renewal_of: None,
    }
}

#[test]
fn identifiers_reject_unsafe_and_unbounded_text() {
    for text in [
        "",
        "aa",
        "Uppercase",
        "../file",
        "abc\nsecret",
        "abc def",
        "https://a",
        "éclair",
        "1starts_wrong",
    ] {
        assert_eq!(Identifier::new(text), Err(SchemaError::InvalidIdentifier));
    }
    assert!(Identifier::new(&"a".repeat(MAX_ID_BYTES)).is_ok());
    assert_eq!(
        Identifier::new(&"a".repeat(MAX_ID_BYTES + 1)),
        Err(SchemaError::InvalidIdentifier)
    );
}

#[test]
fn revisions_and_digest_presence_are_required_but_not_attested() {
    assert_eq!(Digest::new([0; 32]), Err(SchemaError::EmptyDigest));
    let digest = Digest::new([1; 32]).unwrap();
    assert_eq!(
        VersionPin::new(id("policy_one"), 0, digest),
        Err(SchemaError::InvalidRevision)
    );
    assert_eq!(pin("policy_one").digest().bytes(), &[1; 32]);
    assert_eq!(pin("policy_one").revision(), 1);
    assert_eq!(pin("policy_one").id().as_str(), "policy_one");
}

#[test]
fn timestamps_have_explicit_utc_millisecond_bounds() {
    assert_eq!(UtcMillis::new(MAX_UTC_MS).unwrap().value(), MAX_UTC_MS);
    assert_eq!(
        UtcMillis::new(MAX_UTC_MS + 1),
        Err(SchemaError::TimestampOutOfRange)
    );
}

#[test]
fn intervals_are_nonempty_half_open_and_overlap_symmetrically() {
    let a = interval(10, 20);
    let b = interval(20, 30);
    let c = interval(19, 21);
    assert!(a.contains(UtcMillis::new(10).unwrap()));
    assert!(!a.contains(UtcMillis::new(20).unwrap()));
    assert!(!a.overlaps(b));
    assert!(!b.overlaps(a));
    assert!(a.overlaps(c));
    assert!(c.overlaps(a));
    assert_eq!(a.duration_ms(), 10);
    assert_eq!(
        Interval::new(UtcMillis::new(20).unwrap(), UtcMillis::new(20).unwrap()),
        Err(SchemaError::InvalidInterval)
    );
    assert_eq!(
        Interval::new(UtcMillis::new(21).unwrap(), UtcMillis::new(20).unwrap()),
        Err(SchemaError::InvalidInterval)
    );
}

#[test]
fn separate_rent_and_fee_units_reconcile_without_float_or_overflow() {
    let q = draft().quote;
    assert_eq!(q.provider_rent().value(), 100);
    assert_eq!(q.platform_fee().value(), 10);
    assert_eq!(q.total().unwrap().value(), 110);
    assert_eq!(q.source().as_str(), "fixture_quote");
    assert!(!q.validity().contains(UtcMillis::new(10).unwrap()));
    assert_eq!(
        SyntheticUnits::new(u64::MAX).checked_add(SyntheticUnits::new(1)),
        Err(SchemaError::AmountOverflow)
    );
    assert_eq!(
        Quote::new(
            SyntheticUnits::new(u64::MAX),
            SyntheticUnits::new(1),
            id("quote_one"),
            interval(0, 1),
            fact_time(),
            id("provider_one"),
            id("platform_one")
        ),
        Err(SchemaError::AmountOverflow)
    );
    assert_eq!(
        Quote::new(
            SyntheticUnits::new(0),
            SyntheticUnits::new(0),
            id("quote_zero"),
            interval(0, 1),
            fact_time(),
            id("provider_one"),
            id("platform_one")
        )
        .unwrap()
        .total()
        .unwrap()
        .value(),
        0
    );
}

#[test]
fn policy_bounds_reject_unbounded_horizons_and_notice_or_grace() {
    for (duration, notice, grace) in [
        (0, 0, 0),
        (MAX_DURATION_MS + 1, 0, 0),
        (100, 101, 0),
        (100, 0, 101),
    ] {
        assert_eq!(
            Policy::new(pin("policy_one"), duration, notice, grace),
            Err(SchemaError::InvalidPolicyBounds)
        );
    }
    let p = Policy::new(pin("policy_one"), MAX_DURATION_MS, 0, 0).unwrap();
    assert_eq!(p.max_duration_ms(), MAX_DURATION_MS);
    assert_eq!(p.notice_ms(), 0);
    assert_eq!(p.grace_ms(), 0);
}

#[test]
fn space_capacity_and_functions_are_bounded_and_no_subletting_is_granted() {
    for capacity in [0, MAX_CAPACITY + 1] {
        assert_eq!(
            Space::new(
                id("space_one"),
                id("provider_one"),
                UseMode::Shared,
                capacity,
                vec![BusinessFunction::ContentDisplay]
            ),
            Err(SchemaError::InvalidCapacity)
        );
    }
    assert_eq!(
        Space::new(
            id("space_one"),
            id("provider_one"),
            UseMode::Shared,
            1,
            vec![]
        ),
        Err(SchemaError::EmptySelection)
    );
    assert_eq!(
        Space::new(
            id("space_one"),
            id("provider_one"),
            UseMode::Shared,
            1,
            vec![BusinessFunction::ContentDisplay; 2]
        ),
        Err(SchemaError::DuplicateSelection)
    );
    assert_eq!(
        Space::new(
            id("space_one"),
            id("provider_one"),
            UseMode::Shared,
            1,
            vec![BusinessFunction::ContentDisplay; 6]
        ),
        Err(SchemaError::TooManySelections)
    );
    assert!(!draft().space.subletting_permitted());
}

#[test]
fn authority_scope_lists_refuse_duplicates_empty_and_oversize_input() {
    for (scopes, expected) in [
        (vec![], SchemaError::EmptySelection),
        (
            vec![AuthorityScope::OfferSpace; 2],
            SchemaError::DuplicateSelection,
        ),
        (
            vec![AuthorityScope::OfferSpace; 6],
            SchemaError::TooManySelections,
        ),
    ] {
        assert_eq!(
            AuthorityClaim::new(
                id("claim_one"),
                id("provider_one"),
                id("actor_one"),
                id("space_one"),
                scopes,
                interval(0, 10),
                pin("evidence_one")
            ),
            Err(expected)
        );
    }
}

#[test]
fn a_bounded_draft_never_implies_consent_payment_access_or_legal_authority() {
    let d = DraftLease::new(draft()).unwrap();
    assert_eq!(d.stage(), LeaseStage::Draft);
    assert_eq!(d.access(), AccessState::NotGranted);
    assert_eq!(d.payment(), PaymentFact::Unobserved);
    assert_eq!(d.dispute(), DisputeState::None);
    assert_eq!(CLASSIFICATION, "SYNTHETIC_VL001_NO_MONETARY_VALUE");
}

#[test]
fn mismatched_provider_and_identical_parties_are_rejected() {
    let mut input = draft();
    input.provider = Party::new(id("other_party"), id("operator_one"));
    assert_eq!(DraftLease::new(input), Err(SchemaError::PartyMismatch));
    let mut input = draft();
    input.licensee = input.provider.clone();
    assert_eq!(DraftLease::new(input), Err(SchemaError::PartyMismatch));
}

#[test]
fn authority_claim_must_name_the_same_party_space_and_required_scope() {
    let mut input = draft();
    input.provider_authority = claim("wrong_party", AuthorityScope::OfferSpace);
    assert_eq!(
        DraftLease::new(input),
        Err(SchemaError::AuthorityScopeMismatch)
    );
    let mut input = draft();
    input.licensee_authority = claim("licensee_one", AuthorityScope::OfferSpace);
    assert_eq!(
        DraftLease::new(input),
        Err(SchemaError::AuthorityScopeMismatch)
    );
    let mut input = draft();
    input.provider_authority = AuthorityClaim::new(
        id("claim_one"),
        id("provider_one"),
        id("actor_one"),
        id("wrong_space"),
        vec![AuthorityScope::OfferSpace],
        interval(0, 100),
        pin("evidence_one"),
    )
    .unwrap();
    assert_eq!(
        DraftLease::new(input),
        Err(SchemaError::AuthorityScopeMismatch)
    );
}

#[test]
fn lease_duration_cannot_exceed_the_explicit_fixture_policy() {
    let mut input = draft();
    input.interval = interval(0, 101);
    assert_eq!(DraftLease::new(input), Err(SchemaError::DurationExceeded));
    let mut input = draft();
    input.interval = interval(0, 100);
    assert!(DraftLease::new(input).is_ok());
}

#[test]
fn related_operators_remain_visible_without_becoming_the_same_party() {
    let mut input = draft();
    input.licensee = Party::new(id("licensee_one"), id("operator_one"));
    assert!(DraftLease::new(input).unwrap().related_operators());
    assert!(!DraftLease::new(draft()).unwrap().related_operators());
}

#[test]
fn expired_quotes_can_be_drafted_but_never_become_activated_by_this_schema() {
    let d = DraftLease::new(draft()).unwrap();
    assert!(!d
        .fields()
        .quote
        .validity()
        .contains(UtcMillis::new(20).unwrap()));
    assert_eq!(d.access(), AccessState::NotGranted);
    assert_eq!(d.stage(), LeaseStage::Draft);
}

#[test]
fn renewal_is_a_new_draft_reference_and_cannot_rewrite_its_parent() {
    let original = DraftLease::new(draft()).unwrap();
    let saved = original.clone();
    let mut input = original.fields().clone();
    input.id = id("lease_two");
    input.renewal_of = Some(id("lease_one"));
    let renewal = DraftLease::new(input).unwrap();
    assert_eq!(renewal.stage(), LeaseStage::Draft);
    assert_eq!(original, saved);
    let mut input = draft();
    input.renewal_of = Some(id("lease_one"));
    assert_eq!(DraftLease::new(input), Err(SchemaError::SelfRenewal));
}

#[test]
fn observed_and_available_time_remain_separate_and_ordered() {
    assert_eq!(
        FactTime::new(UtcMillis::new(2).unwrap(), UtcMillis::new(1).unwrap()),
        Err(SchemaError::InvalidObservationTime)
    );
    let timing = FactTime::new(UtcMillis::new(1).unwrap(), UtcMillis::new(2).unwrap()).unwrap();
    assert_eq!(timing.observed().value(), 1);
    assert_eq!(timing.available().value(), 2);
    assert_eq!(draft().quote.timing(), fact_time());
}

#[test]
fn quote_rent_and_fee_recipients_bind_separately_to_the_named_parties() {
    let mut input = draft();
    input.platform = Party::new(id("other_platform"), id("operator_three"));
    assert_eq!(DraftLease::new(input), Err(SchemaError::QuotePartyMismatch));
    let mut input = draft();
    input.quote = Quote::new(
        SyntheticUnits::new(100),
        SyntheticUnits::new(10),
        id("fixture_quote"),
        interval(0, 10),
        fact_time(),
        id("wrong_provider"),
        id("platform_one"),
    )
    .unwrap();
    assert_eq!(DraftLease::new(input), Err(SchemaError::QuotePartyMismatch));
    let mut input = draft();
    input.platform = Party::new(id("platform_one"), id("operator_one"));
    assert!(DraftLease::new(input).unwrap().related_operators());
    assert_eq!(draft().quote.provider_recipient().as_str(), "provider_one");
    assert_eq!(draft().quote.platform_recipient().as_str(), "platform_one");
}
