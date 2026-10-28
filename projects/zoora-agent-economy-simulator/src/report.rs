use crate::metrics::decimal_u128;
use crate::{
    Agent, EventJournal, Metrics, RunFingerprint, ScenarioKind, SimulationConfig, SimulationEngine,
    SimulationError, SimulationState, MAX_AGENTS, RNG_ALGORITHM,
};
use serde::{
    de::{IgnoredAny, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use std::fmt;

pub const REPORT_SCHEMA: u32 = 1;
pub const REPORT_KIND: &str = "SYNTHETIC_AGENT_ECONOMY_SIMULATION";
pub const DATA_CLASSIFICATION: &str = "SYNTHETIC";
pub const BALANCE_UNIT: &str = "SIMULATED_UNITS";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateSnapshot {
    pub tick: u64,
    #[serde(deserialize_with = "deserialize_agents")]
    pub agents: Vec<Agent>,
}
fn deserialize_agents<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Agent>, D::Error> {
    struct Accounts;
    impl<'de> Visitor<'de> for Accounts {
        type Value = Vec<Agent>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "at most {MAX_AGENTS} accounts")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut accounts = Vec::new();
            while accounts.len() < MAX_AGENTS {
                match seq.next_element()? {
                    Some(agent) => accounts.push(agent),
                    None => return Ok(accounts),
                }
            }
            if seq.next_element::<IgnoredAny>()?.is_some() {
                return Err(serde::de::Error::custom("account limit exceeded"));
            }
            Ok(accounts)
        }
    }
    deserializer.deserialize_seq(Accounts)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunSummary {
    #[serde(with = "decimal_u128")]
    pub initial_supply: u128,
    #[serde(with = "decimal_u128")]
    pub final_supply: u128,
    pub conservation_passed: bool,
    pub agents: usize,
    pub processed_requests: u64,
    pub completed_transfers: u64,
    pub rejected_transfers: u64,
    pub minimum_balance: i64,
    pub maximum_balance: i64,
    pub zero_balance_accounts: usize,
    pub top_one_share_bps: Option<u32>,
    pub top_ten_share_bps: Option<u32>,
}
impl RunSummary {
    fn build(
        config: &SimulationConfig,
        state: &SimulationState,
        metrics: &Metrics,
    ) -> Result<Self, SimulationError> {
        let final_supply = state.total_balance()?;
        let initial_supply = config.initial_supply()?;
        let mut balances: Vec<i64> = state.agents.iter().map(|agent| agent.balance).collect();
        balances.sort_unstable_by(|a, b| b.cmp(a));
        let share = |amount: u128| -> Option<u32> {
            (final_supply != 0).then(|| ((amount * 10_000) / final_supply) as u32)
        };
        Ok(Self {
            initial_supply,
            final_supply,
            conservation_passed: initial_supply == final_supply,
            agents: balances.len(),
            processed_requests: metrics.events_processed,
            completed_transfers: metrics.transfers_completed,
            rejected_transfers: metrics.transfers_rejected,
            minimum_balance: *balances
                .last()
                .ok_or(SimulationError::Integrity("no accounts"))?,
            maximum_balance: balances[0],
            zero_balance_accounts: balances.iter().filter(|balance| **balance == 0).count(),
            top_one_share_bps: share(balances[0] as u128),
            top_ten_share_bps: share(
                balances
                    .iter()
                    .take(10)
                    .map(|balance| *balance as u128)
                    .sum(),
            ),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunReport {
    pub schema_version: u32,
    pub kind: String,
    pub data_classification: String,
    pub balance_unit: String,
    pub simulator_version: String,
    pub rng_algorithm: String,
    pub scenario: ScenarioKind,
    pub config: SimulationConfig,
    pub journal: EventJournal,
    pub final_state: StateSnapshot,
    pub metrics: Metrics,
    pub summary: RunSummary,
    pub fingerprint: RunFingerprint,
}
impl RunReport {
    pub fn from_engine(engine: &SimulationEngine) -> Result<Self, SimulationError> {
        if engine.pending_events() != 0 {
            return Err(SimulationError::Integrity(
                "report requires a drained event queue",
            ));
        }
        engine.audit()?;
        Ok(Self {
            schema_version: REPORT_SCHEMA,
            kind: REPORT_KIND.into(),
            data_classification: DATA_CLASSIFICATION.into(),
            balance_unit: BALANCE_UNIT.into(),
            simulator_version: env!("CARGO_PKG_VERSION").into(),
            rng_algorithm: RNG_ALGORITHM.into(),
            scenario: engine.scenario(),
            config: engine.config().clone(),
            journal: engine.journal().clone(),
            final_state: StateSnapshot {
                tick: engine.state().tick,
                agents: engine.state().agents.clone(),
            },
            metrics: engine.metrics().clone(),
            summary: RunSummary::build(engine.config(), engine.state(), engine.metrics())?,
            fingerprint: RunFingerprint::build(engine.config(), engine.journal(), engine.state())?,
        })
    }

    /// Replay outcomes and recompute all derived content. Hashes do not establish authorship.
    pub fn verify(&self) -> Result<(), SimulationError> {
        if self.schema_version != REPORT_SCHEMA
            || self.kind != REPORT_KIND
            || self.data_classification != DATA_CLASSIFICATION
            || self.balance_unit != BALANCE_UNIT
            || self.simulator_version != env!("CARGO_PKG_VERSION")
            || self.rng_algorithm != RNG_ALGORITHM
        {
            return Err(SimulationError::Replay(
                "unsupported report identity or schema",
            ));
        }
        let replayed = SimulationEngine::replay_engine(self.config.clone(), &self.journal)?;
        let mut expected = Self::from_engine(&replayed)?;
        expected.scenario = self.scenario;
        if &expected != self {
            return Err(SimulationError::Replay(
                "report does not match replayed data",
            ));
        }
        if self.scenario == ScenarioKind::NormalTransfersV1 {
            let mut normal = SimulationEngine::try_new(self.config.clone())?;
            normal.run()?;
            if normal.journal() != &self.journal {
                return Err(SimulationError::Replay(
                    "journal does not match the seeded normal scenario",
                ));
            }
        }
        Ok(())
    }
}
