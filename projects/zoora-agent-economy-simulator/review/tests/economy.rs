use zoora_review_market::{economy::*, economy_export};
fn config() -> EconomyConfig {
    EconomyConfig {
        seeds: vec![7, 42],
        scenarios: StressScenario::ALL.to_vec(),
        agents: 16,
        rounds: 6,
        tasks_per_round: 12,
        provider_capacity: 4,
        max_unpaid_per_operator: 2,
        starting_balance: 50_000,
        price: 1000,
        fee_bps: 100,
        burn_share_bps: 5000,
        liquidity_share_bps: 2500,
    }
}
fn run(scenario: StressScenario, policy: AdmissionPolicy) -> EconomyRun {
    EconomyRun::generate(config(), 42, scenario, policy).unwrap()
}
#[test]
fn conservation_and_receipts_reconcile_without_implicit_money() {
    let r = run(StressScenario::Balanced, AdmissionPolicy::Baseline);
    r.verify().unwrap();
    let mut balances = vec![50_000_u128; 16];
    let mut fee = 0_u128;
    let mut burned = 0_u128;
    let mut lp = 0_u128;
    let mut treasury = 0_u128;
    for (n, e) in r.ledger.iter().enumerate() {
        assert_eq!(e.sequence, n as u64);
        assert!(balances[e.sender as usize] >= u128::from(e.amount + e.fee));
        balances[e.sender as usize] -= u128::from(e.amount + e.fee);
        balances[e.recipient as usize] += u128::from(e.amount);
        assert_eq!(e.fee, e.burned + e.liquidity_budget + e.treasury);
        if e.kind == TransferKind::VoluntaryReturn {
            assert_eq!(e.fee, 0);
        }
        fee += u128::from(e.fee);
        burned += u128::from(e.burned);
        lp += u128::from(e.liquidity_budget);
        treasury += u128::from(e.treasury);
        assert_eq!(balances.iter().sum::<u128>() + fee, 800_000);
        let a = r
            .community
            .direct
            .agreements
            .iter()
            .find(|a| a.terms.agreement_id == e.agreement_id)
            .unwrap();
        assert_eq!(
            e.amount,
            if e.kind == TransferKind::Payment {
                a.payments_received as u64
            } else {
                a.voluntary_refunds_received as u64
            }
        );
    }
    assert_eq!(
        balances,
        r.final_balances.iter().map(|b| b.units).collect::<Vec<_>>()
    );
    assert_eq!(r.metrics.flows.fees, fee);
    assert_eq!(r.metrics.stocks.burned_units, burned);
    assert_eq!(r.metrics.stocks.liquidity_budget_units, lp);
    assert_eq!(r.metrics.stocks.treasury_units, treasury);
    assert_eq!(
        r.metrics.flows.payments,
        r.community.direct.metrics.payments_recorded
    );
    assert_eq!(
        r.metrics.flows.voluntary_returns,
        r.community.direct.metrics.voluntary_refunds_recorded
    );
    assert_eq!(
        r.metrics.counts.acknowledged_work,
        r.community.metrics.acknowledged_deliveries
    );
    assert!(r.rounds.iter().all(|r| r.stocks.conserved()));
}
#[test]
fn seeds_scenarios_and_policies_share_the_same_exogenous_plan() {
    let mut c = config();
    c.seeds = vec![42];
    let suite = EconomyCampaign::generate(c.clone()).unwrap();
    suite.verify().unwrap();
    assert_eq!(suite.runs.len(), 16);
    assert!(suite
        .runs
        .iter()
        .all(|r| r.intentions_fingerprint == suite.runs[0].intentions_fingerprint));
    assert_eq!(suite, EconomyCampaign::generate(c).unwrap());
    let other = EconomyRun::generate(
        config(),
        7,
        StressScenario::Balanced,
        AdmissionPolicy::Baseline,
    )
    .unwrap();
    assert_ne!(
        other.intentions_fingerprint,
        suite.runs[0].intentions_fingerprint
    );
}
#[test]
fn operator_cap_reduces_shared_spam_but_declared_sybils_get_more_capacity() {
    let baseline = run(
        StressScenario::SharedOperatorSpam,
        AdmissionPolicy::Baseline,
    );
    let cap = run(
        StressScenario::SharedOperatorSpam,
        AdmissionPolicy::OperatorCap,
    );
    let sybil = run(StressScenario::SybilSpam, AdmissionPolicy::OperatorCap);
    assert_eq!(baseline.metrics.counts.admitted_attacks, 64);
    assert_eq!(cap.metrics.counts.admitted_attacks, 4);
    assert_eq!(sybil.metrics.counts.admitted_attacks, 16);
    assert!(cap.metrics.counts.acknowledged_work > baseline.metrics.counts.acknowledged_work);
    assert!(cap.metrics.counts.operator_limit_rejections > 0);
    for r in [baseline, cap, sybil] {
        r.verify().unwrap();
        assert!(r
            .community
            .direct
            .agreements
            .iter()
            .filter(|a| a.terms.agreement_id >= 100_000)
            .all(|a| a.payments_received == 0));
    }
}
#[test]
fn outage_recovers_without_rerouting_or_refunding_transfers() {
    let r = run(StressScenario::ProviderOutage, AdmissionPolicy::OperatorCap);
    assert!(r.metrics.counts.unavailable_provider_rejections > 0);
    assert!(r.community.agents.iter().all(|a| a.active));
    assert_eq!(
        r.rounds.iter().map(|r| r.phase).collect::<Vec<_>>(),
        vec![
            Phase::Normal,
            Phase::Normal,
            Phase::Stress,
            Phase::Stress,
            Phase::Recovery,
            Phase::Recovery
        ]
    );
    assert!(r
        .rounds
        .iter()
        .filter(|r| r.phase == Phase::Recovery)
        .all(|r| r.counts.unavailable_provider_rejections == 0));
    r.verify().unwrap();
}
#[test]
fn surge_uses_precommitted_extra_demand_and_preserves_denominators() {
    let normal = run(StressScenario::Balanced, AdmissionPolicy::Baseline);
    let surge = run(StressScenario::DemandSurge, AdmissionPolicy::Baseline);
    assert_eq!(normal.intentions, surge.intentions);
    assert_eq!(normal.metrics.counts.intended_work, 72);
    assert_eq!(surge.metrics.counts.intended_work, 120);
    assert!(
        surge.metrics.counts.provider_capacity_rejections
            > normal.metrics.counts.provider_capacity_rejections
    );
}
#[test]
fn no_budget_is_a_measured_refusal_not_a_minted_payment() {
    let mut c = config();
    c.starting_balance = 0;
    let r =
        EconomyRun::generate(c, 42, StressScenario::Balanced, AdmissionPolicy::Baseline).unwrap();
    assert_eq!(r.metrics.counts.budget_rejections, 72);
    assert_eq!(r.metrics.counts.admitted_work, 0);
    assert!(r.ledger.is_empty());
    assert_eq!(r.metrics.acknowledged_per_intended_bps, Some(0));
    assert_eq!(r.metrics.largest_provider_payment_share_bps, None);
    r.verify().unwrap();
}
#[test]
fn fee_routes_round_per_payment_and_never_rebate_automatically() {
    let r = run(StressScenario::Balanced, AdmissionPolicy::Baseline);
    let payments: Vec<_> = r
        .ledger
        .iter()
        .filter(|e| e.kind == TransferKind::Payment)
        .collect();
    assert!(payments
        .iter()
        .all(|e| (e.fee, e.burned, e.liquidity_budget, e.treasury) == (10, 5, 2, 3)));
    assert!(r
        .ledger
        .iter()
        .any(|e| e.kind == TransferKind::VoluntaryReturn));
    let mut c = config();
    c.fee_bps = 0;
    let free =
        EconomyRun::generate(c, 42, StressScenario::Balanced, AdmissionPolicy::Baseline).unwrap();
    assert_eq!(r.intentions, free.intentions);
    assert_eq!(free.metrics.flows.fees, 0);
    assert_eq!(
        free.metrics.stocks.agent_liquid_units,
        free.metrics.stocks.opening_units
    );
}
#[test]
fn price_one_and_maximum_fee_remain_valid_without_zero_return_receipts() {
    let mut c = config();
    c.price = 1;
    c.fee_bps = 1000;
    let r =
        EconomyRun::generate(c, 42, StressScenario::Balanced, AdmissionPolicy::Baseline).unwrap();
    assert_eq!(r.metrics.flows.fees, 0);
    assert!(r.ledger.iter().all(|e| e.amount > 0));
    r.verify().unwrap();
}
#[test]
fn digest_only_and_refusal_are_exposures_not_acknowledged_output() {
    let r = run(StressScenario::DigestOnly, AdmissionPolicy::Baseline);
    assert!(r.metrics.counts.digest_without_acknowledgment > 0);
    assert!(r.metrics.unacknowledged_net_units > r.metrics.undelivered_net_units);
    for round in r.rounds.iter().filter(|r| r.phase == Phase::Stress) {
        assert_eq!(round.counts.acknowledged_work, 0);
    }
    let refused = run(StressScenario::RefundStress, AdmissionPolicy::Baseline);
    assert!(refused
        .rounds
        .iter()
        .filter(|r| r.phase == Phase::Stress)
        .all(|r| r.flows.voluntary_returns == 0
            && r.counts.refused_returns == r.counts.admitted_work));
}
#[test]
fn forged_run_with_recomputed_hash_is_rejected() {
    let mut r = run(StressScenario::Balanced, AdmissionPolicy::Baseline);
    r.metrics.stocks.treasury_units += 1;
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
    let mut r = run(StressScenario::Balanced, AdmissionPolicy::Baseline);
    r.admissions[0].decision = AdmissionDecision::BudgetUnavailable {};
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
}
#[test]
fn campaign_rejects_missing_reordered_and_forged_rows_before_export() {
    let mut c = config();
    c.seeds = vec![42];
    c.scenarios = vec![StressScenario::Balanced];
    let suite = EconomyCampaign::generate(c).unwrap();
    let mut bad = suite.clone();
    bad.runs.pop();
    bad.fingerprint = bad.hash().unwrap();
    assert!(bad.verify().is_err());
    assert!(economy_export::html(&bad).is_err());
    assert!(economy_export::csv(&bad).is_err());
    let mut bad = suite.clone();
    bad.runs.reverse();
    bad.fingerprint = bad.hash().unwrap();
    assert!(bad.verify().is_err());
    let mut bad = suite;
    bad.runs[0].rounds[0].counts.acknowledged_work += 1;
    bad.fingerprint = bad.hash().unwrap();
    assert!(bad.verify().is_err());
}
#[test]
fn bounds_unknown_fields_and_unlisted_dimensions_fail() {
    for mutate in [
        |c: &mut EconomyConfig| c.agents = 65,
        |c: &mut EconomyConfig| c.rounds = 25,
        |c: &mut EconomyConfig| c.burn_share_bps = 8000,
        |c: &mut EconomyConfig| c.seeds = vec![42, 42],
        |c: &mut EconomyConfig| c.scenarios = vec![StressScenario::Balanced; 2],
        |c: &mut EconomyConfig| {
            c.agents = 64;
            c.rounds = 24;
            c.tasks_per_round = 64;
            c.provider_capacity = 16;
        },
    ] {
        let mut c = config();
        mutate(&mut c);
        assert!(c.validate().is_err());
    }
    assert!(EconomyRun::generate(
        config(),
        99,
        StressScenario::Balanced,
        AdmissionPolicy::Baseline
    )
    .is_err());
    let mut value = serde_json::to_value(config()).unwrap();
    value["unknown"] = true.into();
    assert!(serde_json::from_value::<EconomyConfig>(value).is_err());
    let mut value = serde_json::to_value(config()).unwrap();
    value["seeds"] = serde_json::json!(vec![1; 17]);
    assert!(serde_json::from_value::<EconomyConfig>(value).is_err());
}
#[test]
fn maximum_seed_is_exact_in_roundtrip_and_viewer_payload() {
    let mut c = config();
    c.seeds = vec![u64::MAX];
    c.scenarios = vec![StressScenario::Balanced];
    let suite = EconomyCampaign::generate(c).unwrap();
    let json = serde_json::to_string(&suite).unwrap();
    let decoded: EconomyCampaign = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded, suite);
    let html = economy_export::html(&suite).unwrap();
    assert!(html.contains("\"seed\":\"18446744073709551615\""));
    assert!(html.contains("connect-src 'none'"));
    assert_eq!(html.matches("</script>").count(), 2);
}

#[test]
fn stock_check_rejects_overflow_in_untrusted_public_values() {
    let stocks = Stocks {
        opening_units: 0,
        agent_liquid_units: u128::MAX,
        treasury_units: 1,
        liquidity_budget_units: 0,
        burned_units: 0,
    };
    assert!(!stocks.conserved());
}
