use serde::{Deserialize, Serialize};
use crate::error::SimulationError;

pub const MAX_AGENTS: usize = 100_000;
pub const MAX_EVENTS: usize = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(deny_unknown_fields)]
pub struct SimulationConfig {
    pub agent_count: usize,
    pub starting_balance: i64,
    pub ticks: u64,
    pub seed: u64,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self { agent_count: 100, starting_balance: 1_000, ticks: 1_000, seed: 42 }
    }
}

impl SimulationConfig {
    pub fn from_toml(input: &str) -> Result<Self, SimulationError> {
        let config: Self = toml::from_str(input)
            .map_err(|_| SimulationError::Configuration("invalid TOML configuration"))?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), SimulationError> {
        if !(2..=MAX_AGENTS).contains(&self.agent_count) {
            return Err(SimulationError::Configuration("agent_count must be between 2 and 100000"));
        }
        if self.starting_balance < 0 {
            return Err(SimulationError::Configuration("starting_balance must be non-negative"));
        }
        if self.ticks == 0 || self.ticks > MAX_EVENTS as u64 {
            return Err(SimulationError::Configuration("ticks must be between 1 and 100000"));
        }
        Ok(())
    }

    pub fn initial_supply(&self) -> Result<u128, SimulationError> {
        self.validate()?;
        Ok(self.agent_count as u128 * self.starting_balance as u128)
    }
}
