use serde::{Deserialize, Serialize};
use crate::{
    config::SimulationConfig, error::SimulationError,
    event::{Event, EventOutcome, EventRecord, EventType, RejectionReason},
    journal::EventJournal, metrics::Metrics, rng::DeterministicRng,
    scheduler::EventScheduler, state::SimulationState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScenarioKind { NormalTransfersV1, ManualEventsV1 }

#[derive(Debug, Clone)]
pub struct SimulationEngine {
    config: SimulationConfig,
    state: SimulationState,
    metrics: Metrics,
    journal: EventJournal,
    scheduler: EventScheduler,
    rng: DeterministicRng,
    scenario: ScenarioKind,
}

impl SimulationEngine {
    /// Convenience constructor for trusted configuration; use try_new for external input.
    pub fn new(config: SimulationConfig) -> Self {
        Self::try_new(config).expect("invalid simulation configuration")
    }
    pub fn try_new(config: SimulationConfig) -> Result<Self, SimulationError> {
        config.validate()?;
        let state = SimulationState::try_new(config.agent_count, config.starting_balance)?;
        let rng = DeterministicRng::from_seed(config.seed);
        Ok(Self {
            config, state, rng, metrics: Metrics::default(), journal: EventJournal::default(),
            scheduler: EventScheduler::default(), scenario: ScenarioKind::ManualEventsV1,
        })
    }
    pub fn config(&self) -> &SimulationConfig { &self.config }
    pub fn state(&self) -> &SimulationState { &self.state }
    pub fn metrics(&self) -> &Metrics { &self.metrics }
    pub fn journal(&self) -> &EventJournal { &self.journal }
    pub fn scenario(&self) -> ScenarioKind { self.scenario }
    pub fn pending_events(&self) -> usize { self.scheduler.len() }

    fn validate_next(&self, event: &Event) -> Result<(), SimulationError> {
        if event.simulation_tick >= self.config.ticks {
            return Err(SimulationError::Integrity("event is outside the configured tick horizon"));
        }
        if self.journal.entries().last().is_some_and(|last| last.event.order_key() >= event.order_key()) {
            return Err(SimulationError::Integrity("event precedes processed history"));
        }
        Ok(())
    }

    pub fn schedule(&mut self, event: Event) -> Result<(), SimulationError> {
        if self.scenario == ScenarioKind::NormalTransfersV1 {
            return Err(SimulationError::Integrity("normal runs cannot accept manual events"));
        }
        self.validate_next(&event)?;
        self.scheduler.schedule(event)
    }

    /// One unit-transfer request per tick. Economic refusals are recorded, not fatal.
    pub fn run(&mut self) -> Result<(), SimulationError> {
        if !self.journal.is_empty() || !self.scheduler.is_empty() || self.scenario == ScenarioKind::NormalTransfersV1 {
            return Err(SimulationError::Integrity("normal scenario requires a fresh engine"));
        }
        let count = self.config.agent_count as u64;
        for tick in 0..self.config.ticks {
            let from = self.rng.below(count).expect("validated nonzero agent count");
            let draw = self.rng.below(count - 1).expect("validated two or more agents");
            let to = if draw >= from { draw + 1 } else { draw };
            self.scheduler.schedule(Event::transfer(tick, tick, tick, from, to, 1))?;
        }
        self.scenario = ScenarioKind::NormalTransfersV1;
        self.run_pending()
    }

    pub fn run_pending(&mut self) -> Result<(), SimulationError> {
        while let Some(event) = self.scheduler.pop_next() { self.process(event)?; }
        self.audit()
    }

    fn outcome(&self, event: &Event) -> (EventOutcome, Option<(usize, i64, usize, i64)>) {
        use RejectionReason::*;
        let reject = |reason| (EventOutcome::Rejected { reason }, None);
        let EventType::Transfer { from, to, amount } = event.event_type;
        if amount <= 0 { return reject(InvalidAmount); }
        if from == to { return reject(SameAgent); }
        let Some(sender) = self.state.agent(from) else { return reject(UnknownSender); };
        let Some(recipient) = self.state.agent(to) else { return reject(UnknownRecipient); };
        if sender.balance < amount { return reject(InsufficientFunds); }
        let Some(new_recipient) = recipient.balance.checked_add(amount) else { return reject(RecipientOverflow); };
        // Positive amount <= nonnegative sender balance makes subtraction safe.
        (EventOutcome::Completed, Some((from as usize, sender.balance - amount, to as usize, new_recipient)))
    }

    fn process(&mut self, event: Event) -> Result<(), SimulationError> {
        self.validate_next(&event)?;
        let (outcome, balances) = self.outcome(&event);
        let record = EventRecord { processed_index: self.journal.len() as u64, event, outcome };
        let mut next_metrics = self.metrics.clone();
        next_metrics.observe(&record)?;
        // All fallible validation and arithmetic precede account mutation.
        if let Some((from, sender, to, recipient)) = balances {
            self.state.agents[from].balance = sender;
            self.state.agents[to].balance = recipient;
        }
        self.metrics = next_metrics;
        self.state.tick = record.event.simulation_tick;
        self.journal.append(record.clone());
        self.state.event_log.push(record);
        Ok(())
    }

    pub fn audit(&self) -> Result<(), SimulationError> {
        self.config.validate()?;
        self.journal.validate()?;
        if self.state.agents.len() != self.config.agent_count || self.state.total_balance()? != self.config.initial_supply()? {
            return Err(SimulationError::Integrity("account conservation failed"));
        }
        if self.state.event_log != self.journal.entries() {
            return Err(SimulationError::Integrity("event log does not match journal"));
        }
        let mut observed = Metrics::default();
        for record in self.journal.entries() { observed.observe(record)?; }
        if observed != self.metrics {
            return Err(SimulationError::Integrity("metrics do not match journal"));
        }
        Ok(())
    }

    pub(crate) fn replay_engine(config: SimulationConfig, journal: &EventJournal) -> Result<Self, SimulationError> {
        journal.validate()?;
        let mut engine = Self::try_new(config)?;
        for expected in journal.entries() {
            engine.schedule(expected.event.clone())?;
            let event = engine.scheduler.pop_next().expect("one admitted replay event");
            if engine.outcome(&event).0 != expected.outcome {
                return Err(SimulationError::Replay("recorded outcome does not match account state"));
            }
            engine.process(event)?;
        }
        engine.audit()?;
        Ok(engine)
    }

    pub fn replay(config: SimulationConfig, journal: &EventJournal) -> Result<SimulationState, SimulationError> {
        Ok(Self::replay_engine(config, journal)?.state)
    }
}
