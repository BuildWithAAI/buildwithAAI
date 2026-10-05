use crate::{
    config::SimulationConfig,
    event::{Event, EventType},
    journal::EventJournal,
    metrics::Metrics,
    rng::DeterministicRng,
    scheduler::EventScheduler,
    state::SimulationState,
};

#[derive(Debug, Clone)]
pub struct SimulationEngine {
    pub config: SimulationConfig,
    pub state: SimulationState,
    pub metrics: Metrics,
    pub journal: EventJournal,
    scheduler: EventScheduler,
    rng: DeterministicRng,
    next_event_id: u64,
    next_sequence: u64,
}

impl SimulationEngine {
    pub fn new(config: SimulationConfig) -> Self {
        let state = SimulationState::new(config.agent_count, config.starting_balance);
        let rng = DeterministicRng::from_seed(config.seed);
        Self {
            config,
            state,
            metrics: Metrics::default(),
            journal: EventJournal::default(),
            scheduler: EventScheduler::default(),
            rng,
            next_event_id: 0,
            next_sequence: 0,
        }
    }

    pub fn schedule(&mut self, event: Event) {
        self.scheduler.schedule(event);
    }

    pub fn run(&mut self) -> Result<(), String> {
        self.schedule_normal_scenario();

        while let Some(event) = self.scheduler.pop_next() {
            self.state.tick = event.simulation_tick;
            self.process(event)?;
        }

        Ok(())
    }

    fn schedule_normal_scenario(&mut self) {
        if self.state.agents.len() <= 1 {
            return;
        }

        let agent_count = self.state.agents.len() as u64;

        for tick in 0..self.config.ticks {
            let from = self.rng.next_u64() % agent_count;
            let mut to = self.rng.next_u64() % agent_count;
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
            self.scheduler.schedule(event);
        }
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

                let recipient_balance = self.state.agent(*to).ok_or("recipient not found")?.balance;
                let new_sender_balance = sender_balance
                    .checked_sub(*amount)
                    .ok_or("sender balance arithmetic overflow")?;
                let new_recipient_balance = recipient_balance
                    .checked_add(*amount)
                    .ok_or("recipient balance arithmetic overflow")?;

                self.state.agent_mut(*from).ok_or("sender not found")?.balance = new_sender_balance;
                self.state.agent_mut(*to).ok_or("recipient not found")?.balance = new_recipient_balance;
                self.metrics.record_transfer(*amount);
            }
        }

        self.journal.append(event.clone());
        self.state.event_log.push(event);
        Ok(())
    }
}
