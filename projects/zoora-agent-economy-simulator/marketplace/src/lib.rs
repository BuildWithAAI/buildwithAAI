//! AE-002 offline task economy. All activity and units are SYNTHETIC.
#![forbid(unsafe_code)]
pub mod config;
pub mod engine;
pub mod metrics;
pub mod report;
pub mod types;
pub use config::MarketConfig;
pub use engine::{MarketEngine, MarketState, Scenario};
pub use metrics::MarketMetrics;
pub use report::MarketReport;
pub use types::{Command, Outcome, Rejection, TaskStatus, Transition};
