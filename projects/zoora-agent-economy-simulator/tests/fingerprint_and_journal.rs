use zoora_agent_economy_simulator::{RunFingerprint, SimulationConfig, SimulationEngine};

#[test]
fn identical_runs_have_identical_fingerprints() {
    let config = SimulationConfig { agent_count: 10, starting_balance: 100, ticks: 25, seed: 77 };
    let mut first = SimulationEngine::try_new(config.clone()).unwrap();
    let mut second = SimulationEngine::try_new(config.clone()).unwrap();
    first.run().unwrap();
    second.run().unwrap();

    let a = RunFingerprint::build(&config, &first.journal, &first.state);
    let b = RunFingerprint::build(&config, &second.journal, &second.state);
    assert_eq!(a, b);
}

#[test]
fn different_seed_changes_run_fingerprint() {
    let a_config = SimulationConfig { agent_count: 10, starting_balance: 100, ticks: 25, seed: 77 };
    let b_config = SimulationConfig { seed: 78, ..a_config.clone() };
    let mut first = SimulationEngine::try_new(a_config.clone()).unwrap();
    let mut second = SimulationEngine::try_new(b_config.clone()).unwrap();
    first.run().unwrap();
    second.run().unwrap();

    assert_ne!(
        RunFingerprint::build(&a_config, &first.journal, &first.state),
        RunFingerprint::build(&b_config, &second.journal, &second.state)
    );
}

#[test]
fn produced_journal_satisfies_integrity_rules() {
    let config = SimulationConfig { agent_count: 10, starting_balance: 100, ticks: 25, seed: 77 };
    let mut engine = SimulationEngine::try_new(config).unwrap();
    engine.run().unwrap();
    engine.journal.validate().unwrap();
}
