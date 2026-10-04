use crate::{
    config::SimulationConfig,
    event::{Event, EventType},
    metrics::Metrics,
    state::SimulationState,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimulationEngine {
    pub config: SimulationConfig,
    pub state: SimulationState,
    pub metrics: Metrics,
    next_event_id: u64,
    next_sequence: u64,
    rng_state: u64,
}

impl SimulationEngine {
    pub fn new(config: SimulationConfig) -> Self {
        let state = SimulationState::new(config.agent_count, config.starting_balance);
        let rng_state = if config.seed == 0 { 0x9E3779B97F4A7C15 } else { config.seed };
        Self {
            config,
            state,
            metrics: Metrics::default(),
            next_event_id: 0,
            next_sequence: 0,
            rng_state,
        }
    }

    fn next_random(&mut self) -> u64 {
        // Small deterministic PRNG for simulation use only.
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 7;
        self.rng_state ^= self.rng_state << 17;
        self.rng_state
    }

    pub fn run(&mut self) -> Result<(), String> {
        for tick in 0..self.config.ticks {
            self.state.tick = tick;
            if self.state.agents.len() > 1 {
                let agent_count = self.state.agents.len() as u64;
                let from = self.next_random() % agent_count;
                let mut to = self.next_random() % agent_count;
                if from == to {
                    to = (to + 1) % agent_count;
                }

                let event = Event::transfer(
                    self.next_event_id,
                    tick,
                    self.next_sequence,
                    from,
                    to,
                    1,
                );
                self.next_event_id += 1;
                self.next_sequence += 1;
                self.process(event)?;
            }
        }
        Ok(())
    }

    pub fn process(&mut self, event: Event) -> Result<(), String> {
        match &event.event_type {
            EventType::Transfer { from, to, amount } => {
                if *amount <= 0 {
                    return Err("transfer amount must be positive".into());
                }
                if from == to {
                    return Err("transfer parties must differ".into());
                }
                let sender_balance = self.state.agent(*from).ok_or("sender not found")?.balance;
                if sender_balance < *amount {
                    return Err("insufficient balance".into());
                }
                self.state.agent_mut(*from).ok_or("sender not found")?.balance -= *amount;
                self.state.agent_mut(*to).ok_or("recipient not found")?.balance += *amount;
                self.metrics.record_transfer(*amount);
            }
        }

        self.state.event_log.push(event);
        Ok(())
    }
}
