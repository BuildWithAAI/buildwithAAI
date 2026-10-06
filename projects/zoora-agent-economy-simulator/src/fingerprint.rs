use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::{SimulationConfig, SimulationState, EventJournal, RNG_ALGORITHM};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunFingerprint {
    pub simulator_version: &'static str,
    pub rng_algorithm: &'static str,
    pub config_hash: u64,
    pub journal_hash: u64,
    pub final_state_hash: u64,
}

fn hash_value<T: Hash>(value: &T) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

impl RunFingerprint {
    pub fn build(config: &SimulationConfig, journal: &EventJournal, state: &SimulationState) -> Self {
        Self {
            simulator_version: env!("CARGO_PKG_VERSION"),
            rng_algorithm: RNG_ALGORITHM,
            config_hash: hash_value(config),
            journal_hash: hash_value(&journal.entries()),
            final_state_hash: hash_value(state),
        }
    }
}
