use serde::{Deserialize, Serialize};
pub type AgentId = u64;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Agent {
    pub id: AgentId,
    pub balance: i64,
}

impl Agent {
    pub fn new(id: AgentId, balance: i64) -> Self { Self { id, balance } }
}
