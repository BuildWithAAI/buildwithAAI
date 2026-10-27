//! Offline deterministic research simulator. All account units and activity are synthetic.
#![forbid(unsafe_code)]
pub mod agent;
pub mod config;
pub mod engine;
pub mod error;
pub mod event;
pub mod fingerprint;
pub mod journal;
pub mod metrics;
pub mod report;
pub mod rng;
pub mod scheduler;
pub mod state;

pub use agent::Agent;
pub use config::{SimulationConfig, MAX_AGENTS, MAX_EVENTS};
pub use engine::{ScenarioKind, SimulationEngine};
pub use error::SimulationError;
pub use event::{Event, EventOutcome, EventRecord, EventType, RejectionReason};
pub use fingerprint::RunFingerprint;
pub use journal::EventJournal;
pub use metrics::Metrics;
pub use report::{RunReport, RunSummary};
pub use rng::{DeterministicRng, RNG_ALGORITHM};
pub use scheduler::EventScheduler;
pub use state::SimulationState;
