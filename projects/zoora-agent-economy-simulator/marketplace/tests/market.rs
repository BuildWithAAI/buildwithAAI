use zoora_task_market::{
    Command, MarketConfig, MarketEngine, MarketReport, Outcome, Rejection, Scenario, TaskStatus,
    Transition,
};
fn config() -> MarketConfig {
    MarketConfig {
        agent_count: 3,
        starting_balance: 1000,
        scenario_tasks: 0,
        ..MarketConfig::default()
    }
}
fn post(id: u64, client: u64, reward: i64) -> Command {
    Command::PostTask {
        task_id: id,
        client,
        title: "review data".into(),
        acceptance_digest: "c".repeat(64),
        reward,
        deadline_tick: 4,
    }
}
fn schedule_complete(engine: &mut MarketEngine, id: u64, client: u64, worker: u64) {
    engine
        .schedule(
            1,
            Command::AcceptTask {
                task_id: id,
                worker,
            },
        )
        .unwrap();
    engine
        .schedule(
            2,
            Command::SubmitTask {
                task_id: id,
                worker,
                artifact_digest: "a".repeat(64),
            },
        )
        .unwrap();
    engine
        .schedule(
            3,
            Command::ApproveTask {
                task_id: id,
                client,
            },
        )
        .unwrap();
}
fn report(engine: &mut MarketEngine) -> MarketReport {
    engine.run().unwrap();
    let report = MarketReport::from_engine(engine).unwrap();
    report.verify().unwrap();
    report
}
fn assert_rejected(report: &MarketReport, reason: Rejection) {
    assert!(report
        .journal
        .iter()
        .any(|r| r.outcome == Outcome::Rejected { reason }));
}
#[test]
fn complete_splits_fee_and_payment() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(7, 0, 101)).unwrap();
    schedule_complete(&mut e, 7, 0, 1);
    let r = report(&mut e);
    assert_eq!(r.final_state.accounts[0].balance, 899);
    assert_eq!(r.final_state.accounts[1].balance, 1099);
    assert_eq!(r.final_state.treasury, 2);
    assert_eq!(r.metrics.worker_payments, 99);
    assert_eq!(r.metrics.client_refunds, 0);
    assert_eq!(r.metrics.timer_noops, 1);
}
#[test]
fn failure_refunds_full_reward() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(
        1,
        Command::AcceptTask {
            task_id: 0,
            worker: 1,
        },
    )
    .unwrap();
    e.schedule(
        2,
        Command::FailTask {
            task_id: 0,
            worker: 1,
        },
    )
    .unwrap();
    let r = report(&mut e);
    assert_eq!(r.final_state.tasks[0].status, TaskStatus::Failed);
    assert_eq!(r.final_state.accounts[0].balance, 1000);
    assert_eq!(r.final_state.accounts[1].failed_services, 1);
    assert_eq!(r.final_state.treasury, 0);
}
#[test]
fn cancellation_refunds_open_task() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(
        1,
        Command::CancelTask {
            task_id: 0,
            client: 0,
        },
    )
    .unwrap();
    let r = report(&mut e);
    assert_eq!(r.metrics.client_refunds, 100);
    assert_eq!(r.final_state.tasks[0].status, TaskStatus::Cancelled);
}
#[test]
fn deadline_exclusive_prevents_payment() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(
        1,
        Command::AcceptTask {
            task_id: 0,
            worker: 1,
        },
    )
    .unwrap();
    e.schedule(
        2,
        Command::SubmitTask {
            task_id: 0,
            worker: 1,
            artifact_digest: "a".repeat(64),
        },
    )
    .unwrap();
    e.schedule(
        4,
        Command::ApproveTask {
            task_id: 0,
            client: 0,
        },
    )
    .unwrap();
    let r = report(&mut e);
    assert_eq!(r.final_state.tasks[0].status, TaskStatus::Expired);
    assert_eq!(r.metrics.worker_payments, 0);
    assert_rejected(&r, Rejection::WrongState);
}
#[test]
fn open_expiry_refunds() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    let r = report(&mut e);
    assert_eq!(r.metrics.client_refunds, 100);
    assert_eq!(r.final_state.tasks[0].status, TaskStatus::Expired);
}
#[test]
fn duplicate_approval_cannot_double_pay() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    schedule_complete(&mut e, 0, 0, 1);
    e.schedule(
        3,
        Command::ApproveTask {
            task_id: 0,
            client: 0,
        },
    )
    .unwrap();
    let r = report(&mut e);
    assert_eq!(r.metrics.worker_payments, 98);
    assert_rejected(&r, Rejection::WrongState);
}
#[test]
fn unauthorized_actions_do_not_mutate() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(
        1,
        Command::CancelTask {
            task_id: 0,
            client: 2,
        },
    )
    .unwrap();
    e.schedule(
        1,
        Command::AcceptTask {
            task_id: 0,
            worker: 1,
        },
    )
    .unwrap();
    e.schedule(
        2,
        Command::SubmitTask {
            task_id: 0,
            worker: 2,
            artifact_digest: "a".repeat(64),
        },
    )
    .unwrap();
    e.schedule(
        2,
        Command::FailTask {
            task_id: 0,
            worker: 2,
        },
    )
    .unwrap();
    e.schedule(
        3,
        Command::ApproveTask {
            task_id: 0,
            client: 2,
        },
    )
    .unwrap();
    let r = report(&mut e);
    assert_eq!(r.metrics.rejections[&Rejection::UnauthorizedActor], 4);
    assert_eq!(r.metrics.client_refunds, 100);
}
#[test]
fn self_assignment_rejected() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(
        1,
        Command::AcceptTask {
            task_id: 0,
            worker: 0,
        },
    )
    .unwrap();
    assert_rejected(&report(&mut e), Rejection::SelfAssignment);
}
#[test]
fn capacity_and_duplicate_post_rejected() {
    let mut c = config();
    c.max_tasks = 1;
    c.max_active_tasks_per_worker = 1;
    let mut e = MarketEngine::new(c).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(0, post(1, 0, 100)).unwrap();
    let r = report(&mut e);
    assert_rejected(&r, Rejection::DuplicateTask);
    assert_rejected(&r, Rejection::TaskCapacity);
}
#[test]
fn worker_capacity_released_after_completion() {
    let mut c = config();
    c.ticks = 7;
    c.max_active_tasks_per_worker = 1;
    let mut e = MarketEngine::new(c).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(0, post(1, 0, 100)).unwrap();
    schedule_complete(&mut e, 0, 0, 1);
    e.schedule(
        1,
        Command::AcceptTask {
            task_id: 1,
            worker: 1,
        },
    )
    .unwrap();
    let r = report(&mut e);
    assert_rejected(&r, Rejection::WorkerCapacity);
    assert_eq!(r.final_state.accounts[1].active_tasks, 0);
}
#[test]
fn recipient_capacity_preserves_refund_reserve() {
    let mut c = config();
    c.starting_balance = i64::MAX;
    let mut e = MarketEngine::new(c).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(0, post(1, 1, 100)).unwrap();
    schedule_complete(&mut e, 0, 0, 1);
    let r = report(&mut e);
    assert_rejected(&r, Rejection::RecipientCapacity);
    assert_eq!(r.final_state.accounts[0].balance, i64::MAX);
    assert_eq!(r.final_state.accounts[1].balance, i64::MAX);
    assert_eq!(r.metrics.client_refunds, 200);
}
#[test]
fn all_fee_and_zero_fee_are_conserved() {
    for fee in [0, 10000] {
        let mut c = config();
        c.fee_bps = fee;
        let mut e = MarketEngine::new(c).unwrap();
        e.schedule(0, post(0, 0, 100)).unwrap();
        schedule_complete(&mut e, 0, 0, 1);
        let r = report(&mut e);
        assert_eq!(r.metrics.worker_payments + r.metrics.fees_collected, 100);
    }
}
#[test]
fn bad_business_commands_are_recorded() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 99, 100)).unwrap();
    e.schedule(0, post(1, 0, 0)).unwrap();
    e.schedule(0, post(2, 0, 1001)).unwrap();
    let mut p = post(3, 0, 100);
    if let Command::PostTask { deadline_tick, .. } = &mut p {
        *deadline_tick = 0;
    }
    e.schedule(0, p).unwrap();
    let mut p = post(4, 0, 100);
    if let Command::PostTask { title, .. } = &mut p {
        *title = " ".into();
    }
    e.schedule(0, p).unwrap();
    let r = report(&mut e);
    for reason in [
        Rejection::InvalidActor,
        Rejection::InvalidReward,
        Rejection::InsufficientFunds,
        Rejection::InvalidDeadline,
        Rejection::InvalidTerms,
    ] {
        assert_rejected(&r, reason);
    }
    assert!(r.final_state.tasks.is_empty());
}
#[test]
fn invalid_artifact_rejected() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.schedule(
        1,
        Command::AcceptTask {
            task_id: 0,
            worker: 1,
        },
    )
    .unwrap();
    e.schedule(
        2,
        Command::SubmitTask {
            task_id: 0,
            worker: 1,
            artifact_digest: "bad".into(),
        },
    )
    .unwrap();
    assert_rejected(&report(&mut e), Rejection::InvalidArtifact);
}
#[test]
fn unknown_task_rejected() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(
        0,
        Command::AcceptTask {
            task_id: 999,
            worker: 1,
        },
    )
    .unwrap();
    assert_rejected(&report(&mut e), Rejection::UnknownTask);
}
#[test]
fn failed_post_does_not_reserve_task_id() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 99, 100)).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    assert_eq!(report(&mut e).final_state.tasks.len(), 1);
}
#[test]
fn internal_timer_cannot_be_scheduled() {
    let mut e = MarketEngine::new(config()).unwrap();
    assert!(e.schedule(0, Command::ExpireTask { task_id: 0 }).is_err());
    assert_eq!(e.schedule(0, post(0, 0, 1)).unwrap(), 0);
}
#[test]
fn lifetime_budget_reserves_timers_atomically() {
    let mut e = MarketEngine::new(config()).unwrap();
    for _ in 0..50000 {
        e.schedule(0, post(0, 0, 1)).unwrap();
    }
    assert!(e
        .schedule(
            0,
            Command::AcceptTask {
                task_id: 0,
                worker: 1
            }
        )
        .is_err());
    assert!(e.schedule(0, post(1, 0, 1)).is_err());
    e.run().unwrap();
    assert_eq!(e.journal().len(), 50001);
    e.audit().unwrap();
}
#[test]
fn past_and_outside_horizon_rejected() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.advance_to(2).unwrap();
    assert!(e.schedule(1, post(0, 0, 1)).is_err());
    assert!(e.schedule(5, post(0, 0, 1)).is_err());
    assert!(e.advance_to(1).is_err());
}
#[test]
fn unfinished_report_and_finished_changes_rejected() {
    let mut e = MarketEngine::new(config()).unwrap();
    assert!(MarketReport::from_engine(&e).is_err());
    e.run().unwrap();
    assert!(e.run().is_err());
    assert!(e.schedule(0, post(0, 0, 1)).is_err());
}
#[test]
fn partial_escrow_then_incremental_schedule_replays() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    e.advance_to(0).unwrap();
    assert_eq!(e.state().accounts[0].refundable_escrow, 100);
    assert!(MarketReport::from_engine(&e).is_err());
    schedule_complete(&mut e, 0, 0, 1);
    report(&mut e);
}
#[test]
fn tampered_outcome_fails_semantic_replay() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    let mut r = report(&mut e);
    r.journal[0].outcome = Outcome::applied(Transition::Accepted);
    assert!(MarketEngine::replay(r.config, r.scenario, &r.journal).is_err());
}
#[test]
fn omitted_timer_fails_replay() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    schedule_complete(&mut e, 0, 0, 1);
    let mut r = report(&mut e);
    r.journal.pop();
    assert!(MarketEngine::replay(r.config, r.scenario, &r.journal).is_err());
}
#[test]
fn forged_timer_and_duplicate_identity_fail() {
    let mut e = MarketEngine::new(config()).unwrap();
    e.schedule(0, post(0, 0, 100)).unwrap();
    let r = report(&mut e);
    let mut records = r.journal.clone();
    records[1].event.simulation_tick = 3;
    assert!(MarketEngine::replay(r.config.clone(), r.scenario, &records).is_err());
    let mut records = r.journal.clone();
    records[1].event.event_id = 0;
    records[1].event.sequence = 0;
    assert!(MarketEngine::replay(r.config, r.scenario, &records).is_err());
}
#[test]
fn report_tampering_rejected() {
    let mut e = MarketEngine::new(config()).unwrap();
    let r = report(&mut e);
    let mut mutated = r.clone();
    mutated.final_state.accounts[0].balance += 1;
    assert!(mutated.verify().is_err());
    let mut mutated = r.clone();
    mutated.classification = "OBSERVED".into();
    assert!(mutated.verify().is_err());
    let mut mutated = r;
    mutated.metrics.fees_collected = 1;
    assert!(mutated.verify().is_err());
}
#[test]
fn strict_json_and_canonical_decimal() {
    let mut e = MarketEngine::new(config()).unwrap();
    let r = report(&mut e);
    let mut json = serde_json::to_value(&r).unwrap();
    json["extra"] = true.into();
    assert!(serde_json::from_value::<MarketReport>(json).is_err());
    let mut json = serde_json::to_value(&r).unwrap();
    json["final_state"]["treasury"] = "00".into();
    assert!(serde_json::from_value::<MarketReport>(json).is_err());
    assert!(serde_json::from_str::<Outcome>("{\"status\":\"TIMER_NOOP\",\"extra\":1}").is_err());
}
#[test]
fn seeded_scenario_reproducible() {
    let mut a = MarketEngine::new(MarketConfig::default()).unwrap();
    a.run_scenario().unwrap();
    let mut b = MarketEngine::new(MarketConfig::default()).unwrap();
    b.run_scenario().unwrap();
    let r = MarketReport::from_engine(&a).unwrap();
    assert_eq!(r, MarketReport::from_engine(&b).unwrap());
    r.verify().unwrap();
    assert_eq!(r.scenario, Scenario::NormalTaskMarketV1);
    assert!(r.metrics.worker_payments > 0);
    assert!(r.metrics.client_refunds > 0);
}
#[test]
fn changed_seed_changes_report() {
    let mut a = MarketEngine::new(MarketConfig::default()).unwrap();
    a.run_scenario().unwrap();
    let mut c = MarketConfig::default();
    c.seed += 1;
    let mut b = MarketEngine::new(c).unwrap();
    b.run_scenario().unwrap();
    assert_ne!(
        MarketReport::from_engine(&a).unwrap().fingerprint,
        MarketReport::from_engine(&b).unwrap().fingerprint
    );
}
#[test]
fn zero_budget_has_no_escrow_or_fees() {
    let c = MarketConfig {
        starting_balance: 0,
        ..MarketConfig::default()
    };
    let mut e = MarketEngine::new(c).unwrap();
    e.run_scenario().unwrap();
    let r = MarketReport::from_engine(&e).unwrap();
    r.verify().unwrap();
    assert_eq!(r.metrics.escrow_funded, 0);
    assert!(r.final_state.tasks.is_empty());
}
#[test]
fn configuration_and_input_bounds() {
    let mut c = config();
    c.agent_count = 1;
    assert!(MarketEngine::new(c).is_err());
    let mut c = config();
    c.fee_bps = 10001;
    assert!(c.validate().is_err());
    let mut c = config();
    c.max_tasks = 10001;
    assert!(c.validate().is_err());
    let mut e = MarketEngine::new(config()).unwrap();
    let mut p = post(0, 0, 1);
    if let Command::PostTask { title, .. } = &mut p {
        *title = "x".repeat(129);
    }
    assert!(e.schedule(0, p).is_err());
    assert!(MarketConfig::from_toml("secret = 'ignored'").is_err());
}
#[test]
fn report_round_trip() {
    let mut e = MarketEngine::new(MarketConfig::default()).unwrap();
    e.run_scenario().unwrap();
    let r = MarketReport::from_engine(&e).unwrap();
    let saved: MarketReport = serde_json::from_slice(&serde_json::to_vec(&r).unwrap()).unwrap();
    assert_eq!(r, saved);
    saved.verify().unwrap();
}
