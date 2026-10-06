use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
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
    pub fn from_toml(input: &str) -> Result<Self, String> {
        let config: Self = toml::from_str(input).map_err(|error| error.to_string())?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.agent_count < 2 { return Err("agent_count must be at least 2".into()); }
        if self.starting_balance < 0 { return Err("starting_balance must be non-negative".into()); }
        if self.ticks == 0 { return Err("ticks must be greater than zero".into()); }
        Ok(())
    }
}
