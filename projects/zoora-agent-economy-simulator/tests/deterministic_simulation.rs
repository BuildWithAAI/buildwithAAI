use zoora_agent_economy_simulator::{SimulationConfig, SimulationEngine};

#[test]
fn same_config_and_seed_produce_same_result() {
    let config = SimulationConfig {
        agent_count: 10,
        starting_balance: 100,
        ticks: 25,
        seed: 12345,
    };

    let mut first = SimulationEngine::new(config.clone());
    let mut second = SimulationEngine::new(config);

    first.run().unwrap();
    second.run().unwrap();

    assert_eq!(first.state(), second.state());
    assert_eq!(first.metrics(), second.metrics());
}

#[test]
fn normal_scenario_preserves_total_balance() {
    let config = SimulationConfig {
        agent_count: 10,
        starting_balance: 100,
        ticks: 25,
        seed: 7,
    };

    let mut engine = SimulationEngine::new(config);
    engine.run().unwrap();

    let total: i64 = engine.state().agents.iter().map(|a| a.balance).sum();
    assert_eq!(total, 1_000);
    assert_eq!(engine.metrics().transfers_completed, 25);
}

#[test]
fn event_log_is_deterministically_ordered() {
    let config = SimulationConfig {
        agent_count: 4,
        starting_balance: 100,
        ticks: 8,
        seed: 99,
    };

    let mut engine = SimulationEngine::new(config);
    engine.run().unwrap();

    let ticks: Vec<u64> = engine
        .state()
        .event_log
        .iter()
        .map(|e| e.event.simulation_tick)
        .collect();
    assert_eq!(ticks, (0..8).collect::<Vec<_>>());
}
