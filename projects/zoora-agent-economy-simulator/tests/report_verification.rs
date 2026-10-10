use zoora_agent_economy_simulator::{
    Event, RunFingerprint, RunReport, ScenarioKind, SimulationConfig, SimulationEngine, MAX_AGENTS,
    MAX_EVENTS,
};
fn normal() -> RunReport {
    let mut engine = SimulationEngine::new(SimulationConfig {
        agent_count: 3,
        starting_balance: 10,
        ticks: 5,
        seed: 42,
    });
    engine.run().unwrap();
    RunReport::from_engine(&engine).unwrap()
}
#[test]
fn report_round_trip_and_full_replay_verification() {
    let original = normal();
    let text = serde_json::to_string_pretty(&original).unwrap();
    let parsed: RunReport = serde_json::from_str(&text).unwrap();
    assert_eq!(original, parsed);
    parsed.verify().unwrap();
    assert_eq!(parsed.data_classification, "SYNTHETIC");
    assert_eq!(parsed.balance_unit, "SIMULATED_UNITS");
}
#[test]
fn report_tampering_in_each_derived_section_is_rejected() {
    for part in 0..9 {
        let mut report = normal();
        match part {
            0 => report.schema_version += 1,
            1 => report.data_classification = "OBSERVED".into(),
            2 => report.balance_unit = "SOL".into(),
            3 => report.simulator_version = "future".into(),
            4 => report.rng_algorithm = "other".into(),
            5 => report.final_state.agents[0].balance += 1,
            6 => report.metrics.transfers_completed += 1,
            7 => report.summary.top_one_share_bps = Some(9999),
            _ => report.fingerprint.run_hash = "0".repeat(64),
        }
        assert!(report.verify().is_err(), "tampered section {part}");
    }
}
#[test]
fn malformed_journal_cannot_bypass_replay_via_deserialization() {
    for mutation in 0..4 {
        let mut value = serde_json::to_value(normal()).unwrap();
        let records = value["journal"]["entries"].as_array_mut().unwrap();
        match mutation {
            0 => records[1]["processed_index"] = 99.into(),
            1 => records[1]["event"]["event_id"] = 0.into(),
            2 => records[1]["event"]["sequence"] = 0.into(),
            _ => {
                records.swap(0, 1);
                records[0]["processed_index"] = 0.into();
                records[1]["processed_index"] = 1.into();
            }
        }
        let report: RunReport = serde_json::from_value(value).unwrap();
        assert!(report.verify().is_err());
    }
}
#[test]
fn missing_unknown_and_noncanonical_json_fields_are_rejected() {
    for mutation in 0..8 {
        let mut value = serde_json::to_value(normal()).unwrap();
        match mutation {
            0 => {
                value.as_object_mut().unwrap().remove("fingerprint");
            }
            1 => value["unexpected"] = true.into(),
            2 => value["config"]["wallet_secret"] = "private".into(),
            3 => value["journal"]["entries"][0]["outcome"]["extra"] = true.into(),
            4 => value["metrics"]["total_transferred"] = "05".into(),
            5 => value["metrics"]["total_transferred"] = "-1".into(),
            6 => value["metrics"]["total_transferred"] = 5.into(),
            _ => {
                value["metrics"]["total_transferred"] =
                    "340282366920938463463374607431768211456".into()
            }
        }
        assert!(serde_json::from_value::<RunReport>(value).is_err(), "mutation {mutation}");
    }
}
#[test]
fn journal_and_account_deserialization_have_hard_capacity_limits() {
    let mut value = serde_json::to_value(normal()).unwrap();
    let record = value["journal"]["entries"][0].clone();
    value["journal"]["entries"] = vec![record; MAX_EVENTS + 1].into();
    assert!(serde_json::from_value::<RunReport>(value).is_err());
    let mut value = serde_json::to_value(normal()).unwrap();
    let agent = value["final_state"]["agents"][0].clone();
    value["final_state"]["agents"] = vec![agent; MAX_AGENTS + 1].into();
    assert!(serde_json::from_value::<RunReport>(value).is_err());
}
#[test]
fn normal_identity_requires_the_seeded_scenario_not_just_valid_replay() {
    let config = SimulationConfig {
        agent_count: 3,
        starting_balance: 10,
        ticks: 5,
        seed: 42,
    };
    let mut engine = SimulationEngine::new(config);
    engine
        .schedule(Event::transfer(100, 0, 100, 0, 1, 2))
        .unwrap();
    engine.run_pending().unwrap();
    let mut report = RunReport::from_engine(&engine).unwrap();
    report.verify().unwrap();
    report.scenario = ScenarioKind::NormalTransfersV1;
    assert!(report.verify().is_err());
}
#[test]
fn empty_manual_journal_is_an_explicit_verified_no_operation() {
    let engine = SimulationEngine::new(SimulationConfig::default());
    let report = RunReport::from_engine(&engine).unwrap();
    assert_eq!(report.scenario, ScenarioKind::ManualEventsV1);
    assert_eq!(report.summary.processed_requests, 0);
    report.verify().unwrap();
}
#[test]
fn stable_fingerprint_matches_independent_python_sha256_vector() {
    let config = SimulationConfig {
        agent_count: 2,
        starting_balance: 10,
        ticks: 3,
        seed: 42,
    };
    let mut engine = SimulationEngine::new(config.clone());
    engine.schedule(Event::transfer(0, 0, 0, 0, 1, 3)).unwrap();
    engine.schedule(Event::transfer(1, 1, 1, 1, 0, 30)).unwrap();
    engine.run_pending().unwrap();
    let fingerprint = RunFingerprint::build(&config, engine.journal(), engine.state()).unwrap();
    assert_eq!(
        fingerprint.config_hash,
        "0dd7012a610eaa3681d1cf17ca1db88ecdebe785a5eabe126028a76dbb66366e"
    );
    assert_eq!(
        fingerprint.initial_state_hash,
        "332e54f5cfb9d9558f9ddf969f7381fc2dc6ffe19bc680c74ff102478dd1593a"
    );
    assert_eq!(
        fingerprint.journal_hash,
        "f3e34eea64e8e4b05485a569a9890c5eecb1224731d9cf91a15b88b4b838eef5"
    );
    assert_eq!(
        fingerprint.final_state_hash,
        "ca6a34f99fa42233a078781e663f827c83139d77eaa9961029a28e7d9aee1a4e"
    );
    assert_eq!(
        fingerprint.run_hash,
        "99b6a40d34479f9c19d4d5be146dcc71f6f8db8ff5009f8dc85d6dec12300017"
    );
}
