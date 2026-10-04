use serde::{Deserialize, Serialize};

pub type AgentId = u64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Agent {
    pub id: AgentId,
    pub balance: i64,
}

impl Agent {
    pub fn new(id: AgentId, starting_balance: i64) -> Self {
        Self { id, balance: starting_balance }
    }
}
