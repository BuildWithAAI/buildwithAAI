use zoora_review_market::{authorization::*, reservation_export, reservations::*};
fn config() -> ReservationConfig {
    ReservationConfig {
        cooldown_ticks: 8,
        scenarios: ReservationScenario::ALL.to_vec(),
        authorization: AuthorizationConfig {
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
            starting_balance: 100000,
            price: 1000,
        },
    }
}
fn binding(id: u64, client: u64, provider: u64) -> PaymentBinding {
    PaymentBinding {
        agreement_id: id,
        client,
        provider,
        amount: 1000,
        delivery_deadline: 32,
    }
}
fn book() -> CapacityBook {
    let mut b = CapacityBook::new(
        config().authorization,
        AuthorizationPolicy::EvidenceWindowHold,
    )
    .unwrap();
    b.advance(4).unwrap();
    b
}
fn run(s: ReservationScenario, p: ReservationPolicy) -> ReservationRun {
    ReservationRun::generate(config(), 42, s, p).unwrap()
}
#[test]
fn unpaid_quota_is_scoped_to_wallet_and_provider() {
    let mut b = book();
    let terms = binding(1, 8, 0);
    b.grant(terms.clone()).unwrap();
    let mut q = ReservationControl::new(ReservationPolicy::PendingQuota, 8).unwrap();
    assert_eq!(
        q.evaluate(4, &binding(2, 8, 0), b.permits()).unwrap(),
        ControlReason::PendingQuota
    );
    assert_eq!(
        q.evaluate(4, &binding(3, 9, 0), b.permits()).unwrap(),
        ControlReason::Eligible
    );
    assert_eq!(
        q.evaluate(4, &binding(4, 8, 1), b.permits()).unwrap(),
        ControlReason::Eligible
    );
}
#[test]
fn consumed_permissions_are_not_unpaid_quota_or_cooldown() {
    let mut b = book();
    let terms = binding(1, 8, 0);
    let token = b.grant(terms.clone()).unwrap().unwrap();
    b.advance(5).unwrap();
    assert_eq!(
        b.consume(&token, &terms).unwrap(),
        AuthorizationAction::SendAllowed
    );
    let mut q = ReservationControl::new(ReservationPolicy::QuotaCooldown, 8).unwrap();
    assert_eq!(
        q.evaluate(5, &binding(2, 8, 0), b.permits()).unwrap(),
        ControlReason::Eligible
    );
    b.advance(12).unwrap();
    assert!(b.permits()[0].expired);
    assert_eq!(
        q.evaluate(12, &binding(2, 8, 0), b.permits()).unwrap(),
        ControlReason::Eligible
    );
}
#[test]
fn unused_expiry_cooldown_has_an_exclusive_end() {
    let mut b = book();
    let terms = binding(1, 8, 0);
    b.grant(terms.clone()).unwrap();
    b.advance(12).unwrap();
    let mut q = ReservationControl::new(ReservationPolicy::QuotaCooldown, 8).unwrap();
    assert_eq!(
        q.evaluate(12, &terms, b.permits()).unwrap(),
        ControlReason::ExpiryCooldown
    );
    assert_eq!(q.decisions().last().unwrap().blocked_until, Some(20));
    assert_eq!(
        q.evaluate(19, &terms, b.permits()).unwrap(),
        ControlReason::ExpiryCooldown
    );
    assert_eq!(
        q.evaluate(20, &terms, b.permits()).unwrap(),
        ControlReason::Eligible
    );
}
#[test]
fn quota_only_allows_retry_after_unused_expiry() {
    let mut b = book();
    let terms = binding(1, 8, 0);
    b.grant(terms.clone()).unwrap();
    b.advance(12).unwrap();
    let mut q = ReservationControl::new(ReservationPolicy::PendingQuota, 8).unwrap();
    assert_eq!(
        q.evaluate(12, &terms, b.permits()).unwrap(),
        ControlReason::Eligible
    );
}
#[test]
fn cooldown_does_not_spill_into_another_wallet_or_provider() {
    let mut b = book();
    b.grant(binding(1, 8, 0)).unwrap();
    b.advance(12).unwrap();
    let mut q = ReservationControl::new(ReservationPolicy::QuotaCooldown, 8).unwrap();
    assert_eq!(
        q.evaluate(12, &binding(2, 9, 0), b.permits()).unwrap(),
        ControlReason::Eligible
    );
    assert_eq!(
        q.evaluate(12, &binding(3, 8, 1), b.permits()).unwrap(),
        ControlReason::Eligible
    );
}
#[test]
fn unrestricted_baseline_does_not_inspect_reservation_history() {
    let mut b = book();
    let terms = binding(1, 8, 0);
    b.grant(terms.clone()).unwrap();
    let mut q = ReservationControl::new(ReservationPolicy::EvidenceHold, 8).unwrap();
    assert_eq!(
        q.evaluate(4, &terms, b.permits()).unwrap(),
        ControlReason::Eligible
    );
    b.advance(12).unwrap();
    assert_eq!(
        q.evaluate(12, &terms, b.permits()).unwrap(),
        ControlReason::Eligible
    );
}
#[test]
fn original_engine_is_preserved_for_unmodified_workloads() {
    for s in [
        ReservationScenario::NormalDelay,
        ReservationScenario::RotatingUnpaid,
        ReservationScenario::ObservationLag,
        ReservationScenario::PaidFlood,
        ReservationScenario::EvidenceAfterExpiry,
        ReservationScenario::ProviderOutage,
    ] {
        let r = run(s, ReservationPolicy::EvidenceHold);
        let previous = AuthorizationRun::generate(
            config().authorization,
            42,
            s.base(),
            AuthorizationPolicy::EvidenceWindowHold,
        )
        .unwrap();
        let old = serde_json::to_value(previous).unwrap();
        let shared = serde_json::to_value(r.work).unwrap();
        for (key, value) in shared.as_object().unwrap() {
            assert_eq!(&old[key], value, "{s:?} {key}");
        }
    }
}
#[test]
fn full_holds_keep_in_window_paid_work_startable_under_all_rules() {
    for scenario in ReservationScenario::ALL {
        for policy in ReservationPolicy::ALL {
            let r = run(scenario, policy);
            r.verify().unwrap();
            assert!(r.work.metrics.counts.peak_provider_slots <= 2);
            if scenario != ReservationScenario::EvidenceAfterExpiry {
                assert_eq!(
                    r.work.metrics.counts.paid_work_not_started, 0,
                    "{scenario:?} {policy:?}"
                );
            }
        }
    }
}
#[test]
fn quota_bounds_simultaneous_unpaid_holds_per_pair() {
    for s in ReservationScenario::ALL {
        for p in [
            ReservationPolicy::PendingQuota,
            ReservationPolicy::QuotaCooldown,
        ] {
            let r = run(s, p);
            assert!(r.controls.peak_pending_wallet_provider <= 1, "{s:?}");
        }
    }
}
#[test]
fn wallet_rotation_can_bypass_a_per_wallet_quota() {
    let concentrated = run(
        ReservationScenario::ConcentratedUnpaid,
        ReservationPolicy::PendingQuota,
    );
    let rotated = run(
        ReservationScenario::RotatingUnpaid,
        ReservationPolicy::PendingQuota,
    );
    assert!(
        rotated.work.metrics.counts.acknowledged_work
            < concentrated.work.metrics.counts.acknowledged_work
    );
    assert_eq!(rotated.work.metrics.counts.started_attacks, 0);
}
#[test]
fn cooldown_gives_time_back_after_rotating_unpaid_holds() {
    let baseline = run(
        ReservationScenario::RotatingUnpaid,
        ReservationPolicy::EvidenceHold,
    );
    let q = run(
        ReservationScenario::RotatingUnpaid,
        ReservationPolicy::QuotaCooldown,
    );
    assert!(q.controls.cooldown_refusals > 0);
    assert!(
        q.work.metrics.counts.acknowledged_work > baseline.work.metrics.counts.acknowledged_work
    );
}
#[test]
fn slow_ordinary_payers_are_not_assumed_to_be_attackers() {
    let mut c = config();
    c.cooldown_ticks = 16;
    let q = ReservationRun::generate(
        c.clone(),
        42,
        ReservationScenario::SlowPayer,
        ReservationPolicy::QuotaCooldown,
    )
    .unwrap();
    let quota = ReservationRun::generate(
        c,
        42,
        ReservationScenario::SlowPayer,
        ReservationPolicy::PendingQuota,
    )
    .unwrap();
    assert!(q.controls.cooldown_refusals > 0);
    assert!(q.controls.expired_client_send_attempts > 0);
    assert!(q.work.metrics.counts.acknowledged_work < quota.work.metrics.counts.acknowledged_work);
    assert_eq!(q.work.metrics.counts.started_attacks, 0);
}
#[test]
fn per_wallet_outcomes_reconcile_with_the_full_denominator() {
    let r = run(
        ReservationScenario::ConcentratedUnpaid,
        ReservationPolicy::QuotaCooldown,
    );
    let c = &r.work.metrics.counts;
    assert_eq!(
        r.wallets.iter().map(|w| w.intended).sum::<u64>(),
        c.intended_work
    );
    assert_eq!(r.wallets.iter().map(|w| w.paid).sum::<u64>(), c.paid_work);
    assert_eq!(
        r.wallets.iter().map(|w| w.started).sum::<u64>(),
        c.started_work
    );
    assert_eq!(
        r.wallets.iter().map(|w| w.acknowledged).sum::<u64>(),
        c.acknowledged_work
    );
    assert_eq!(
        r.controls.minimum_acknowledged_per_demanded_wallet,
        r.wallets.iter().map(|w| w.acknowledged).min().unwrap()
    );
}
#[test]
fn intentions_are_shared_across_rules_and_wallet_interventions() {
    let mut hashes = std::collections::BTreeSet::new();
    for s in ReservationScenario::ALL {
        for p in ReservationPolicy::ALL {
            hashes.insert(run(s, p).intentions_fingerprint);
        }
    }
    assert_eq!(hashes.len(), 1);
}
#[test]
fn outside_window_payment_and_provider_failure_still_have_exposure() {
    let late = run(
        ReservationScenario::EvidenceAfterExpiry,
        ReservationPolicy::QuotaCooldown,
    );
    assert!(late.work.metrics.counts.paid_work_not_started > 0);
    let outage = run(
        ReservationScenario::ProviderOutage,
        ReservationPolicy::QuotaCooldown,
    );
    assert!(outage.work.metrics.amounts.unacknowledged_net_units > 0);
    assert!(outage
        .work
        .rounds
        .iter()
        .filter(|r| r.phase == zoora_review_market::economy::Phase::Stress)
        .all(|r| r.metrics.counts.acknowledged_work == 0));
}
#[test]
fn rehashed_rule_and_wallet_forgery_cannot_replay() {
    let mut r = run(
        ReservationScenario::ConcentratedUnpaid,
        ReservationPolicy::PendingQuota,
    );
    let d = r
        .decisions
        .iter_mut()
        .find(|d| d.reason == ControlReason::PendingQuota)
        .unwrap();
    d.reason = ControlReason::Eligible;
    d.blocking_token = None;
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
    let mut r = run(
        ReservationScenario::NormalDelay,
        ReservationPolicy::EvidenceHold,
    );
    r.wallets[0].acknowledged += 1;
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
}
#[test]
fn invalid_config_and_incomplete_campaign_cannot_export() {
    let mut c = config();
    c.authorization.rounds = 3;
    c.authorization.tasks_per_round = 2;
    c.scenarios = vec![ReservationScenario::NormalDelay];
    let mut r = ReservationCampaign::generate(c.clone()).unwrap();
    assert!(reservation_export::html(&r)
        .unwrap()
        .contains("connect-src 'none'"));
    r.runs.pop();
    r.fingerprint = r.hash().unwrap();
    assert!(reservation_export::csv(&r).is_err());
    c.cooldown_ticks = 17;
    assert!(c.validate().is_err());
    assert!(ReservationControl::new(ReservationPolicy::QuotaCooldown, 0).is_err());
}
