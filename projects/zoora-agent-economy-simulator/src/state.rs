use crate::{agent::{Agent, AgentId}, config::MAX_AGENTS, error::SimulationError, event::EventRecord};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SimulationState {
    pub tick: u64,
    pub agents: Vec<Agent>,
    pub event_log: Vec<EventRecord>,
}
impl SimulationState {
    pub fn try_new(agent_count: usize, starting_balance: i64) -> Result<Self, SimulationError> {
        if !(2..=MAX_AGENTS).contains(&agent_count) || starting_balance < 0 {
            return Err(SimulationError::Configuration("invalid initial state"));
        }
        Ok(Self {
            tick: 0,
            agents: (0..agent_count).map(|id| Agent::new(id as u64, starting_balance)).collect(),
            event_log: Vec::new(),
        })
    }
    pub fn agent(&self, id: AgentId) -> Option<&Agent> {
        self.agents.get(usize::try_from(id).ok()?).filter(|agent| agent.id == id)
    }
    pub fn total_balance(&self) -> Result<u128, SimulationError> {
        self.agents.iter().enumerate().try_fold(0u128, |total, (index, agent)| {
            if agent.id != index as u64 || agent.balance < 0 {
                return Err(SimulationError::Integrity("invalid account state"));
            }
            total.checked_add(agent.balance as u128).ok_or(SimulationError::Arithmetic("total balance overflow"))
        })
    }
}
