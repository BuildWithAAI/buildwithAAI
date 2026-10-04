use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SimulationConfig {
    pub agent_count: usize,
    pub starting_balance: i64,
    pub ticks: u64,
    pub seed: u64,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            agent_count: 100,
            starting_balance: 1_000,
            ticks: 1_000,
            seed: 42,
        }
    }
}

impl SimulationConfig {
    pub fn from_toml(input: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(input)
    }
}
