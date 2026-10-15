use zoora_review_market::{authorization::*, authorization_export, economy::Phase};
fn config() -> AuthorizationConfig {
    AuthorizationConfig {
        seeds: vec![42],
        scenarios: AuthorizationScenario::ALL.to_vec(),
        agents: 16,
        rounds: 6,
        tasks_per_round: 24,
        provider_capacity: 2,
        max_quotes: 1000,
        max_authorizations: 1000,
        send_window: 2,
        evidence_grace: 6,
        service_ticks: 2,
        starting_balance: 100_000,
        price: 1000,
    }
}
fn binding(id: u64) -> PaymentBinding {
    PaymentBinding {
        agreement_id: id,
        client: 8,
        provider: 0,
        amount: 1000,
        delivery_deadline: 32,
    }
}
fn book(policy: AuthorizationPolicy) -> CapacityBook {
    let mut b = CapacityBook::new(config(), policy).unwrap();
    b.advance(4).unwrap();
    b
}
fn run(s: AuthorizationScenario, p: AuthorizationPolicy) -> AuthorizationRun {
    AuthorizationRun::generate(config(), 42, s, p).unwrap()
}
#[test]
fn permit_binds_every_payment_term_before_one_use() {
    let mut b = book(AuthorizationPolicy::EvidenceWindowHold);
    let terms = binding(1);
    let t = b.grant(terms.clone()).unwrap().unwrap();
    b.advance(5).unwrap();
    for field in 0..5 {
        let mut wrong = terms.clone();
        match field {
            0 => wrong.client += 1,
            1 => wrong.provider += 1,
            2 => wrong.amount += 1,
            3 => wrong.agreement_id += 1,
            _ => wrong.delivery_deadline += 1,
        };
        assert_eq!(
            b.consume(&t, &wrong).unwrap(),
            AuthorizationAction::BindingMismatch
        );
    }
    assert_eq!(
        b.consume("unknown", &terms).unwrap(),
        AuthorizationAction::UnknownToken
    );
    assert_eq!(
        b.consume(&t, &terms).unwrap(),
        AuthorizationAction::SendAllowed
    );
    assert_eq!(
        b.consume(&t, &terms).unwrap(),
        AuthorizationAction::AlreadyConsumed
    );
}
#[test]
fn send_window_is_exclusive_and_same_tick_use_is_refused() {
    let mut b = book(AuthorizationPolicy::EvidenceWindowHold);
    let terms = binding(1);
    let t = b.grant(terms.clone()).unwrap().unwrap();
    assert_eq!(
        b.consume(&t, &terms).unwrap(),
        AuthorizationAction::SendExpired
    );
    b.advance(6).unwrap();
    assert_eq!(
        b.consume(&t, &terms).unwrap(),
        AuthorizationAction::SendExpired
    );
    assert_eq!(b.permits()[0].consumed_tick, None);
}
#[test]
fn old_token_cannot_consume_a_reissued_authorization() {
    let mut b = book(AuthorizationPolicy::EvidenceWindowHold);
    let terms = binding(1);
    let old = b.grant(terms.clone()).unwrap().unwrap();
    b.advance(12).unwrap();
    let new = b.grant(terms.clone()).unwrap().unwrap();
    assert_ne!(old, new);
    b.advance(13).unwrap();
    assert_eq!(
        b.consume(&old, &terms).unwrap(),
        AuthorizationAction::SendExpired
    );
    assert_eq!(
        b.consume(&new, &terms).unwrap(),
        AuthorizationAction::SendAllowed
    );
}
#[test]
fn short_hold_releases_before_evidence_hold() {
    for (p, expected) in [
        (AuthorizationPolicy::FundingWindowHold, 0),
        (AuthorizationPolicy::EvidenceWindowHold, 1),
    ] {
        let mut b = book(p);
        b.grant(binding(1)).unwrap();
        b.advance(6).unwrap();
        assert_eq!(b.occupied(0), expected);
        b.advance(12).unwrap();
        assert_eq!(b.occupied(0), 0);
        assert!(b.permits()[0].expired);
        assert!(b.advance(11).is_err());
    }
}
#[test]
fn admission_never_oversells_held_provider_slots() {
    let mut b = book(AuthorizationPolicy::EvidenceWindowHold);
    assert!(b.grant(binding(1)).unwrap().is_some());
    assert!(b.grant(binding(2)).unwrap().is_some());
    assert!(b.grant(binding(3)).unwrap().is_none());
    assert_eq!(b.occupied(0), 2);
    assert_eq!(
        b.journal().last().unwrap().action,
        AuthorizationAction::CapacityRefused
    );
}
#[test]
fn latest_possible_valid_observation_must_leave_service_time() {
    let mut b = book(AuthorizationPolicy::EvidenceWindowHold);
    let mut terms = binding(1);
    terms.delivery_deadline = 14;
    assert!(b.grant(terms.clone()).unwrap().is_none());
    terms.delivery_deadline = 15;
    assert!(b.grant(terms).unwrap().is_some());
}
#[test]
fn authorization_metadata_budget_does_not_move_client_funds() {
    let mut c = config();
    c.max_authorizations = 1;
    let mut b = CapacityBook::new(c, AuthorizationPolicy::UnreservedPayment).unwrap();
    b.advance(4).unwrap();
    b.grant(binding(1)).unwrap();
    assert!(b.grant(binding(2)).unwrap().is_none());
    assert_eq!(
        b.journal().last().unwrap().action,
        AuthorizationAction::MetadataRefused
    );
    assert!(b.permits().iter().all(|p| p.consumed_tick.is_none()));
}
#[test]
fn full_evidence_holds_remove_in_window_paid_without_start_exposure() {
    for s in [
        AuthorizationScenario::NormalDelay,
        AuthorizationScenario::UnpaidBurst,
        AuthorizationScenario::PaidFlood,
        AuthorizationScenario::ObservationLag,
        AuthorizationScenario::DuplicateAuthorization,
        AuthorizationScenario::ProviderOutage,
    ] {
        let r = run(s, AuthorizationPolicy::EvidenceWindowHold);
        r.verify().unwrap();
        assert_eq!(r.metrics.counts.paid_work_not_started, 0, "{s:?}");
        assert_eq!(r.metrics.amounts.paid_work_not_started_net_units, 0);
        assert!(r.metrics.counts.peak_provider_slots <= 2);
    }
}
#[test]
fn payments_without_reservations_retain_capacity_exposure() {
    let r = run(
        AuthorizationScenario::PaidFlood,
        AuthorizationPolicy::UnreservedPayment,
    );
    assert!(r.metrics.counts.paid_work_not_started > 0);
    let held = run(
        AuthorizationScenario::PaidFlood,
        AuthorizationPolicy::EvidenceWindowHold,
    );
    assert!(held.metrics.counts.started_attacks > 0);
    assert!(held.metrics.amounts.unacknowledged_net_units > 0);
    assert!(held.metrics.counts.paid_work < r.metrics.counts.paid_work);
}
#[test]
fn reservation_spam_is_reported_even_when_it_never_pays() {
    let burst = run(
        AuthorizationScenario::UnpaidBurst,
        AuthorizationPolicy::EvidenceWindowHold,
    );
    let rolling = run(
        AuthorizationScenario::RenewingUnpaid,
        AuthorizationPolicy::EvidenceWindowHold,
    );
    assert!(rolling.metrics.counts.permits_granted > burst.metrics.counts.permits_granted);
    assert!(rolling.metrics.counts.acknowledged_work < burst.metrics.counts.acknowledged_work);
    assert!(rolling.metrics.counts.capacity_refusals > 0);
    assert_eq!(rolling.metrics.counts.started_attacks, 0);
}
#[test]
fn evidence_outside_the_promise_remains_a_payment_fact() {
    let r = run(
        AuthorizationScenario::EvidenceAfterExpiry,
        AuthorizationPolicy::EvidenceWindowHold,
    );
    assert!(r.metrics.counts.paid_work_not_started > 0);
    assert!(r.metrics.counts.late_observations > 0);
    for round in r.rounds.iter().filter(|r| r.phase == Phase::Stress) {
        assert_eq!(round.metrics.counts.started_work, 0);
        assert!(round.metrics.amounts.payments_sent > 0);
        assert_eq!(round.metrics.amounts.voluntary_returns_sent, 0);
    }
    assert_eq!(
        r.metrics.amounts.payments_sent,
        r.direct.metrics.payments_recorded
    );
}
#[test]
fn provider_outage_preserves_unacknowledged_exposure() {
    let r = run(
        AuthorizationScenario::ProviderOutage,
        AuthorizationPolicy::EvidenceWindowHold,
    );
    for round in r.rounds.iter().filter(|r| r.phase == Phase::Stress) {
        assert!(round.metrics.counts.started_work > 0);
        assert_eq!(round.metrics.counts.acknowledged_work, 0);
        assert!(round.metrics.amounts.unacknowledged_net_units > 0);
    }
}
#[test]
fn duplicate_guard_refuses_before_another_debit() {
    let r = run(
        AuthorizationScenario::DuplicateAuthorization,
        AuthorizationPolicy::EvidenceWindowHold,
    );
    assert!(r.metrics.counts.duplicate_send_refusals > 0);
    let mut refs = std::collections::BTreeSet::new();
    assert!(r
        .transfers
        .iter()
        .all(|f| refs.insert(&f.receipt.transaction_ref)));
    r.verify().unwrap();
}
#[test]
fn zero_budgets_cannot_consume_or_pay() {
    let mut c = config();
    c.starting_balance = 0;
    let r = AuthorizationRun::generate(
        c,
        42,
        AuthorizationScenario::NormalDelay,
        AuthorizationPolicy::EvidenceWindowHold,
    )
    .unwrap();
    assert!(r.transfers.is_empty());
    assert!(r.permits.iter().all(|p| p.consumed_tick.is_none()));
    r.verify().unwrap();
}
#[test]
fn forgery_is_refused_even_after_rehashing() {
    let mut r = run(
        AuthorizationScenario::NormalDelay,
        AuthorizationPolicy::EvidenceWindowHold,
    );
    r.permits[0].binding.amount += 1;
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
    let mut r = run(
        AuthorizationScenario::ObservationLag,
        AuthorizationPolicy::EvidenceWindowHold,
    );
    r.authorizations.remove(0);
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
}
#[test]
fn exports_regenerate_and_config_bounds_fail_closed() {
    let mut c = config();
    c.rounds = 3;
    c.tasks_per_round = 2;
    c.scenarios = vec![AuthorizationScenario::NormalDelay];
    let mut r = AuthorizationCampaign::generate(c.clone()).unwrap();
    r.verify().unwrap();
    assert!(authorization_export::csv(&r)
        .unwrap()
        .contains(&r.fingerprint));
    assert!(authorization_export::html(&r)
        .unwrap()
        .contains("connect-src 'none'"));
    r.runs.pop();
    r.fingerprint = r.hash().unwrap();
    assert!(authorization_export::html(&r).is_err());
    c.send_window = 1;
    assert!(c.validate().is_err());
}

#[test]
fn queued_work_uses_observation_validation_order_per_provider() {
    let r = run(
        AuthorizationScenario::NormalDelay,
        AuthorizationPolicy::UnreservedPayment,
    );
    let mut started = std::collections::BTreeSet::new();
    for event in r
        .authorizations
        .iter()
        .filter(|e| e.action == AuthorizationAction::Started)
    {
        let token = event.token.as_ref().unwrap();
        let permit = r.permits.iter().find(|p| &p.token == token).unwrap();
        let mut candidates = r
            .observations
            .iter()
            .filter(|o| {
                o.timely
                    && o.receipt.availability_tick <= event.tick
                    && r.transfers[o.transfer_sequence as usize].kind
                        == zoora_review_market::payments::TransferKind::Payment
            })
            .filter_map(|o| {
                let job = r
                    .jobs
                    .iter()
                    .find(|j| j.binding.agreement_id == o.receipt.agreement_id)
                    .unwrap();
                let t = job.token.as_ref().unwrap();
                let p = r.permits.iter().find(|p| &p.token == t).unwrap();
                (p.binding.provider == event.provider
                    && !started.contains(t)
                    && event.tick < p.observe_before)
                    .then_some((o.sequence, t))
            })
            .collect::<Vec<_>>();
        candidates.sort_by_key(|(n, _)| *n);
        assert_eq!(candidates[0].1, token);
        assert_eq!(permit.started_tick, Some(event.tick));
        started.insert(token.clone());
    }
}
