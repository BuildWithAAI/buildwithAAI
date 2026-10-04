use crate::agent::{Agent, AgentId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimulationState {
    pub tick: u64,
    pub agents: Vec<Agent>,
    pub event_log: Vec<crate::event::Event>,
}

impl SimulationState {
    pub fn new(agent_count: usize, starting_balance: i64) -> Self {
        let agents = (0..agent_count as AgentId)
            .map(|id| Agent::new(id, starting_balance))
            .collect();

        Self { tick: 0, agents, event_log: Vec::new() }
    }

    pub fn agent(&self, id: AgentId) -> Option<&Agent> {
        self.agents.get(id as usize).filter(|a| a.id == id)
    }

    pub fn agent_mut(&mut self, id: AgentId) -> Option<&mut Agent> {
        self.agents.get_mut(id as usize).filter(|a| a.id == id)
    }
}
