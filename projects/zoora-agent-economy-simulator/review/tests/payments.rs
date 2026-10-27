use zoora_review_market::{
    economy::{Phase, ScriptedOutcome},
    payment_export,
    payments::*,
};
fn config() -> PaymentConfig {
    PaymentConfig {
        seeds: vec![42],
        scenarios: PaymentScenario::ALL.to_vec(),
        agents: 16,
        rounds: 6,
        tasks_per_round: 12,
        provider_capacity: 4,
        max_quotes: 2000,
        payment_window: 4,
        evidence_grace: 6,
        service_ticks: 2,
        starting_balance: 50_000,
        price: 1000,
    }
}
fn run(s: PaymentScenario, p: PaymentPolicy) -> PaymentRun {
    PaymentRun::generate(config(), 42, s, p).unwrap()
}
#[test]
fn observed_transfers_reconcile_with_wallets_and_direct_ledger() {
    let r = run(PaymentScenario::NormalDelay, PaymentPolicy::EvidenceGrace);
    r.verify().unwrap();
    let mut balances = vec![50_000_u128; 16];
    let mut refs = std::collections::BTreeSet::new();
    for (n, f) in r.transfers.iter().enumerate() {
        assert_eq!(f.sequence, n as u64);
        assert!(refs.insert(&f.receipt.transaction_ref));
        let a = u128::from(f.receipt.amount);
        balances[f.receipt.sender as usize] -= a;
        balances[f.receipt.recipient as usize] += a;
        assert_eq!(balances.iter().sum::<u128>(), 800_000);
    }
    assert_eq!(
        balances,
        r.final_balances.iter().map(|b| b.units).collect::<Vec<_>>()
    );
    let a = &r.metrics.amounts;
    assert_eq!(a.opening_units, a.final_wallet_units);
    assert_eq!(
        a.payments_sent,
        a.adapter_payments_recorded + a.observed_unapplied_payment_units
    );
    assert_eq!(
        a.adapter_payments_recorded,
        r.direct.metrics.payments_recorded
    );
    assert_eq!(
        a.voluntary_returns_sent,
        r.direct.metrics.voluntary_refunds_recorded
    );
    assert_eq!(
        r.metrics.counts.acknowledged_work,
        r.direct
            .agreements
            .iter()
            .filter(|a| a.delivery_acknowledged)
            .count() as u64
    );
}
#[test]
fn funded_work_slots_ignore_nonpaying_sybils_without_an_identity_oracle() {
    let old = run(
        PaymentScenario::UnpaidSybilFlood,
        PaymentPolicy::ReserveOnQuote,
    );
    let gated = run(
        PaymentScenario::UnpaidSybilFlood,
        PaymentPolicy::EvidenceGrace,
    );
    let normal = run(PaymentScenario::NormalDelay, PaymentPolicy::EvidenceGrace);
    assert_eq!(
        old.rounds
            .iter()
            .filter(|r| r.phase == Phase::Stress)
            .map(|r| r.counts.quoted_work)
            .sum::<u64>(),
        0
    );
    assert_eq!(
        gated.metrics.counts.acknowledged_work,
        normal.metrics.counts.acknowledged_work
    );
    assert_eq!(gated.metrics.counts.started_attacks, 0);
    assert!(gated.metrics.counts.acknowledged_work > old.metrics.counts.acknowledged_work);
    assert!(gated
        .quotes
        .iter()
        .filter(|q| q.intention.attack_fixture)
        .all(|q| q.started_tick.is_none()));
}
#[test]
fn paid_spam_remains_a_visible_failure_instead_of_a_hidden_success() {
    let spam = run(
        PaymentScenario::PaidSybilFlood,
        PaymentPolicy::EvidenceGrace,
    );
    let normal = run(PaymentScenario::NormalDelay, PaymentPolicy::EvidenceGrace);
    assert!(spam.metrics.counts.started_attacks > 0);
    assert!(spam.metrics.counts.acknowledged_work < normal.metrics.counts.acknowledged_work);
    assert!(spam.metrics.counts.paid_work_not_started > 0);
    spam.verify().unwrap();
}
#[test]
fn grace_accepts_timely_transfers_with_late_evidence_but_strict_cutoff_does_not() {
    let strict = run(
        PaymentScenario::ObservationLag,
        PaymentPolicy::StrictObservation,
    );
    let grace = run(
        PaymentScenario::ObservationLag,
        PaymentPolicy::EvidenceGrace,
    );
    assert!(strict.metrics.counts.late_evidence_observations > 0);
    assert!(
        strict.metrics.counts.paid_work_not_started > grace.metrics.counts.paid_work_not_started
    );
    assert!(grace.metrics.counts.acknowledged_work > strict.metrics.counts.acknowledged_work);
    assert_eq!(
        strict.metrics.amounts.payments_sent,
        grace.metrics.amounts.payments_sent
    );
    assert!(grace
        .observations
        .iter()
        .filter(|o| o.receipt.availability_tick - o.receipt.simulation_tick == 6)
        .all(|o| o.eligibility == ReceiptEligibility::Eligible));
}
#[test]
fn actually_late_payments_stay_recorded_without_authorizing_work_or_refunds() {
    let r = run(PaymentScenario::LatePayment, PaymentPolicy::EvidenceGrace);
    assert!(r.metrics.counts.late_transfer_observations > 0);
    for round in r.rounds.iter().filter(|r| r.phase == Phase::Stress) {
        assert_eq!(round.counts.started_work, 0);
        assert_eq!(round.counts.acknowledged_work, 0);
        assert!(round.amounts.adapter_payments_recorded > 0);
        assert_eq!(round.amounts.voluntary_returns_sent, 0);
    }
    assert!(r.metrics.amounts.paid_not_started_net_units > 0);
    r.verify().unwrap();
}
#[test]
fn duplicate_observations_never_debit_wallets_or_credit_adapter_twice() {
    let duplicate = run(
        PaymentScenario::DuplicateReceipts,
        PaymentPolicy::EvidenceGrace,
    );
    let normal = run(PaymentScenario::NormalDelay, PaymentPolicy::EvidenceGrace);
    assert!(duplicate.metrics.counts.duplicate_observations > 0);
    assert_eq!(duplicate.transfers, normal.transfers);
    assert_eq!(duplicate.final_balances, normal.final_balances);
    assert_eq!(duplicate.metrics.amounts, normal.metrics.amounts);
    assert!(duplicate
        .observations
        .iter()
        .filter(|o| o.eligibility == ReceiptEligibility::Duplicate)
        .all(|o| o.direct_outcome.is_none()));
}
#[test]
fn unbacked_claims_cannot_become_payments_or_paid_work_slots() {
    let r = run(
        PaymentScenario::UnbackedClaims,
        PaymentPolicy::EvidenceGrace,
    );
    assert!(r.metrics.counts.unbacked_claims > 0);
    assert_eq!(r.metrics.counts.paid_attacks, 0);
    assert_eq!(r.metrics.counts.started_attacks, 0);
    assert!(r
        .observations
        .iter()
        .filter(|o| o.eligibility == ReceiptEligibility::UnbackedClaim)
        .all(|o| o.transfer_sequence.is_none() && o.direct_outcome.is_none()));
}
#[test]
fn overpayments_remain_in_transfer_truth_when_agreement_adapter_rejects_them() {
    let r = run(PaymentScenario::OutOfTerms, PaymentPolicy::EvidenceGrace);
    assert!(r.metrics.amounts.observed_unapplied_payment_units > 0);
    assert!(r.metrics.counts.adapter_rejections > 0);
    for round in r.rounds.iter().filter(|r| r.phase == Phase::Stress) {
        assert_eq!(round.amounts.adapter_payments_recorded, 0);
        assert_eq!(
            round.amounts.observed_unapplied_payment_units,
            u128::from(round.counts.paid_work) * 1001
        );
        assert_eq!(round.counts.started_work, 0);
    }
    assert_eq!(
        r.metrics.amounts.opening_units,
        r.metrics.amounts.final_wallet_units
    );
    r.verify().unwrap();
}
#[test]
fn all_matched_scenarios_and_policies_share_the_seeded_plan() {
    let mut c = config();
    c.seeds = vec![7, 42];
    let r = PaymentCampaign::generate(c.clone()).unwrap();
    assert_eq!(r.runs.len(), 48);
    for seed in [7, 42] {
        let rows: Vec<_> = r.runs.iter().filter(|r| r.seed == seed).collect();
        assert!(rows
            .iter()
            .all(|r| r.intentions_fingerprint == rows[0].intentions_fingerprint));
    }
    assert_eq!(r, PaymentCampaign::generate(c).unwrap());
    r.verify().unwrap();
}
#[test]
fn zero_budgets_and_metadata_saturation_fail_without_minting_units() {
    let mut c = config();
    c.starting_balance = 0;
    let r = PaymentRun::generate(
        c,
        42,
        PaymentScenario::NormalDelay,
        PaymentPolicy::EvidenceGrace,
    )
    .unwrap();
    assert!(r.transfers.is_empty());
    assert_eq!(r.metrics.counts.paid_work, 0);
    assert!(r.metrics.counts.insufficient_budget > 0);
    r.verify().unwrap();
    let mut c = config();
    c.max_quotes = 4;
    let r = PaymentRun::generate(
        c,
        42,
        PaymentScenario::NormalDelay,
        PaymentPolicy::EvidenceGrace,
    )
    .unwrap();
    assert_eq!(r.direct.agreements.len(), 4);
    assert!(r.metrics.counts.work_metadata_rejections > 0);
    r.verify().unwrap();
}
#[test]
fn work_capacity_and_validated_receipt_order_are_enforced() {
    let r = run(PaymentScenario::NormalDelay, PaymentPolicy::EvidenceGrace);
    assert!(r.rounds.iter().all(|r| r.counts.peak_occupied_slots <= 4));
    let mut ready = std::collections::BTreeMap::new();
    for event in &r.queue {
        match event.action {
            QueueAction::Ready => {
                ready.insert(event.agreement_id, event.sequence);
            }
            QueueAction::Started => {
                assert!(ready.contains_key(&event.agreement_id));
                assert!(
                    r.quotes
                        .iter()
                        .find(|q| q.intention.agreement_id == event.agreement_id)
                        .unwrap()
                        .started_tick
                        == Some(event.tick)
                );
            }
            _ => {}
        }
    }
}
#[test]
fn started_full_returns_are_observed_even_when_delivery_window_expires() {
    for seed in [7, 42, 99] {
        let mut c = config();
        c.seeds = vec![seed];
        c.tasks_per_round = 48;
        c.provider_capacity = 2;
        c.service_ticks = 1;
        let r = PaymentRun::generate(
            c,
            seed,
            PaymentScenario::NormalDelay,
            PaymentPolicy::EvidenceGrace,
        )
        .unwrap();
        for q in r.quotes.iter().filter(|q| {
            q.started_tick.is_some() && q.intention.outcome == ScriptedOutcome::FullReturn
        }) {
            assert!(r
                .transfers
                .iter()
                .any(|f| f.kind == TransferKind::VoluntaryReturn
                    && f.receipt.agreement_id == q.intention.agreement_id
                    && f.receipt.amount == 1000));
        }
        r.verify().unwrap();
    }
}
#[test]
fn forged_transfers_or_admission_results_fail_even_with_recomputed_hashes() {
    let mut r = run(PaymentScenario::NormalDelay, PaymentPolicy::EvidenceGrace);
    r.transfers[0].receipt.amount += 1;
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
    let mut r = run(PaymentScenario::NormalDelay, PaymentPolicy::EvidenceGrace);
    r.quotes[0].started_tick = Some(0);
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
    let mut c = config();
    c.scenarios = vec![PaymentScenario::NormalDelay];
    let mut report = PaymentCampaign::generate(c).unwrap();
    report.runs.pop();
    report.fingerprint = report.hash().unwrap();
    assert!(report.verify().is_err());
    assert!(payment_export::csv(&report).is_err());
    assert!(payment_export::html(&report).is_err());
}
#[test]
fn bounded_configs_and_major_arrays_reject_bad_input() {
    for change in [
        |c: &mut PaymentConfig| c.evidence_grace = 7,
        |c: &mut PaymentConfig| c.max_quotes = 5001,
        |c: &mut PaymentConfig| c.agents = 65,
        |c: &mut PaymentConfig| c.seeds = vec![42, 42],
        |c: &mut PaymentConfig| {
            c.rounds = 24;
            c.tasks_per_round = 64;
            c.agents = 64;
            c.provider_capacity = 16;
        },
        |c: &mut PaymentConfig| {
            c.payment_window = 6;
            c.evidence_grace = 6;
            c.service_ticks = 3;
        },
    ] {
        let mut c = config();
        change(&mut c);
        assert!(c.validate().is_err());
    }
    let mut value = serde_json::to_value(config()).unwrap();
    value["unknown"] = true.into();
    assert!(serde_json::from_value::<PaymentConfig>(value).is_err());
    value = serde_json::to_value(config()).unwrap();
    value["seeds"] = serde_json::json!(vec![1; 17]);
    assert!(serde_json::from_value::<PaymentConfig>(value).is_err());
}
#[test]
fn full_u64_seed_is_exact_in_json_and_safe_viewer_payload() {
    let mut c = config();
    c.seeds = vec![u64::MAX];
    c.scenarios = vec![PaymentScenario::NormalDelay];
    let suite = PaymentCampaign::generate(c).unwrap();
    let json = serde_json::to_string(&suite).unwrap();
    assert_eq!(
        suite,
        serde_json::from_str::<PaymentCampaign>(&json).unwrap()
    );
    let html = payment_export::html(&suite).unwrap();
    assert!(html.contains("\"seed\":\"18446744073709551615\""));
    assert!(html.contains("connect-src 'none'"));
    assert_eq!(html.matches("</script>").count(), 2);
}

#[test]
fn funding_and_observation_cutoffs_are_exclusive_at_the_exact_tick() {
    let mut c = config();
    c.payment_window = 2;
    let strict = PaymentRun::generate(
        c.clone(),
        42,
        PaymentScenario::NormalDelay,
        PaymentPolicy::StrictObservation,
    )
    .unwrap();
    assert_eq!(strict.metrics.counts.started_work, 0);
    assert!(strict.metrics.counts.late_evidence_observations > 0);
    let grace = PaymentRun::generate(
        c,
        42,
        PaymentScenario::NormalDelay,
        PaymentPolicy::EvidenceGrace,
    )
    .unwrap();
    assert!(grace.metrics.counts.started_work > 0);
    let mut c = config();
    c.payment_window = 1;
    let equal = PaymentRun::generate(
        c,
        42,
        PaymentScenario::NormalDelay,
        PaymentPolicy::EvidenceGrace,
    )
    .unwrap();
    assert_eq!(equal.metrics.counts.started_work, 0);
    assert!(equal.metrics.counts.late_transfer_observations > 0);
}
