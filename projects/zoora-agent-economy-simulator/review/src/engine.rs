use crate::{
    config::{ReviewConfig, MAX_EVENTS, MAX_OPERATIONS},
    types::*,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zoora_agent_economy_simulator::{DeterministicRng, SimulationError};
use zoora_task_market::{
    types::{valid_digest, Task},
    Command as MarketCommand, MarketEngine, MarketReport, Outcome as MarketOutcome, TaskStatus,
};
type Result<T> = std::result::Result<T, SimulationError>;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Scenario {
    ManualReviewV1,
    ReviewMarketV1,
}
pub struct ReviewEngine {
    config: ReviewConfig,
    market: MarketEngine,
    cases: BTreeMap<u64, ReviewCase>,
    queue: BTreeMap<(u64, u32, u64), Event>,
    journal: Vec<Record>,
    operations: Vec<Operation>,
    expiry_ids: BTreeMap<u64, u64>,
    market_cursor: usize,
    next_id: u64,
    reserved_timers: u64,
    clock: u64,
    last_key: Option<(u64, u32, u64)>,
    faulted: bool,
    finished: bool,
    scenario: Scenario,
}
impl ReviewEngine {
    pub fn new(config: ReviewConfig) -> Result<Self> {
        config.validate()?;
        let market = MarketEngine::new(config.market.clone())?;
        Ok(Self {
            config,
            market,
            cases: BTreeMap::new(),
            queue: BTreeMap::new(),
            journal: Vec::new(),
            operations: Vec::new(),
            expiry_ids: BTreeMap::new(),
            market_cursor: 0,
            next_id: 0,
            reserved_timers: 0,
            clock: 0,
            last_key: None,
            faulted: false,
            finished: false,
            scenario: Scenario::ManualReviewV1,
        })
    }
    pub fn config(&self) -> &ReviewConfig {
        &self.config
    }
    pub fn scenario(&self) -> Scenario {
        self.scenario
    }
    pub fn cases(&self) -> Vec<ReviewCase> {
        self.cases.values().cloned().collect()
    }
    pub fn case(&self, id: u64) -> Option<&ReviewCase> {
        self.cases.get(&id)
    }
    pub fn task(&self, id: u64) -> Option<&Task> {
        self.market.task(id)
    }
    pub fn journal(&self) -> &[Record] {
        &self.journal
    }
    pub fn operations(&self) -> &[Operation] {
        &self.operations
    }
    pub fn is_finished(&self) -> bool {
        self.finished && !self.faulted && self.queue.is_empty() && self.reserved_timers == 0
    }
    pub fn market_report(&self) -> Result<MarketReport> {
        if !self.is_finished() {
            return Err(SimulationError::Integrity(
                "review report requires completed healthy engine",
            ));
        }
        MarketReport::from_engine(&self.market)
    }
    fn admit_operation(&self) -> Result<()> {
        if self.operations.len() >= MAX_OPERATIONS - 1 {
            return Err(SimulationError::Capacity("operation history exhausted"));
        }
        Ok(())
    }
    pub fn schedule(&mut self, tick: u64, command: Command) -> Result<u64> {
        if self.finished || self.faulted {
            return Err(SimulationError::Integrity("review engine closed"));
        }
        self.admit_operation()?;
        if command.is_timer() {
            return Err(SimulationError::Integrity("review timers are engine-owned"));
        }
        if tick < self.clock
            || tick >= self.config.market.ticks
            || self
                .last_key
                .is_some_and(|key| (tick, 1, self.next_id) <= key)
        {
            return Err(SimulationError::Configuration(
                "event is past or outside horizon",
            ));
        }
        if !command.within_bounds() {
            return Err(SimulationError::Capacity(
                "review input exceeds byte bounds",
            ));
        }
        let reserve = command.needs_timer();
        let slots = if reserve { 2 } else { 1 };
        if self.next_id + self.reserved_timers + slots > MAX_EVENTS as u64 {
            return Err(SimulationError::Capacity(
                "review lifetime event budget exhausted",
            ));
        }
        let id = self.next_id;
        let event = Event {
            event_id: id,
            simulation_tick: tick,
            priority: 1,
            command: command.clone(),
        };
        self.queue.insert(event.key(), event);
        self.next_id += 1;
        if reserve {
            self.reserved_timers += 1;
        }
        self.operations.push(Operation::Schedule {
            event_id: id,
            tick,
            command,
        });
        Ok(id)
    }
    fn timer(&mut self, tick: u64, command: Command) -> Result<()> {
        if self.next_id + self.reserved_timers >= MAX_EVENTS as u64
            || tick >= self.config.market.ticks
            || !command.is_timer()
        {
            return Err(SimulationError::Integrity("reserved policy timer missing"));
        }
        let event = Event {
            event_id: self.next_id,
            simulation_tick: tick,
            priority: 0,
            command,
        };
        self.next_id += 1;
        self.queue.insert(event.key(), event);
        Ok(())
    }
    fn flush_market(&mut self, tick: u64) -> Result<()> {
        self.market.process_until(tick)?;
        for record in &self.market.journal()[self.market_cursor..] {
            if let MarketCommand::ExpireTask { task_id } = record.event.command {
                self.expiry_ids.insert(task_id, record.event.event_id);
            }
        }
        self.market_cursor = self.market.journal().len();
        Ok(())
    }
    fn forward(&mut self, tick: u64, command: MarketCommand) -> Result<(u64, MarketOutcome)> {
        let id = self.market.schedule(tick, command)?;
        self.flush_market(tick)?;
        let record = self
            .market
            .journal()
            .last()
            .ok_or(SimulationError::Integrity(
                "market command was not processed",
            ))?;
        if record.event.event_id != id {
            return Err(SimulationError::Integrity(
                "market command ordering differs",
            ));
        }
        Ok((id, record.outcome.clone()))
    }
    fn rejection(reason: Rejection) -> Outcome {
        Outcome::Rejected { reason }
    }
    fn same_operator(&self, left: u64, right: u64) -> bool {
        self.config.operator(left) == self.config.operator(right)
    }
    fn reviewer(&self, task: &Task, primary: u64) -> Option<u64> {
        let worker = task.worker?;
        let excluded = [
            self.config.operator(task.client)?,
            self.config.operator(worker)?,
            self.config.operator(primary)?,
        ];
        self.config
            .operators
            .iter()
            .enumerate()
            .find(|(_, operator)| !excluded.contains(operator))
            .map(|(id, _)| id as u64)
    }
    fn decision(
        task: &Task,
        reviewer: u64,
        verdict: Verdict,
        artifact: &str,
        criteria: &str,
        reason: &str,
        tick: u64,
    ) -> std::result::Result<Decision, Rejection> {
        if !valid_digest(artifact) || !valid_digest(criteria) || !valid_digest(reason) {
            return Err(Rejection::InvalidEvidence);
        }
        if task.artifact_digest.as_deref() != Some(artifact) || task.acceptance_digest != criteria {
            return Err(Rejection::EvidenceMismatch);
        }
        Ok(Decision {
            reviewer,
            verdict,
            artifact_digest: artifact.into(),
            criteria_digest: criteria.into(),
            reason_digest: reason.into(),
            simulation_tick: tick,
        })
    }
    fn settle(
        &mut self,
        tick: u64,
        task: &Task,
        case: &mut ReviewCase,
        verdict: Verdict,
    ) -> Result<Outcome> {
        let command = match verdict {
            Verdict::Approve => MarketCommand::ApproveTask {
                task_id: task.id,
                client: task.client,
            },
            Verdict::Refund => MarketCommand::FailTask {
                task_id: task.id,
                worker: task
                    .worker
                    .ok_or(SimulationError::Integrity("reviewed task lacks worker"))?,
            },
        };
        let (id, outcome) = self.forward(tick, command)?;
        case.status = match outcome {
            MarketOutcome::Applied { .. } => {
                if verdict == Verdict::Approve {
                    CaseStatus::Completed
                } else {
                    CaseStatus::Refunded
                }
            }
            MarketOutcome::Rejected { .. } => CaseStatus::SettlementBlocked,
            MarketOutcome::TimerNoop {} => {
                return Err(SimulationError::Integrity(
                    "settlement generated a timer result",
                ))
            }
        };
        Ok(Outcome::Settled {
            verdict,
            market_event_id: id,
            market_outcome: outcome,
        })
    }
    fn process(&mut self, event: &Event) -> Result<Outcome> {
        self.flush_market(event.simulation_tick)?;
        if event.command.needs_timer() {
            self.reserved_timers = self
                .reserved_timers
                .checked_sub(1)
                .ok_or(SimulationError::Integrity("policy timer admission missing"))?;
        }
        let id = event.command.task_id();
        let tick = event.simulation_tick;
        if let Command::Post {
            client,
            reviewer,
            title,
            criteria_digest,
            reward,
            deadline_tick,
            ..
        } = &event.command
        {
            if self.config.operator(*client).is_none() || self.config.operator(*reviewer).is_none()
            {
                return Ok(Self::rejection(Rejection::InvalidActor));
            }
            if self.same_operator(*client, *reviewer) {
                return Ok(Self::rejection(Rejection::OperatorConflict));
            }
            let (market_id, outcome) = self.forward(
                tick,
                MarketCommand::PostTask {
                    task_id: id,
                    client: *client,
                    title: title.clone(),
                    acceptance_digest: criteria_digest.clone(),
                    reward: *reward,
                    deadline_tick: *deadline_tick,
                },
            )?;
            if matches!(outcome, MarketOutcome::Applied { .. }) {
                self.timer(*deadline_tick, Command::Deadline { task_id: id })?;
                self.cases.insert(
                    id,
                    ReviewCase {
                        task_id: id,
                        primary_reviewer: *reviewer,
                        status: CaseStatus::Open,
                        dispute: None,
                        primary_decision: None,
                        appeal: None,
                        appeal_decision: None,
                        appeal_closes_at: None,
                    },
                );
            }
            return Ok(Outcome::Forwarded {
                market_event_id: market_id,
                market_outcome: outcome,
            });
        }
        let Some(mut case) = self.cases.get(&id).cloned() else {
            if event.command.is_timer() {
                return Err(SimulationError::Integrity("policy timer lacks case"));
            }
            return Ok(Self::rejection(Rejection::UnknownTask));
        };
        let task = self
            .market
            .task(id)
            .ok_or(SimulationError::Integrity("review case lacks market task"))?
            .clone();
        // The inner engine expires before every policy event. No verdict can outrun that deadline.
        if event.command.is_timer() {
            let result = match event.command {
                Command::Deadline { .. } => {
                    if tick != task.deadline_tick {
                        return Err(SimulationError::Integrity("policy deadline differs"));
                    }
                    if task.status == TaskStatus::Expired {
                        case.status = CaseStatus::Expired;
                        Outcome::Deadline {
                            market_event_id: *self
                                .expiry_ids
                                .get(&id)
                                .ok_or(SimulationError::Integrity("market expiry missing"))?,
                            market_status: task.status,
                        }
                    } else {
                        Outcome::TimerNoop {}
                    }
                }
                Command::CloseReview { .. } => {
                    if case.appeal_closes_at != Some(tick) {
                        return Err(SimulationError::Integrity("appeal timer differs"));
                    }
                    if case.status == CaseStatus::Provisional {
                        let verdict = case
                            .primary_decision
                            .as_ref()
                            .ok_or(SimulationError::Integrity("provisional decision missing"))?
                            .verdict;
                        self.settle(tick, &task, &mut case, verdict)?
                    } else {
                        Outcome::TimerNoop {}
                    }
                }
                _ => unreachable!(),
            };
            self.cases.insert(id, case);
            return Ok(result);
        }
        if !task.status.holds_escrow() {
            return Ok(Self::rejection(Rejection::WrongState));
        }
        let result = match &event.command {
            Command::Accept { worker, .. } => {
                if self.config.operator(*worker).is_none() {
                    return Ok(Self::rejection(Rejection::InvalidActor));
                }
                if self.same_operator(*worker, task.client)
                    || self.same_operator(*worker, case.primary_reviewer)
                {
                    return Ok(Self::rejection(Rejection::OperatorConflict));
                }
                let (id, outcome) = self.forward(
                    tick,
                    MarketCommand::AcceptTask {
                        task_id: id,
                        worker: *worker,
                    },
                )?;
                if matches!(outcome, MarketOutcome::Applied { .. }) {
                    case.status = CaseStatus::Accepted;
                }
                Outcome::Forwarded {
                    market_event_id: id,
                    market_outcome: outcome,
                }
            }
            Command::Submit {
                worker,
                artifact_digest,
                ..
            } => {
                let (id, outcome) = self.forward(
                    tick,
                    MarketCommand::SubmitTask {
                        task_id: id,
                        worker: *worker,
                        artifact_digest: artifact_digest.clone(),
                    },
                )?;
                if matches!(outcome, MarketOutcome::Applied { .. }) {
                    case.status = CaseStatus::Submitted;
                }
                Outcome::Forwarded {
                    market_event_id: id,
                    market_outcome: outcome,
                }
            }
            Command::Fail { worker, .. } => {
                if task.status != TaskStatus::Accepted {
                    return Ok(Self::rejection(Rejection::WrongState));
                }
                let (id, outcome) = self.forward(
                    tick,
                    MarketCommand::FailTask {
                        task_id: id,
                        worker: *worker,
                    },
                )?;
                if matches!(outcome, MarketOutcome::Applied { .. }) {
                    case.status = CaseStatus::Failed;
                }
                Outcome::Forwarded {
                    market_event_id: id,
                    market_outcome: outcome,
                }
            }
            Command::Cancel { client, .. } => {
                let (id, outcome) = self.forward(
                    tick,
                    MarketCommand::CancelTask {
                        task_id: id,
                        client: *client,
                    },
                )?;
                if matches!(outcome, MarketOutcome::Applied { .. }) {
                    case.status = CaseStatus::Cancelled;
                }
                Outcome::Forwarded {
                    market_event_id: id,
                    market_outcome: outcome,
                }
            }
            Command::Dispute {
                client,
                reason_digest,
                ..
            } => {
                if *client != task.client {
                    return Ok(Self::rejection(Rejection::UnauthorizedActor));
                }
                if case.status != CaseStatus::Submitted || case.dispute.is_some() {
                    return Ok(Self::rejection(Rejection::WrongState));
                }
                if !valid_digest(reason_digest) {
                    return Ok(Self::rejection(Rejection::InvalidEvidence));
                }
                case.dispute = Some(Dispute {
                    actor: *client,
                    reason_digest: reason_digest.clone(),
                    simulation_tick: tick,
                });
                case.status = CaseStatus::Disputed;
                Outcome::Disputed {}
            }
            Command::Review {
                reviewer,
                verdict,
                artifact_digest,
                criteria_digest,
                reason_digest,
                ..
            } => {
                if *reviewer != case.primary_reviewer {
                    return Ok(Self::rejection(Rejection::UnauthorizedActor));
                }
                if !matches!(case.status, CaseStatus::Submitted | CaseStatus::Disputed)
                    || case.primary_decision.is_some()
                {
                    return Ok(Self::rejection(Rejection::WrongState));
                }
                let decision = match Self::decision(
                    &task,
                    *reviewer,
                    *verdict,
                    artifact_digest,
                    criteria_digest,
                    reason_digest,
                    tick,
                ) {
                    Ok(value) => value,
                    Err(reason) => return Ok(Self::rejection(reason)),
                };
                let Some(closes_at) = tick
                    .checked_add(self.config.appeal_ticks)
                    .filter(|value| *value < task.deadline_tick)
                else {
                    return Ok(Self::rejection(Rejection::WindowOutsideDeadline));
                };
                self.timer(closes_at, Command::CloseReview { task_id: id })?;
                case.primary_decision = Some(decision);
                case.appeal_closes_at = Some(closes_at);
                case.status = CaseStatus::Provisional;
                Outcome::Provisional {
                    reviewer: *reviewer,
                    closes_at,
                }
            }
            Command::Appeal {
                actor,
                reason_digest,
                ..
            } => {
                if *actor != task.client && Some(*actor) != task.worker {
                    return Ok(Self::rejection(Rejection::UnauthorizedActor));
                }
                if case.status != CaseStatus::Provisional || case.appeal.is_some() {
                    return Ok(Self::rejection(Rejection::WrongState));
                }
                if !valid_digest(reason_digest) {
                    return Ok(Self::rejection(Rejection::InvalidEvidence));
                }
                let Some(reviewer) = self.reviewer(&task, case.primary_reviewer) else {
                    return Ok(Self::rejection(Rejection::NoIndependentReviewer));
                };
                case.appeal = Some(Appeal {
                    actor: *actor,
                    reviewer,
                    reason_digest: reason_digest.clone(),
                    simulation_tick: tick,
                });
                case.status = CaseStatus::Appealed;
                Outcome::Appealed { reviewer }
            }
            Command::AppealDecision {
                reviewer,
                verdict,
                artifact_digest,
                criteria_digest,
                reason_digest,
                ..
            } => {
                if case.status != CaseStatus::Appealed || case.appeal_decision.is_some() {
                    return Ok(Self::rejection(Rejection::WrongState));
                }
                if case.appeal.as_ref().map(|appeal| appeal.reviewer) != Some(*reviewer) {
                    return Ok(Self::rejection(Rejection::UnauthorizedActor));
                }
                let decision = match Self::decision(
                    &task,
                    *reviewer,
                    *verdict,
                    artifact_digest,
                    criteria_digest,
                    reason_digest,
                    tick,
                ) {
                    Ok(value) => value,
                    Err(reason) => return Ok(Self::rejection(reason)),
                };
                case.appeal_decision = Some(decision);
                self.settle(tick, &task, &mut case, *verdict)?
            }
            Command::Post { .. } | Command::CloseReview { .. } | Command::Deadline { .. } => {
                unreachable!()
            }
        };
        self.cases.insert(id, case);
        Ok(result)
    }
    fn advance_internal(&mut self, tick: u64) -> Result<()> {
        if self.finished || self.faulted || tick < self.clock || tick >= self.config.market.ticks {
            return Err(SimulationError::Integrity("invalid review advance"));
        }
        while self
            .queue
            .first_key_value()
            .is_some_and(|(key, _)| key.0 <= tick)
        {
            let (_, event) = self
                .queue
                .pop_first()
                .ok_or(SimulationError::Integrity("policy queue missing"))?;
            let outcome = match self.process(&event) {
                Ok(value) => value,
                Err(error) => {
                    self.faulted = true;
                    return Err(error);
                }
            };
            self.clock = event.simulation_tick;
            self.last_key = Some(event.key());
            self.journal.push(Record {
                processed_index: self.journal.len() as u64,
                event,
                outcome,
            });
        }
        if let Err(error) = self.flush_market(tick).and_then(|()| self.audit()) {
            self.faulted = true;
            return Err(error);
        }
        self.clock = tick;
        Ok(())
    }
    pub fn advance_to(&mut self, tick: u64) -> Result<()> {
        self.admit_operation()?;
        self.advance_internal(tick)?;
        self.operations.push(Operation::Advance { tick });
        Ok(())
    }
    pub fn run(&mut self) -> Result<()> {
        if self.operations.len() >= MAX_OPERATIONS {
            return Err(SimulationError::Capacity("operation history exhausted"));
        }
        self.advance_internal(self.config.market.ticks - 1)?;
        if !self.queue.is_empty() || self.reserved_timers != 0 {
            self.faulted = true;
            return Err(SimulationError::Integrity("unsettled policy queue"));
        }
        if let Err(error) = self.market.run() {
            self.faulted = true;
            return Err(error);
        }
        self.operations.push(Operation::Run {});
        self.finished = true;
        Ok(())
    }
    pub fn audit(&self) -> Result<()> {
        self.market.audit()?;
        for case in self.cases.values() {
            let task = self
                .market
                .task(case.task_id)
                .ok_or(SimulationError::Integrity("case task missing"))?;
            let expected = match case.status {
                CaseStatus::Open => TaskStatus::Open,
                CaseStatus::Accepted => TaskStatus::Accepted,
                CaseStatus::Submitted
                | CaseStatus::Disputed
                | CaseStatus::Provisional
                | CaseStatus::Appealed
                | CaseStatus::SettlementBlocked => TaskStatus::Submitted,
                CaseStatus::Completed => TaskStatus::Completed,
                CaseStatus::Refunded | CaseStatus::Failed => TaskStatus::Failed,
                CaseStatus::Cancelled => TaskStatus::Cancelled,
                CaseStatus::Expired => TaskStatus::Expired,
            };
            if task.status != expected
                || self.same_operator(task.client, case.primary_reviewer)
                || task.worker.is_some_and(|worker| {
                    self.same_operator(worker, task.client)
                        || self.same_operator(worker, case.primary_reviewer)
                })
            {
                return Err(SimulationError::Integrity(
                    "review status or operator invariant failed",
                ));
            }
            if let Some(appeal) = &case.appeal {
                if self.reviewer(task, case.primary_reviewer) != Some(appeal.reviewer) {
                    return Err(SimulationError::Integrity(
                        "appeal independence invariant failed",
                    ));
                }
            }
        }
        Ok(())
    }
    pub fn from_operations(
        config: ReviewConfig,
        scenario: Scenario,
        operations: &[Operation],
    ) -> Result<Self> {
        if operations.len() > MAX_OPERATIONS {
            return Err(SimulationError::Capacity("operation history too large"));
        }
        let mut engine = Self::new(config)?;
        engine.scenario = scenario;
        for operation in operations {
            match operation {
                Operation::Schedule {
                    event_id,
                    tick,
                    command,
                } => {
                    if engine.schedule(*tick, command.clone())? != *event_id {
                        return Err(SimulationError::Replay("admission identity differs"));
                    }
                }
                Operation::Advance { tick } => engine.advance_to(*tick)?,
                Operation::Run {} => engine.run()?,
            }
        }
        if !engine.is_finished() {
            return Err(SimulationError::Replay("operation history not completed"));
        }
        Ok(engine)
    }
    pub fn run_scenario(&mut self) -> Result<()> {
        if self.next_id != 0 || !self.operations.is_empty() || self.finished || self.faulted {
            return Err(SimulationError::Integrity(
                "review scenario requires fresh engine",
            ));
        }
        self.config.validate()?;
        self.scenario = Scenario::ReviewMarketV1;
        let mut rng = DeterministicRng::from_seed(self.config.market.seed);
        for id in 0..self.config.market.scenario_tasks as u64 {
            let client = rng
                .below(self.config.market.agent_count as u64)
                .ok_or(SimulationError::Integrity("RNG bound missing"))?;
            let start = rng
                .below(self.config.market.agent_count as u64)
                .ok_or(SimulationError::Integrity("RNG bound missing"))?;
            let worker = (0..self.config.market.agent_count as u64)
                .map(|offset| (start + offset) % self.config.market.agent_count as u64)
                .find(|worker| !self.same_operator(*worker, client))
                .ok_or(SimulationError::Configuration("worker operator missing"))?;
            let primary = (0..self.config.market.agent_count as u64)
                .find(|r| !self.same_operator(*r, client) && !self.same_operator(*r, worker))
                .ok_or(SimulationError::Configuration("primary reviewer missing"))?;
            self.schedule(
                0,
                Command::Post {
                    task_id: id,
                    client,
                    reviewer: primary,
                    title: format!("synthetic-review-task-{id}"),
                    criteria_digest: "c".repeat(64),
                    reward: self.config.market.reward_per_task,
                    deadline_tick: 9,
                },
            )?;
            if rng.below(10000).unwrap_or(10000) < u64::from(self.config.market.cancellation_bps) {
                self.schedule(
                    1,
                    Command::Cancel {
                        task_id: id,
                        client,
                    },
                )?;
                continue;
            }
            self.schedule(
                1,
                Command::Accept {
                    task_id: id,
                    worker,
                },
            )?;
            if rng.below(10000).unwrap_or(10000) < u64::from(self.config.market.failure_bps) {
                self.schedule(
                    2,
                    Command::Fail {
                        task_id: id,
                        worker,
                    },
                )?;
                continue;
            }
            self.schedule(
                2,
                Command::Submit {
                    task_id: id,
                    worker,
                    artifact_digest: "a".repeat(64),
                },
            )?;
            if rng.below(10000).unwrap_or(10000) < u64::from(self.config.dispute_bps) {
                self.schedule(
                    3,
                    Command::Dispute {
                        task_id: id,
                        client,
                        reason_digest: "d".repeat(64),
                    },
                )?;
            }
            if rng.below(10000).unwrap_or(10000) < u64::from(self.config.missing_review_bps) {
                continue;
            }
            let verdict = if rng.below(10000).unwrap_or(10000) < u64::from(self.config.refund_bps) {
                Verdict::Refund
            } else {
                Verdict::Approve
            };
            self.schedule(
                3,
                Command::Review {
                    task_id: id,
                    reviewer: primary,
                    verdict,
                    artifact_digest: "a".repeat(64),
                    criteria_digest: "c".repeat(64),
                    reason_digest: "e".repeat(64),
                },
            )?;
            if rng.below(10000).unwrap_or(10000) < u64::from(self.config.appeal_bps) {
                self.schedule(
                    4,
                    Command::Appeal {
                        task_id: id,
                        actor: worker,
                        reason_digest: "f".repeat(64),
                    },
                )?;
                let excluded = [
                    self.config.operator(client),
                    self.config.operator(worker),
                    self.config.operator(primary),
                ];
                let reviewer = (0..self.config.market.agent_count as u64)
                    .find(|r| !excluded.contains(&self.config.operator(*r)))
                    .ok_or(SimulationError::Configuration("appeal reviewer missing"))?;
                if rng.below(10000).unwrap_or(10000) >= u64::from(self.config.missing_appeal_bps) {
                    let verdict = if rng.below(10000).unwrap_or(10000)
                        < u64::from(self.config.overturn_bps)
                    {
                        verdict.flipped()
                    } else {
                        verdict
                    };
                    self.schedule(
                        6,
                        Command::AppealDecision {
                            task_id: id,
                            reviewer,
                            verdict,
                            artifact_digest: "a".repeat(64),
                            criteria_digest: "c".repeat(64),
                            reason_digest: "b".repeat(64),
                        },
                    )?;
                }
            }
        }
        self.run()
    }
}
