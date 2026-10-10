use zoora_review_market::{
    allocation::{Action, AllocationConfig, AllocationReport, Stage},
    experiments::{ExperimentConfig, ExperimentSuite},
    viewer, CaseStatus, Command, Outcome, Rejection, ReviewConfig, ReviewEngine, ReviewReport,
    Verdict,
};
use zoora_task_market::MarketConfig;
fn config() -> ReviewConfig {
    ReviewConfig {
        market: MarketConfig {
            agent_count: 6,
            ticks: 12,
            scenario_tasks: 0,
            max_tasks: 100,
            max_active_tasks_per_worker: 100,
            starting_balance: 100_000,
            ..MarketConfig::default()
        },
        operators: (0..6).collect(),
        ..ReviewConfig::default()
    }
}
fn policy(capacity: u64) -> AllocationConfig {
    AllocationConfig {
        reviewer_accounts: vec![2, 3, 4, 5],
        max_active_per_operator: capacity,
    }
}
fn engine(capacity: u64) -> ReviewEngine {
    ReviewEngine::with_allocation(config(), policy(capacity)).unwrap()
}
fn post(id: u64) -> Command {
    Command::PostAllocated {
        task_id: id,
        client: 0,
        title: "synthetic work".into(),
        criteria_digest: "c".repeat(64),
        reward: 100,
        deadline_tick: 9,
    }
}
fn decision(id: u64, reviewer: u64, appeal: bool) -> Command {
    if appeal {
        Command::AppealDecision {
            task_id: id,
            reviewer,
            verdict: Verdict::Approve,
            artifact_digest: "a".repeat(64),
            criteria_digest: "c".repeat(64),
            reason_digest: "e".repeat(64),
        }
    } else {
        Command::Review {
            task_id: id,
            reviewer,
            verdict: Verdict::Approve,
            artifact_digest: "a".repeat(64),
            criteria_digest: "c".repeat(64),
            reason_digest: "e".repeat(64),
        }
    }
}
fn submit(e: &mut ReviewEngine, id: u64) {
    e.schedule(0, post(id)).unwrap();
    e.schedule(
        1,
        Command::Accept {
            task_id: id,
            worker: 1,
        },
    )
    .unwrap();
    e.schedule(
        2,
        Command::Submit {
            task_id: id,
            worker: 1,
            artifact_digest: "a".repeat(64),
        },
    )
    .unwrap();
}
fn done(mut e: ReviewEngine) -> AllocationReport {
    e.run().unwrap();
    let r = AllocationReport::from_engine(&e).unwrap();
    r.verify().unwrap();
    r
}
fn has(r: &AllocationReport, reason: Rejection) -> bool {
    r.review
        .journal
        .iter()
        .any(|v| v.outcome == Outcome::Rejected { reason })
}
#[test]
fn pool_validation_rejects_duplicates_unsorted_invalid_and_zero_capacity() {
    for p in [
        AllocationConfig {
            reviewer_accounts: vec![],
            max_active_per_operator: 1,
        },
        AllocationConfig {
            reviewer_accounts: vec![2, 2],
            max_active_per_operator: 1,
        },
        AllocationConfig {
            reviewer_accounts: vec![3, 2],
            max_active_per_operator: 1,
        },
        AllocationConfig {
            reviewer_accounts: vec![6],
            max_active_per_operator: 1,
        },
        policy(0),
        policy(5001),
    ] {
        assert!(ReviewEngine::with_allocation(config(), p).is_err());
    }
}
#[test]
fn simultaneous_posts_balance_operators_deterministically() {
    let mut e = engine(10);
    for id in 0..12 {
        e.schedule(0, post(id)).unwrap();
    }
    e.advance_to(0).unwrap();
    assert_eq!(
        e.cases()
            .iter()
            .map(|c| c.primary_reviewer)
            .collect::<Vec<_>>(),
        vec![2, 3, 4, 5, 2, 3, 4, 5, 2, 3, 4, 5]
    );
    let r = done(e);
    assert!(r.metrics.assignments_by_operator.values().all(|n| *n == 3));
    assert_eq!(r.metrics.active_at_finish, 0);
}
#[test]
fn capacity_rejects_before_funding_and_does_not_create_case() {
    let mut e = engine(1);
    for id in 0..5 {
        e.schedule(0, post(id)).unwrap();
    }
    let r = done(e);
    assert_eq!(r.review.cases.len(), 4);
    assert_eq!(r.review.market.metrics.escrow_funded, 400);
    assert_eq!(r.metrics.capacity_rejections, 1);
    assert!(has(&r, Rejection::ReviewerCapacity));
    assert!(r.metrics.peak_active_by_operator.values().all(|n| *n == 1));
}
#[test]
fn cancellation_frees_capacity_for_a_later_post_same_tick() {
    let mut e = engine(1);
    for id in 0..4 {
        e.schedule(0, post(id)).unwrap();
    }
    e.schedule(
        1,
        Command::Cancel {
            task_id: 0,
            client: 0,
        },
    )
    .unwrap();
    e.schedule(1, post(4)).unwrap();
    let r = done(e);
    assert_eq!(r.review.cases.len(), 5);
    assert_eq!(r.review.cases[0].status, CaseStatus::Cancelled);
    assert_eq!(r.review.cases[4].primary_reviewer, 2);
    assert_eq!(r.metrics.capacity_rejections, 0);
}
#[test]
fn worker_failure_releases_primary_reservation() {
    let mut e = engine(1);
    for id in 0..4 {
        e.schedule(0, post(id)).unwrap();
    }
    e.schedule(
        1,
        Command::Accept {
            task_id: 0,
            worker: 1,
        },
    )
    .unwrap();
    e.schedule(
        2,
        Command::Fail {
            task_id: 0,
            worker: 1,
        },
    )
    .unwrap();
    e.schedule(2, post(4)).unwrap();
    let r = done(e);
    assert_eq!(r.review.cases[0].status, CaseStatus::Failed);
    assert_eq!(r.review.cases.len(), 5);
}
#[test]
fn primary_decision_releases_work_capacity_before_appeal_window_closes() {
    let mut e = engine(1);
    submit(&mut e, 0);
    for id in 1..4 {
        e.schedule(0, post(id)).unwrap();
    }
    e.schedule(3, decision(0, 2, false)).unwrap();
    e.schedule(3, post(4)).unwrap();
    e.advance_to(3).unwrap();
    assert_eq!(e.case(0).unwrap().status, CaseStatus::Provisional);
    assert_eq!(e.case(4).unwrap().primary_reviewer, 2);
    done(e);
}
#[test]
fn deadline_releases_all_reservations_before_external_events() {
    let mut e = engine(1);
    for id in 0..4 {
        e.schedule(0, post(id)).unwrap();
    }
    let mut later = post(4);
    if let Command::PostAllocated { deadline_tick, .. } = &mut later {
        *deadline_tick = 11;
    }
    e.schedule(9, later).unwrap();
    let r = done(e);
    assert_eq!(r.review.cases.len(), 5);
    assert_eq!(r.metrics.capacity_rejections, 0);
    assert_eq!(r.metrics.active_at_finish, 0);
}
#[test]
fn rejected_market_post_and_duplicate_do_not_consume_extra_capacity() {
    let mut e = engine(1);
    let mut invalid = post(99);
    if let Command::PostAllocated { reward, .. } = &mut invalid {
        *reward = 0;
    }
    e.schedule(0, invalid).unwrap();
    e.schedule(0, post(0)).unwrap();
    e.schedule(0, post(0)).unwrap();
    for id in 1..4 {
        e.schedule(0, post(id)).unwrap();
    }
    let r = done(e);
    assert_eq!(r.metrics.assignments_by_operator.values().sum::<u64>(), 4);
    assert_eq!(r.metrics.capacity_rejections, 0);
}
#[test]
fn legacy_and_allocated_post_modes_cannot_bypass_each_other() {
    let explicit = Command::Post {
        task_id: 0,
        client: 0,
        reviewer: 2,
        title: "synthetic".into(),
        criteria_digest: "c".repeat(64),
        reward: 100,
        deadline_tick: 9,
    };
    let mut e = engine(1);
    e.schedule(0, explicit).unwrap();
    let r = done(e);
    assert!(has(&r, Rejection::PolicyMismatch));
    assert_eq!(r.review.market.metrics.escrow_funded, 0);
    let mut old = ReviewEngine::new(config()).unwrap();
    old.schedule(0, post(0)).unwrap();
    old.run().unwrap();
    let r = ReviewReport::from_engine(&old).unwrap();
    r.verify().unwrap();
    assert_eq!(r.market.metrics.escrow_funded, 0);
}
#[test]
fn allocated_engine_cannot_export_under_legacy_identity_or_run_legacy_scenario() {
    let mut e = engine(1);
    assert!(e.run_scenario().is_err());
    e.run().unwrap();
    assert!(ReviewReport::from_engine(&e).is_err());
    assert!(AllocationReport::from_engine(&e).is_ok());
}
#[test]
fn declared_worker_alias_is_rejected_as_operator_conflict() {
    let mut c = config();
    c.operators[3] = 2;
    let mut e = ReviewEngine::with_allocation(c, policy(2)).unwrap();
    e.schedule(0, post(0)).unwrap();
    e.schedule(
        1,
        Command::Accept {
            task_id: 0,
            worker: 3,
        },
    )
    .unwrap();
    let r = done(e);
    assert!(has(&r, Rejection::OperatorConflict));
    assert_eq!(r.review.cases[0].status, CaseStatus::Expired);
}
#[test]
fn extra_accounts_do_not_increase_operator_assignment_weight_or_capacity() {
    let mut c = config();
    c.market.agent_count = 9;
    c.operators = vec![0, 1, 2, 2, 2, 2, 3, 4, 5];
    let p = AllocationConfig {
        reviewer_accounts: (2..9).collect(),
        max_active_per_operator: 3,
    };
    let mut e = ReviewEngine::with_allocation(c, p).unwrap();
    for id in 0..13 {
        e.schedule(0, post(id)).unwrap();
    }
    let r = done(e);
    assert!(r.metrics.assignments_by_operator.values().all(|n| *n == 3));
    assert_eq!(r.metrics.capacity_rejections, 1);
    assert_eq!(r.metrics.assignments_by_account.get(&2), Some(&1));
    assert_eq!(r.metrics.assignments_by_account.get(&3), Some(&1));
    assert_eq!(r.metrics.assignments_by_account.get(&4), Some(&1));
}
#[test]
fn appeal_capacity_rejection_can_retry_after_capacity_is_freed() {
    let p = AllocationConfig {
        reviewer_accounts: vec![2, 3],
        max_active_per_operator: 1,
    };
    let mut e = ReviewEngine::with_allocation(config(), p).unwrap();
    submit(&mut e, 0);
    e.schedule(0, post(1)).unwrap();
    e.schedule(3, decision(0, 2, false)).unwrap();
    e.schedule(
        4,
        Command::Appeal {
            task_id: 0,
            actor: 1,
            reason_digest: "f".repeat(64),
        },
    )
    .unwrap();
    e.schedule(
        4,
        Command::Cancel {
            task_id: 1,
            client: 0,
        },
    )
    .unwrap();
    e.schedule(
        4,
        Command::Appeal {
            task_id: 0,
            actor: 1,
            reason_digest: "f".repeat(64),
        },
    )
    .unwrap();
    e.schedule(6, decision(0, 3, true)).unwrap();
    let r = done(e);
    assert_eq!(r.metrics.capacity_rejections, 1);
    assert_eq!(r.review.cases[0].status, CaseStatus::Completed);
}
#[test]
fn no_independent_appeal_keeps_primary_settlement_and_releases_load() {
    let p = AllocationConfig {
        reviewer_accounts: vec![2],
        max_active_per_operator: 1,
    };
    let mut e = ReviewEngine::with_allocation(config(), p).unwrap();
    submit(&mut e, 0);
    e.schedule(3, decision(0, 2, false)).unwrap();
    e.schedule(
        4,
        Command::Appeal {
            task_id: 0,
            actor: 1,
            reason_digest: "f".repeat(64),
        },
    )
    .unwrap();
    let r = done(e);
    assert!(has(&r, Rejection::NoIndependentReviewer));
    assert_eq!(r.review.cases[0].status, CaseStatus::Completed);
    assert_eq!(r.metrics.active_at_finish, 0);
}
#[test]
fn missing_appellate_decision_refunds_at_deadline_and_releases_reservation() {
    let mut e = engine(1);
    submit(&mut e, 0);
    e.schedule(3, decision(0, 2, false)).unwrap();
    e.schedule(
        4,
        Command::Appeal {
            task_id: 0,
            actor: 1,
            reason_digest: "f".repeat(64),
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.review.cases[0].status, CaseStatus::Expired);
    assert_eq!(r.review.market.metrics.client_refunds, 100);
    assert_eq!(r.metrics.active_at_finish, 0);
    assert_eq!(
        r.allocation_journal
            .iter()
            .filter(|v| v.stage == Stage::Appeal && v.action == Action::Released)
            .count(),
        1
    );
}
#[test]
fn recomputed_hash_cannot_hide_forged_allocation_journal_or_metrics() {
    let mut e = engine(2);
    e.schedule(0, post(0)).unwrap();
    let original = done(e);
    let mut forged = original.clone();
    forged.allocation_journal[0].reviewer = 3;
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
    let mut forged = original;
    forged.metrics.assignments_by_operator.insert(2, 99);
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
}
#[test]
fn replay_rejects_changed_capacity_when_it_changes_admission() {
    let mut e = engine(2);
    for id in 0..8 {
        e.schedule(0, post(id)).unwrap();
    }
    let mut forged = done(e);
    forged.allocation.max_active_per_operator = 1;
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
}
#[test]
fn healthy_finished_report_required_before_viewer_or_allocation_export() {
    let e = engine(1);
    assert!(AllocationReport::from_engine(&e).is_err());
    assert!(viewer::export("{}").is_err());
}
#[test]
fn strict_config_does_not_echo_secret_or_accept_unknown_fields() {
    let e = ExperimentConfig::from_toml("seed=42\ntasks=10\nsecret='sensitive'\n").unwrap_err();
    assert!(!e.to_string().contains("sensitive"));
    for tasks in [0, 501] {
        assert!(ExperimentConfig { seed: 42, tasks }.validate().is_err());
    }
}
#[test]
fn matched_experiments_improve_concentration_and_expose_spam_starvation() {
    let suite = ExperimentSuite::generate(ExperimentConfig {
        seed: 42,
        tasks: 100,
    })
    .unwrap();
    suite.verify().unwrap();
    assert_eq!(suite.experiments.len(), 5);
    let normal = &suite.experiments[0];
    let alias = &suite.experiments[1];
    assert_eq!(normal.intents, alias.intents);
    assert_eq!(
        normal.allocated.metrics.decisions_by_operator,
        alias.allocated.metrics.decisions_by_operator
    );
    assert!(
        normal
            .allocated
            .metrics
            .largest_operator_decision_share_bps
            .unwrap()
            < 2500
    );
    assert_eq!(
        normal.baseline.market.metrics.worker_payments,
        normal.allocated.review.market.metrics.worker_payments
    );
    assert_eq!(
        normal.baseline.market.metrics.client_refunds,
        normal.allocated.review.market.metrics.client_refunds
    );
    let stress = &suite.experiments[2];
    assert_eq!(stress.allocated.review.cases.len(), 16);
    assert!(stress.allocated.metrics.capacity_rejections >= 84);
    let attacks = &suite.experiments[3];
    assert!(attacks.allocated.metrics.independence_rejections >= 100);
    assert_eq!(
        attacks.allocated.review.market.metrics.worker_payments,
        normal.allocated.review.market.metrics.worker_payments
    );
    let spam = &suite.experiments[4];
    assert_eq!(spam.allocated.review.cases.len(), 32);
    assert_eq!(spam.allocated.metrics.active_at_finish, 0);
    assert_eq!(spam.allocated.review.market.metrics.escrow_funded, 3200);
}
#[test]
fn seed_and_serialization_are_deterministic_but_seed_changes_output() {
    let c = ExperimentConfig {
        seed: 17,
        tasks: 10,
    };
    let a = ExperimentSuite::generate(c.clone()).unwrap();
    let b = ExperimentSuite::generate(c).unwrap();
    assert_eq!(
        serde_json::to_vec(&a).unwrap(),
        serde_json::to_vec(&b).unwrap()
    );
    assert_ne!(
        a.fingerprint,
        ExperimentSuite::generate(ExperimentConfig {
            seed: 18,
            tasks: 10
        })
        .unwrap()
        .fingerprint
    );
}
#[test]
fn recomputed_suite_hash_cannot_hide_changed_intents_or_selected_policy() {
    let mut suite = ExperimentSuite::generate(ExperimentConfig { seed: 42, tasks: 5 }).unwrap();
    suite.experiments[0].intents[0].verdict = suite.experiments[0].intents[0].verdict.flipped();
    // Recompute the intentions hash independently, then the outer suite hash.
    use sha2::{Digest, Sha256};
    let bytes = serde_json::to_vec(&suite.experiments[0].intents).unwrap();
    let mut hash = Sha256::new();
    hash.update(b"ZOORA_AE004_INTENTIONS_V1\0");
    hash.update(bytes);
    suite.experiments[0].workload_fingerprint = format!("{:x}", hash.finalize());
    suite.fingerprint = suite.hash().unwrap();
    assert!(suite.verify().is_err());
}
#[test]
fn forged_report_never_exports_a_verified_viewer() {
    let mut e = engine(1);
    e.schedule(0, post(0)).unwrap();
    let mut r = done(e);
    r.review.cases[0].primary_reviewer = 3;
    r.fingerprint = r.hash().unwrap();
    assert!(viewer::export(&serde_json::to_string(&r).unwrap()).is_err());
}
#[test]
fn viewer_escapes_hostile_title_and_contains_no_external_assets() {
    let mut e = engine(1);
    let mut command = post(0);
    if let Command::PostAllocated { title, .. } = &mut command {
        *title = "</script><img src=x onerror=globalThis.injected=1> & wallet".into();
    }
    e.schedule(0, command).unwrap();
    let r = done(e);
    let html = viewer::export(&serde_json::to_string(&r).unwrap()).unwrap();
    assert!(!html.contains("<img src=x"));
    assert!(html.contains("\\u003c/script\\u003e"));
    assert!(html.contains("connect-src 'none'"));
    assert!(html.contains("script-src 'sha256-"));
    assert_eq!(html.matches("</script>").count(), 2);
    assert!(html.contains("REPLAY_VERIFIED_AT_EXPORT"));
    assert!(!html.contains("<script src="));
}
#[test]
fn allocation_round_trip_is_strict_and_byte_stable() {
    let mut e = engine(3);
    for id in 0..4 {
        e.schedule(0, post(id)).unwrap();
    }
    let r = done(e);
    let bytes = serde_json::to_vec_pretty(&r).unwrap();
    let parsed: AllocationReport = serde_json::from_slice(&bytes).unwrap();
    parsed.verify().unwrap();
    assert_eq!(bytes, serde_json::to_vec_pretty(&parsed).unwrap());
    let mut value = serde_json::to_value(&r).unwrap();
    value["allocation"]["extra"] = serde_json::json!(true);
    assert!(serde_json::from_value::<AllocationReport>(value).is_err());
}
