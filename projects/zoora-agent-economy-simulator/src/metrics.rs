use crate::{
    error::SimulationError,
    event::{EventOutcome, EventRecord, EventType, RejectionReason},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(crate) mod decimal_u128 {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &u128, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u128, D::Error> {
        let text = String::deserialize(deserializer)?;
        let value: u128 = text
            .parse()
            .map_err(|_| serde::de::Error::custom("invalid unsigned decimal"))?;
        if value.to_string() != text {
            return Err(serde::de::Error::custom("non-canonical unsigned decimal"));
        }
        Ok(value)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Metrics {
    pub events_processed: u64,
    pub transfers_requested: u64,
    pub transfers_completed: u64,
    pub transfers_rejected: u64,
    #[serde(with = "decimal_u128")]
    pub total_transferred: u128,
    pub rejection_counts: BTreeMap<RejectionReason, u64>,
}

impl Metrics {
    /// Compute a complete update before replacing the observer state.
    pub fn observe(&mut self, record: &EventRecord) -> Result<(), SimulationError> {
        let mut next = self.clone();
        let overflow = SimulationError::Arithmetic("metrics overflow");
        next.events_processed = next
            .events_processed
            .checked_add(1)
            .ok_or_else(|| overflow.clone())?;
        next.transfers_requested = next
            .transfers_requested
            .checked_add(1)
            .ok_or_else(|| overflow.clone())?;
        match record.outcome {
            EventOutcome::Completed => {
                let EventType::Transfer { amount, .. } = record.event.event_type;
                if amount <= 0 {
                    return Err(SimulationError::Integrity(
                        "completed transfer amount is not positive",
                    ));
                }
                next.transfers_completed = next
                    .transfers_completed
                    .checked_add(1)
                    .ok_or_else(|| overflow.clone())?;
                next.total_transferred = next
                    .total_transferred
                    .checked_add(amount as u128)
                    .ok_or_else(|| overflow.clone())?;
            }
            EventOutcome::Rejected { reason } => {
                next.transfers_rejected = next
                    .transfers_rejected
                    .checked_add(1)
                    .ok_or_else(|| overflow.clone())?;
                let count = next.rejection_counts.entry(reason).or_default();
                *count = count.checked_add(1).ok_or(overflow)?;
            }
        }
        *self = next;
        Ok(())
    }
}
