use crate::agent::AgentId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventType {
    Transfer { from: AgentId, to: AgentId, amount: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
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
        simulation_tick: u64,
        sequence: u64,
        from: AgentId,
        to: AgentId,
        amount: i64,
    ) -> Self {
        Self::transfer_with_priority(event_id, simulation_tick, 0, sequence, from, to, amount)
    }

    pub fn transfer_with_priority(
        event_id: u64,
        simulation_tick: u64,
        priority: u32,
        sequence: u64,
        from: AgentId,
        to: AgentId,
        amount: i64,
    ) -> Self {
        Self {
            event_id,
            simulation_tick,
            priority,
            sequence,
            event_type: EventType::Transfer { from, to, amount },
        }
    }
}
