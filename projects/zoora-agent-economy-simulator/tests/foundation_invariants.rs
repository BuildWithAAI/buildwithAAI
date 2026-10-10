use zoora_agent_economy_simulator::{
    DeterministicRng, Event, EventJournal, EventOutcome, EventRecord, EventScheduler, Metrics,
    RejectionReason, RunReport, SimulationConfig, SimulationEngine, MAX_AGENTS, MAX_EVENTS,
};

fn config(balance: i64) -> SimulationConfig {
    SimulationConfig {
        agent_count: 2,
        starting_balance: balance,
        ticks: 20,
        seed: 42,
    }
}
fn rejected(reason: RejectionReason) -> EventOutcome {
    EventOutcome::Rejected { reason }
}

#[test]
fn zero_funds_records_every_refusal_and_replays() {
    let mut engine = SimulationEngine::new(config(0));
    engine.run().unwrap();
    assert_eq!(engine.metrics().events_processed, 20);
    assert_eq!(engine.metrics().transfers_completed, 0);
    assert_eq!(engine.metrics().transfers_rejected, 20);
    assert_eq!(
        engine.metrics().rejection_counts[&RejectionReason::InsufficientFunds],
        20
    );
    assert_eq!(engine.state().total_balance().unwrap(), 0);
    let report = RunReport::from_engine(&engine).unwrap();
    assert_eq!(report.summary.top_one_share_bps, None);
    assert_eq!(report.summary.top_ten_share_bps, None);
    report.verify().unwrap();
}

#[test]
fn each_economic_rejection_is_atomic_and_observable() {
    let cases = [
        (10, 0, 1, 0, RejectionReason::InvalidAmount),
        (10, 0, 1, i64::MIN, RejectionReason::InvalidAmount),
        (10, 0, 0, 1, RejectionReason::SameAgent),
        (10, u64::MAX, 1, 1, RejectionReason::UnknownSender),
        (10, 0, u64::MAX, 1, RejectionReason::UnknownRecipient),
        (10, 0, 1, 11, RejectionReason::InsufficientFunds),
        (i64::MAX, 0, 1, 1, RejectionReason::RecipientOverflow),
    ];
    for (balance, from, to, amount, reason) in cases {
        let mut engine = SimulationEngine::new(config(balance));
        let initial = engine.state().agents.clone();
        engine
            .schedule(Event::transfer(0, 0, 0, from, to, amount))
            .unwrap();
        engine.run_pending().unwrap();
        assert_eq!(engine.state().agents, initial);
        assert_eq!(engine.journal().entries()[0].outcome, rejected(reason));
        assert_eq!(engine.metrics().total_transferred, 0);
        assert_eq!(engine.metrics().transfers_rejected, 1);
        assert_eq!(engine.metrics().rejection_counts[&reason], 1);
        RunReport::from_engine(&engine).unwrap().verify().unwrap();
    }
}

#[test]
fn refusal_does_not_prevent_later_success() {
    let mut engine = SimulationEngine::new(config(10));
    engine.schedule(Event::transfer(1, 0, 0, 0, 1, 11)).unwrap();
    engine.schedule(Event::transfer(2, 1, 1, 0, 1, 4)).unwrap();
    engine.run_pending().unwrap();
    assert_eq!(engine.state().agent(0).unwrap().balance, 6);
    assert_eq!(engine.state().agent(1).unwrap().balance, 14);
    assert_eq!(engine.metrics().transfers_completed, 1);
    assert_eq!(engine.metrics().transfers_rejected, 1);
    assert_eq!(engine.metrics().total_transferred, 4);
}

#[test]
fn wide_totals_and_volumes_do_not_overflow_i64() {
    let mut engine = SimulationEngine::new(config(i64::MAX / 2));
    let amount = i64::MAX / 2;
    for index in 0..4 {
        engine
            .schedule(Event::transfer(
                index,
                index,
                index,
                index % 2,
                (index + 1) % 2,
                amount,
            ))
            .unwrap();
    }
    engine.run_pending().unwrap();
    assert_eq!(engine.metrics().total_transferred, amount as u128 * 4);
    let report = RunReport::from_engine(&engine).unwrap();
    report.verify().unwrap();
    let encoded = serde_json::to_value(&report).unwrap();
    assert_eq!(
        encoded["metrics"]["total_transferred"],
        (amount as u128 * 4).to_string()
    );
}

#[test]
fn metrics_overflow_preserves_all_observer_fields() {
    let record = EventRecord {
        processed_index: 0,
        event: Event::transfer(0, 0, 0, 0, 1, 1),
        outcome: EventOutcome::Completed {},
    };
    for mut metrics in [
        Metrics {
            events_processed: u64::MAX,
            ..Metrics::default()
        },
        Metrics {
            transfers_requested: u64::MAX,
            ..Metrics::default()
        },
        Metrics {
            transfers_completed: u64::MAX,
            ..Metrics::default()
        },
        Metrics {
            total_transferred: u128::MAX,
            ..Metrics::default()
        },
    ] {
        let before = metrics.clone();
        assert!(metrics.observe(&record).is_err());
        assert_eq!(metrics, before);
    }
    let mut metrics = Metrics {
        transfers_rejected: u64::MAX,
        ..Metrics::default()
    };
    let before = metrics.clone();
    let refusal = EventRecord {
        outcome: rejected(RejectionReason::InsufficientFunds),
        ..record.clone()
    };
    assert!(metrics.observe(&refusal).is_err());
    assert_eq!(metrics, before);
    metrics = Metrics::default();
    metrics
        .rejection_counts
        .insert(RejectionReason::InsufficientFunds, u64::MAX);
    let before = metrics.clone();
    assert!(metrics.observe(&refusal).is_err());
    assert_eq!(metrics, before);
}

#[test]
fn invalid_completed_record_cannot_poison_metrics() {
    let mut metrics = Metrics::default();
    let record = EventRecord {
        processed_index: 0,
        event: Event::transfer(0, 0, 0, 0, 1, 0),
        outcome: EventOutcome::Completed {},
    };
    assert!(metrics.observe(&record).is_err());
    assert_eq!(metrics, Metrics::default());
}

#[test]
fn duplicate_admissions_fail_without_consuming_valid_keys() {
    let mut scheduler = EventScheduler::default();
    scheduler
        .schedule(Event::transfer(1, 0, 1, 0, 1, 1))
        .unwrap();
    assert!(scheduler
        .schedule(Event::transfer(1, 1, 2, 0, 1, 1))
        .is_err());
    scheduler
        .schedule(Event::transfer(2, 1, 2, 0, 1, 1))
        .unwrap();
    assert!(scheduler
        .schedule(Event::transfer(3, 2, 2, 0, 1, 1))
        .is_err());
    scheduler
        .schedule(Event::transfer(3, 2, 3, 0, 1, 1))
        .unwrap();
    assert_eq!(scheduler.len(), 3);
    scheduler.pop_next().unwrap();
    assert!(scheduler
        .schedule(Event::transfer(1, 3, 4, 0, 1, 1))
        .is_err());
}

#[test]
fn priority_order_is_valid_even_when_sequence_decreases() {
    let mut engine = SimulationEngine::new(config(10));
    engine
        .schedule(Event::transfer_with_priority(0, 0, 20, 1, 0, 1, 1))
        .unwrap();
    engine
        .schedule(Event::transfer_with_priority(1, 0, 10, 2, 0, 1, 1))
        .unwrap();
    engine.run_pending().unwrap();
    assert_eq!(engine.journal().entries()[0].event.sequence, 2);
    assert_eq!(engine.journal().entries()[1].event.sequence, 1);
    engine.journal().validate().unwrap();
    RunReport::from_engine(&engine).unwrap().verify().unwrap();
}

#[test]
fn past_and_out_of_horizon_metadata_are_rejected_without_mutation() {
    let mut engine = SimulationEngine::new(config(10));
    assert!(engine.schedule(Event::transfer(0, 20, 0, 0, 1, 1)).is_err());
    engine.schedule(Event::transfer(0, 5, 0, 0, 1, 1)).unwrap();
    engine.run_pending().unwrap();
    let before = RunReport::from_engine(&engine).unwrap();
    assert!(engine.schedule(Event::transfer(1, 4, 1, 0, 1, 1)).is_err());
    assert_eq!(RunReport::from_engine(&engine).unwrap(), before);
    engine.schedule(Event::transfer(1, 6, 1, 0, 1, 1)).unwrap();
    engine.run_pending().unwrap();
    assert_eq!(engine.metrics().events_processed, 2);
}

#[test]
fn scenario_boundaries_and_pending_reports_are_enforced() {
    let mut normal = SimulationEngine::new(config(10));
    normal.run().unwrap();
    assert!(normal.run().is_err());
    assert!(normal
        .schedule(Event::transfer(40, 19, 40, 0, 1, 1))
        .is_err());
    let mut manual = SimulationEngine::new(config(10));
    manual.schedule(Event::transfer(0, 0, 0, 0, 1, 1)).unwrap();
    assert!(manual.run().is_err());
    assert!(RunReport::from_engine(&manual).is_err());
    manual.run_pending().unwrap();
    assert!(manual.run().is_err());
}

#[test]
fn bounds_unknown_fields_and_invalid_toml_are_rejected() {
    for bad in [
        SimulationConfig {
            agent_count: MAX_AGENTS + 1,
            ..config(1)
        },
        SimulationConfig {
            ticks: MAX_EVENTS as u64 + 1,
            ..config(1)
        },
    ] {
        assert!(SimulationEngine::try_new(bad).is_err());
    }
    assert!(SimulationConfig::from_toml(
        "agent_count=2\nstarting_balance=1\nticks=2\nseed=1\nunexpected=3"
    )
    .is_err());
    assert!(
        SimulationConfig::from_toml("seed=secret_input_that_should_not_be_echoed")
            .unwrap_err()
            .to_string()
            .contains("invalid TOML")
    );
    let maximum = SimulationConfig {
        agent_count: MAX_AGENTS,
        starting_balance: i64::MAX,
        ticks: MAX_EVENTS as u64,
        seed: 0,
    };
    maximum.validate().unwrap();
    assert_eq!(
        maximum.initial_supply().unwrap(),
        MAX_AGENTS as u128 * i64::MAX as u128
    );
}

#[test]
fn scheduler_capacity_is_enforced_across_pops() {
    let mut scheduler = EventScheduler::default();
    for id in 0..MAX_EVENTS as u64 {
        scheduler
            .schedule(Event::transfer(id, id, id, 0, 1, 1))
            .unwrap();
    }
    assert!(scheduler
        .schedule(Event::transfer(
            MAX_EVENTS as u64,
            0,
            MAX_EVENTS as u64,
            0,
            1,
            1
        ))
        .is_err());
    scheduler.pop_next();
    assert!(scheduler
        .schedule(Event::transfer(
            MAX_EVENTS as u64,
            0,
            MAX_EVENTS as u64,
            0,
            1,
            1
        ))
        .is_err());
}

#[test]
fn mixed_requests_conserve_accounts_and_replay_across_seeds() {
    for seed in 0..20 {
        let cfg = SimulationConfig {
            agent_count: 16,
            starting_balance: 7,
            ticks: 500,
            seed,
        };
        let mut engine = SimulationEngine::new(cfg.clone());
        let mut rng = DeterministicRng::from_seed(seed);
        for id in 0..500 {
            let from = rng.below(20).unwrap();
            let to = rng.below(20).unwrap();
            let amount = rng.below(20).unwrap() as i64 - 2;
            engine
                .schedule(Event::transfer(id, id, id, from, to, amount))
                .unwrap();
        }
        engine.run_pending().unwrap();
        assert_eq!(engine.state().total_balance().unwrap(), 112);
        assert!(engine.state().agents.iter().all(|agent| agent.balance >= 0));
        assert_eq!(
            engine.metrics().transfers_completed + engine.metrics().transfers_rejected,
            500
        );
        assert_eq!(
            &SimulationEngine::replay(cfg, engine.journal()).unwrap(),
            engine.state()
        );
        RunReport::from_engine(&engine).unwrap().verify().unwrap();
    }
}

#[test]
fn normal_scenario_is_deterministic_in_low_and_high_budget_cases() {
    for balance in [0, 1, 100, i64::MAX] {
        for seed in 0..10 {
            let cfg = SimulationConfig {
                agent_count: 17,
                starting_balance: balance,
                ticks: 400,
                seed,
            };
            let mut first = SimulationEngine::new(cfg.clone());
            let mut second = SimulationEngine::new(cfg.clone());
            first.run().unwrap();
            second.run().unwrap();
            assert_eq!(
                RunReport::from_engine(&first).unwrap(),
                RunReport::from_engine(&second).unwrap()
            );
            assert_eq!(
                first.state().total_balance().unwrap(),
                cfg.initial_supply().unwrap()
            );
            assert!(first
                .journal()
                .entries()
                .iter()
                .all(|record| match record.event.event_type {
                    zoora_agent_economy_simulator::EventType::Transfer { from, to, .. } =>
                        from != to,
                }));
        }
    }
}

#[test]
fn bounded_rng_supports_edge_bounds_and_repeatable_sampling() {
    let mut first = DeterministicRng::from_seed(123);
    let mut second = first.clone();
    assert_eq!(first.below(0), None);
    for bound in [1, 2, 3, 17, 1 << 63, (1 << 63) + 1, u64::MAX] {
        for _ in 0..100 {
            let a = first.below(bound).unwrap();
            assert!(a < bound);
            assert_eq!(Some(a), second.below(bound));
        }
    }
}

#[test]
fn maximum_supported_run_conserves_wide_supply_and_fits_report_limit() {
    let cfg = SimulationConfig {
        agent_count: MAX_AGENTS,
        starting_balance: i64::MAX,
        ticks: MAX_EVENTS as u64,
        seed: 42,
    };
    let mut engine = SimulationEngine::new(cfg.clone());
    engine.run().unwrap();
    assert_eq!(engine.metrics().events_processed, MAX_EVENTS as u64);
    assert_eq!(engine.metrics().transfers_rejected, MAX_EVENTS as u64);
    assert_eq!(
        engine.state().total_balance().unwrap(),
        cfg.initial_supply().unwrap()
    );
    let report = RunReport::from_engine(&engine).unwrap();
    report.verify().unwrap();
    let bytes = serde_json::to_vec_pretty(&report).unwrap();
    assert!(bytes.len() < 64 * 1024 * 1024);
}

#[test]
fn forged_outcomes_are_rejected_by_replay() {
    let mut engine = SimulationEngine::new(config(0));
    engine.run().unwrap();
    let mut records = engine.journal().entries().to_vec();
    records[0].outcome = EventOutcome::Completed {};
    let journal = EventJournal::from_records(records).unwrap();
    assert!(SimulationEngine::replay(config(0), &journal).is_err());
}

#[test]
fn journal_validation_rejects_each_metadata_corruption() {
    let mut engine = SimulationEngine::new(config(10));
    engine.run().unwrap();
    let original = engine.journal().entries().to_vec();
    for kind in 0..4 {
        let mut records = original.clone();
        match kind {
            0 => records[1].processed_index = 8,
            1 => records[1].event.event_id = records[0].event.event_id,
            2 => records[1].event.sequence = records[0].event.sequence,
            _ => {
                records.swap(0, 1);
                records[0].processed_index = 0;
                records[1].processed_index = 1;
            }
        }
        assert!(EventJournal::from_records(records).is_err());
    }
    let mut records = original;
    records[19].event.simulation_tick = 20;
    let journal = EventJournal::from_records(records).unwrap();
    assert!(SimulationEngine::replay(config(10), &journal).is_err());
}
