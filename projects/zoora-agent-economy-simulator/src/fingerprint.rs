use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::{EventJournal, EventOutcome, EventType, RejectionReason, SimulationConfig, SimulationError, SimulationState, RNG_ALGORITHM};

pub const FINGERPRINT_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunFingerprint {
    pub schema_version: u32,
    pub simulator_version: String,
    pub rng_algorithm: String,
    pub config_hash: String,
    pub initial_state_hash: String,
    pub journal_hash: String,
    pub final_state_hash: String,
    pub run_hash: String,
}

/// Canonical domain-separated big-endian encoding, independent of Rust Hash/JSON formatting.
struct Canonical(Sha256);
impl Canonical {
    fn new(domain: &str) -> Self {
        let mut hash = Self(Sha256::new());
        hash.text("ZOORA_AE_FINGERPRINT_V1");
        hash.text(domain);
        hash
    }
    fn u64(&mut self, value: u64) { self.0.update(value.to_be_bytes()); }
    fn u32(&mut self, value: u32) { self.0.update(value.to_be_bytes()); }
    fn i64(&mut self, value: i64) { self.0.update(value.to_be_bytes()); }
    fn text(&mut self, value: &str) { self.u64(value.len() as u64); self.0.update(value.as_bytes()); }
    fn finish(self) -> String { format!("{:x}", self.0.finalize()) }
}

fn state_hash(domain: &str, state: &SimulationState) -> String {
    let mut hash = Canonical::new(domain);
    hash.u64(state.tick);
    hash.u64(state.agents.len() as u64);
    for agent in &state.agents { hash.u64(agent.id); hash.i64(agent.balance); }
    hash.finish()
}

impl RunFingerprint {
    pub fn build(config: &SimulationConfig, journal: &EventJournal, state: &SimulationState) -> Result<Self, SimulationError> {
        config.validate()?;
        journal.validate()?;
        if state.agents.len() != config.agent_count || state.tick >= config.ticks || state.total_balance()? != config.initial_supply()? || state.event_log != journal.entries() {
            return Err(SimulationError::Integrity("fingerprint input state is inconsistent"));
        }
        let mut config_hash = Canonical::new("CONFIG");
        config_hash.u64(config.agent_count as u64);
        config_hash.i64(config.starting_balance);
        config_hash.u64(config.ticks);
        config_hash.u64(config.seed);
        let initial = SimulationState::try_new(config.agent_count, config.starting_balance)?;
        let initial_state_hash = state_hash("INITIAL_STATE", &initial);
        let final_state_hash = state_hash("FINAL_STATE", state);
        let mut journal_hash = Canonical::new("JOURNAL");
        journal_hash.u64(journal.len() as u64);
        for record in journal.entries() {
            journal_hash.u64(record.processed_index);
            let event = &record.event;
            journal_hash.u64(event.event_id);
            journal_hash.u64(event.simulation_tick);
            journal_hash.u32(event.priority);
            journal_hash.u64(event.sequence);
            let EventType::Transfer { from, to, amount } = event.event_type;
            journal_hash.u32(0); // Transfer tag.
            journal_hash.u64(from);
            journal_hash.u64(to);
            journal_hash.i64(amount);
            match record.outcome {
                EventOutcome::Completed => journal_hash.u32(0),
                EventOutcome::Rejected { reason } => {
                    journal_hash.u32(1);
                    journal_hash.u32(match reason {
                        RejectionReason::InvalidAmount => 0,
                        RejectionReason::SameAgent => 1,
                        RejectionReason::UnknownSender => 2,
                        RejectionReason::UnknownRecipient => 3,
                        RejectionReason::InsufficientFunds => 4,
                        RejectionReason::RecipientOverflow => 5,
                    });
                }
            }
        }
        let mut fingerprint = Self {
            schema_version: FINGERPRINT_SCHEMA,
            simulator_version: env!("CARGO_PKG_VERSION").into(),
            rng_algorithm: RNG_ALGORITHM.into(),
            config_hash: config_hash.finish(), initial_state_hash,
            journal_hash: journal_hash.finish(), final_state_hash, run_hash: String::new(),
        };
        let mut combined = Canonical::new("RUN");
        combined.u32(fingerprint.schema_version);
        for value in [&fingerprint.simulator_version, &fingerprint.rng_algorithm, &fingerprint.config_hash, &fingerprint.initial_state_hash, &fingerprint.journal_hash, &fingerprint.final_state_hash] {
            combined.text(value);
        }
        fingerprint.run_hash = combined.finish();
        Ok(fingerprint)
    }
}
