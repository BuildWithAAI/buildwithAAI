use serde::{Deserialize, Serialize};
use zoora_agent_economy_simulator::{SimulationError, MAX_AGENTS};

pub const MAX_TASKS: usize = 10_000;
pub const MAX_EVENTS: usize = 100_000;
pub const MAX_TICKS: u64 = 100_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketConfig {
    pub agent_count: usize,
    pub starting_balance: i64,
    pub ticks: u64,
    pub seed: u64,
    pub max_tasks: usize,
    pub max_active_tasks_per_worker: usize,
    pub fee_bps: u32,
    pub scenario_tasks: usize,
    pub reward_per_task: i64,
    pub failure_bps: u32,
    pub cancellation_bps: u32,
}
impl Default for MarketConfig {
    fn default() -> Self {
        Self {
            agent_count: 100,
            starting_balance: 1_000,
            ticks: 5,
            seed: 42,
            max_tasks: 1_000,
            max_active_tasks_per_worker: 10,
            fee_bps: 250,
            scenario_tasks: 100,
            reward_per_task: 100,
            failure_bps: 2_000,
            cancellation_bps: 1_000,
        }
    }
}
impl MarketConfig {
    pub fn validate(&self) -> Result<(), SimulationError> {
        let error = |message| SimulationError::Configuration(message);
        if !(2..=MAX_AGENTS).contains(&self.agent_count) || self.starting_balance < 0 {
            return Err(error("invalid market accounts"));
        }
        if self.ticks == 0 || self.ticks > MAX_TICKS {
            return Err(error("invalid tick horizon"));
        }
        if !(1..=MAX_TASKS).contains(&self.max_tasks)
            || !(1..=self.max_tasks).contains(&self.max_active_tasks_per_worker)
        {
            return Err(error("invalid task capacity"));
        }
        if self.scenario_tasks > self.max_tasks || (self.scenario_tasks > 0 && self.ticks < 5) {
            return Err(error("scenario exceeds task capacity or tick horizon"));
        }
        if self.reward_per_task <= 0
            || self.fee_bps > 10_000
            || self.failure_bps > 10_000
            || self.cancellation_bps > 10_000
        {
            return Err(error("invalid reward or basis-point rate"));
        }
        Ok(())
    }
    pub fn from_toml(text: &str) -> Result<Self, SimulationError> {
        let config: Self = toml::from_str(text)
            .map_err(|_| SimulationError::Configuration("invalid market TOML"))?;
        config.validate()?;
        Ok(config)
    }
    pub fn initial_supply(&self) -> Result<u128, SimulationError> {
        self.validate()?;
        Ok(self.agent_count as u128 * self.starting_balance as u128)
    }
}
