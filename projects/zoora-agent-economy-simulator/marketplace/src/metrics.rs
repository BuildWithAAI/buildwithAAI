use std::collections::BTreeMap;
use serde::{Deserialize, Serialize};
use zoora_agent_economy_simulator::SimulationError;
use crate::types::{Outcome, Record, Rejection, Transition};

pub mod decimal {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &u128, serializer: S) -> Result<S::Ok, S::Error> { serializer.serialize_str(&value.to_string()) }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u128, D::Error> {
        let text = String::deserialize(deserializer)?;
        let value: u128 = text.parse().map_err(|_| serde::de::Error::custom("invalid unsigned decimal"))?;
        if value.to_string() != text { return Err(serde::de::Error::custom("noncanonical unsigned decimal")); }
        Ok(value)
    }
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketMetrics {
    pub processed_events: u64,
    pub requested_commands: u64,
    pub rejected_commands: u64,
    pub timer_events: u64,
    pub timer_noops: u64,
    pub transitions: BTreeMap<Transition, u64>,
    pub rejections: BTreeMap<Rejection, u64>,
    #[serde(with = "decimal")] pub escrow_funded: u128,
    #[serde(with = "decimal")] pub worker_payments: u128,
    #[serde(with = "decimal")] pub fees_collected: u128,
    #[serde(with = "decimal")] pub client_refunds: u128,
}
impl MarketMetrics {
    pub fn observe(&mut self, record: &Record) -> Result<(), SimulationError> {
        let mut next = self.clone();
        let add = |value: u64| value.checked_add(1).ok_or(SimulationError::Arithmetic("market observer overflow"));
        next.processed_events = add(next.processed_events)?;
        if record.event.command.is_timer() { next.timer_events = add(next.timer_events)?; }
        else { next.requested_commands = add(next.requested_commands)?; }
        match record.outcome {
            Outcome::Rejected { reason } => {
                next.rejected_commands = add(next.rejected_commands)?;
                let count = next.rejections.entry(reason).or_default(); *count = add(*count)?;
            }
            Outcome::TimerNoop {} => {
                if !record.event.command.is_timer() { return Err(SimulationError::Integrity("non-timer no-op")); }
                next.timer_noops = add(next.timer_noops)?;
            }
            Outcome::Applied { transition, escrow_funded, worker_payment, fee, client_refund } => {
                let count = next.transitions.entry(transition).or_default(); *count = add(*count)?;
                for (total, amount) in [(&mut next.escrow_funded, escrow_funded), (&mut next.worker_payments, worker_payment), (&mut next.fees_collected, fee), (&mut next.client_refunds, client_refund)] {
                    let amount = u128::try_from(amount).map_err(|_| SimulationError::Integrity("negative observer movement"))?;
                    *total = total.checked_add(amount).ok_or(SimulationError::Arithmetic("market observer volume overflow"))?;
                }
            }
        }
        *self = next; Ok(())
    }
}
