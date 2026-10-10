use zoora_agent_economy_simulator::{SimulationConfig, SimulationEngine};

#[test]
fn invalid_configuration_is_rejected() {
    let config = SimulationConfig { agent_count: 1, starting_balance: 100, ticks: 10, seed: 1 };
    assert!(SimulationEngine::try_new(config).is_err());

    let config = SimulationConfig { agent_count: 2, starting_balance: -1, ticks: 10, seed: 1 };
    assert!(SimulationEngine::try_new(config).is_err());

    let config = SimulationConfig { agent_count: 2, starting_balance: 100, ticks: 0, seed: 1 };
    assert!(SimulationEngine::try_new(config).is_err());
}

#[test]
fn journal_replay_reconstructs_final_state() {
    let config = SimulationConfig { agent_count: 10, starting_balance: 100, ticks: 25, seed: 12345 };
    let mut engine = SimulationEngine::try_new(config.clone()).unwrap();
    engine.run().unwrap();

    let replayed = SimulationEngine::replay(config, engine.journal()).unwrap();
    assert_eq!(&replayed, engine.state());
}
