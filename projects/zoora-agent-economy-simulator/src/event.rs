use crate::agent::AgentId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum EventType {
    Transfer {
        from: AgentId,
        to: AgentId,
        amount: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub event_id: u64,
    pub simulation_tick: u64,
    pub priority: u32,
    pub sequence: u64,
    pub event_type: EventType,
}

impl Event {
    pub fn transfer(
        event_id: u64,
        tick: u64,
        sequence: u64,
        from: AgentId,
        to: AgentId,
        amount: i64,
    ) -> Self {
        Self::transfer_with_priority(event_id, tick, 0, sequence, from, to, amount)
    }

    pub fn transfer_with_priority(
        event_id: u64,
        tick: u64,
        priority: u32,
        sequence: u64,
        from: AgentId,
        to: AgentId,
        amount: i64,
    ) -> Self {
        Self {
            event_id,
            simulation_tick: tick,
            priority,
            sequence,
            event_type: EventType::Transfer { from, to, amount },
        }
    }

    pub fn order_key(&self) -> (u64, u32, u64) {
        (self.simulation_tick, self.priority, self.sequence)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RejectionReason {
    InvalidAmount,
    SameAgent,
    UnknownSender,
    UnknownRecipient,
    InsufficientFunds,
    RecipientOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum EventOutcome {
    Completed {},
    Rejected { reason: RejectionReason },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventRecord {
    pub processed_index: u64,
    pub event: Event,
    pub outcome: EventOutcome,
}
