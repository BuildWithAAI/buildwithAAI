use crate::{
    config::{MarketConfig, MAX_EVENTS},
    metrics::{decimal, MarketMetrics},
    types::*,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use zoora_agent_economy_simulator::{error::SimulationError, rng::DeterministicRng};
type Result<T> = std::result::Result<T, SimulationError>;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Scenario {
    ManualTaskCommandsV1,
    NormalTaskMarketV1,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketState {
    #[serde(deserialize_with = "bounded_accounts")]
    pub accounts: Vec<Account>,
    #[serde(deserialize_with = "bounded_tasks")]
    pub tasks: Vec<Task>,
    #[serde(with = "decimal")]
    pub treasury: u128,
    pub simulation_tick: u64,
}
pub struct MarketEngine {
    config: MarketConfig,
    accounts: Vec<Account>,
    tasks: BTreeMap<u64, Task>,
    treasury: u128,
    queue: BTreeMap<(u64, u32, u64), MarketEvent>,
    journal: Vec<Record>,
    metrics: MarketMetrics,
    next_id: u64,
    reserved_expiries: u64,
    clock: u64,
    last_key: Option<(u64, u32, u64)>,
    finished: bool,
    faulted: bool,
    scenario: Scenario,
}
struct Effect {
    accounts: Vec<Account>,
    task: Option<Task>,
    treasury: u128,
    outcome: Outcome,
}
impl MarketEngine {
    pub fn new(config: MarketConfig) -> Result<Self> {
        config.validate()?;
        let accounts = (0..config.agent_count)
            .map(|id| Account {
                id: id as u64,
                balance: config.starting_balance,
                refundable_escrow: 0,
                active_tasks: 0,
                completed_services: 0,
                failed_services: 0,
            })
            .collect();
        Ok(Self {
            config,
            accounts,
            tasks: BTreeMap::new(),
            treasury: 0,
            queue: BTreeMap::new(),
            journal: Vec::new(),
            metrics: MarketMetrics::default(),
            next_id: 0,
            reserved_expiries: 0,
            clock: 0,
            last_key: None,
            finished: false,
            faulted: false,
            scenario: Scenario::ManualTaskCommandsV1,
        })
    }
    pub fn config(&self) -> &MarketConfig {
        &self.config
    }
    pub fn journal(&self) -> &[Record] {
        &self.journal
    }
    pub fn metrics(&self) -> &MarketMetrics {
        &self.metrics
    }
    pub fn scenario(&self) -> Scenario {
        self.scenario
    }
    pub fn state(&self) -> MarketState {
        MarketState {
            accounts: self.accounts.clone(),
            tasks: self.tasks.values().cloned().collect(),
            treasury: self.treasury,
            simulation_tick: self.clock,
        }
    }
    pub fn is_finished(&self) -> bool {
        self.finished && !self.faulted && self.queue.is_empty() && self.reserved_expiries == 0
    }
    pub fn schedule(&mut self, tick: u64, command: Command) -> Result<u64> {
        if self.finished || self.faulted {
            return Err(SimulationError::Integrity("engine is closed"));
        }
        if command.is_timer() {
            return Err(SimulationError::Integrity("expiry timers are engine-owned"));
        }
        if tick >= self.config.ticks
            || tick < self.clock
            || self
                .last_key
                .is_some_and(|key| (tick, 1, self.next_id) <= key)
        {
            return Err(SimulationError::Configuration(
                "event tick is past or outside horizon",
            ));
        }
        // Bound untrusted strings before they can enter the queue or journal.
        match &command {
            Command::PostTask {
                title,
                acceptance_digest,
                ..
            } if title.len() > 128 || acceptance_digest.len() > 64 => {
                return Err(SimulationError::Capacity("task terms exceed input bounds"))
            }
            Command::SubmitTask {
                artifact_digest, ..
            } if artifact_digest.len() > 64 => {
                return Err(SimulationError::Capacity(
                    "artifact digest exceeds input bounds",
                ))
            }
            _ => {}
        }
        let post = matches!(command, Command::PostTask { .. });
        let slots = if post { 2 } else { 1 };
        if self.next_id + self.reserved_expiries + slots > MAX_EVENTS as u64 {
            return Err(SimulationError::Capacity("lifetime event budget exhausted"));
        }
        let id = self.next_id;
        let event = MarketEvent {
            event_id: id,
            simulation_tick: tick,
            priority: 1,
            sequence: id,
            command,
        };
        self.queue.insert(event.order_key(), event);
        self.next_id += 1;
        if post {
            self.reserved_expiries += 1;
        }
        Ok(id)
    }
    fn rejected(&self, reason: Rejection) -> Effect {
        Effect {
            accounts: vec![],
            task: None,
            treasury: self.treasury,
            outcome: Outcome::Rejected { reason },
        }
    }
    fn effect(&self, event: &MarketEvent) -> Result<Effect> {
        let id = event.command.task_id();
        if let Command::PostTask {
            client,
            title,
            acceptance_digest,
            reward,
            deadline_tick,
            ..
        } = &event.command
        {
            let Some(account) = self
                .accounts
                .get(*client as usize)
                .filter(|a| a.id == *client)
            else {
                return Ok(self.rejected(Rejection::InvalidActor));
            };
            if title.trim().is_empty() || title.len() > 128 || !valid_digest(acceptance_digest) {
                return Ok(self.rejected(Rejection::InvalidTerms));
            }
            if *reward <= 0 {
                return Ok(self.rejected(Rejection::InvalidReward));
            }
            if *deadline_tick <= event.simulation_tick || *deadline_tick >= self.config.ticks {
                return Ok(self.rejected(Rejection::InvalidDeadline));
            }
            if self.tasks.contains_key(&id) {
                return Ok(self.rejected(Rejection::DuplicateTask));
            }
            if self.tasks.len() >= self.config.max_tasks {
                return Ok(self.rejected(Rejection::TaskCapacity));
            }
            if account.balance < *reward {
                return Ok(self.rejected(Rejection::InsufficientFunds));
            }
            let mut account = account.clone();
            account.balance -= reward;
            account.refundable_escrow = account
                .refundable_escrow
                .checked_add(*reward)
                .ok_or(SimulationError::Arithmetic("refund reserve overflow"))?;
            return Ok(Effect {
                accounts: vec![account],
                task: Some(Task {
                    id,
                    client: *client,
                    worker: None,
                    title: title.clone(),
                    acceptance_digest: acceptance_digest.clone(),
                    artifact_digest: None,
                    reward: *reward,
                    posted_tick: event.simulation_tick,
                    deadline_tick: *deadline_tick,
                    status: TaskStatus::Open,
                }),
                treasury: self.treasury,
                outcome: Outcome::Applied {
                    transition: Transition::Posted,
                    escrow_funded: *reward,
                    worker_payment: 0,
                    fee: 0,
                    client_refund: 0,
                },
            });
        }
        let Some(original) = self.tasks.get(&id) else {
            if event.command.is_timer() {
                return Err(SimulationError::Integrity("timer references missing task"));
            }
            return Ok(self.rejected(Rejection::UnknownTask));
        };
        let mut task = original.clone();
        let mut client = self.accounts[task.client as usize].clone();
        let mut accounts = Vec::new();
        let mut treasury = self.treasury;
        let outcome = match &event.command {
            Command::AcceptTask { worker, .. } => {
                let Some(account) = self
                    .accounts
                    .get(*worker as usize)
                    .filter(|a| a.id == *worker)
                else {
                    return Ok(self.rejected(Rejection::InvalidActor));
                };
                if task.status != TaskStatus::Open {
                    return Ok(self.rejected(Rejection::WrongState));
                }
                if *worker == task.client {
                    return Ok(self.rejected(Rejection::SelfAssignment));
                }
                if account.active_tasks >= self.config.max_active_tasks_per_worker {
                    return Ok(self.rejected(Rejection::WorkerCapacity));
                }
                let mut account = account.clone();
                account.active_tasks += 1;
                accounts.push(account);
                task.worker = Some(*worker);
                task.status = TaskStatus::Accepted;
                Outcome::applied(Transition::Accepted)
            }
            Command::SubmitTask {
                worker,
                artifact_digest,
                ..
            } => {
                if task.worker != Some(*worker) {
                    return Ok(self.rejected(Rejection::UnauthorizedActor));
                }
                if task.status != TaskStatus::Accepted {
                    return Ok(self.rejected(Rejection::WrongState));
                }
                if !valid_digest(artifact_digest) {
                    return Ok(self.rejected(Rejection::InvalidArtifact));
                }
                task.artifact_digest = Some(artifact_digest.clone());
                task.status = TaskStatus::Submitted;
                Outcome::applied(Transition::Submitted)
            }
            Command::ApproveTask { client: actor, .. } => {
                if *actor != task.client {
                    return Ok(self.rejected(Rejection::UnauthorizedActor));
                }
                if task.status != TaskStatus::Submitted {
                    return Ok(self.rejected(Rejection::WrongState));
                }
                let worker_id = task
                    .worker
                    .ok_or(SimulationError::Integrity("submitted task lacks worker"))?;
                let mut worker = self.accounts[worker_id as usize].clone();
                let fee = ((task.reward as u128) * u128::from(self.config.fee_bps) / 10000) as i64;
                let payment = task.reward - fee;
                if worker
                    .balance
                    .checked_add(worker.refundable_escrow)
                    .and_then(|v| v.checked_add(payment))
                    .is_none()
                {
                    return Ok(self.rejected(Rejection::RecipientCapacity));
                }
                worker.balance += payment;
                worker.active_tasks -= 1;
                worker.completed_services = worker
                    .completed_services
                    .checked_add(1)
                    .ok_or(SimulationError::Arithmetic("service counter overflow"))?;
                client.refundable_escrow -= task.reward;
                treasury = treasury
                    .checked_add(fee as u128)
                    .ok_or(SimulationError::Arithmetic("treasury overflow"))?;
                accounts.extend([client, worker]);
                task.status = TaskStatus::Completed;
                Outcome::Applied {
                    transition: Transition::Completed,
                    escrow_funded: 0,
                    worker_payment: payment,
                    fee,
                    client_refund: 0,
                }
            }
            Command::FailTask { worker, .. } => {
                if task.worker != Some(*worker) {
                    return Ok(self.rejected(Rejection::UnauthorizedActor));
                }
                if !matches!(task.status, TaskStatus::Accepted | TaskStatus::Submitted) {
                    return Ok(self.rejected(Rejection::WrongState));
                }
                self.refund(&mut task, &mut client, &mut accounts, TaskStatus::Failed)?;
                Outcome::Applied {
                    transition: Transition::Failed,
                    escrow_funded: 0,
                    worker_payment: 0,
                    fee: 0,
                    client_refund: task.reward,
                }
            }
            Command::CancelTask { client: actor, .. } => {
                if *actor != task.client {
                    return Ok(self.rejected(Rejection::UnauthorizedActor));
                }
                if task.status != TaskStatus::Open {
                    return Ok(self.rejected(Rejection::WrongState));
                }
                self.refund(&mut task, &mut client, &mut accounts, TaskStatus::Cancelled)?;
                Outcome::Applied {
                    transition: Transition::Cancelled,
                    escrow_funded: 0,
                    worker_payment: 0,
                    fee: 0,
                    client_refund: task.reward,
                }
            }
            Command::ExpireTask { .. } => {
                if event.simulation_tick != task.deadline_tick {
                    return Err(SimulationError::Integrity("expiry at wrong deadline"));
                }
                if !task.status.holds_escrow() {
                    return Ok(Effect {
                        accounts: vec![],
                        task: None,
                        treasury,
                        outcome: Outcome::TimerNoop {},
                    });
                }
                self.refund(&mut task, &mut client, &mut accounts, TaskStatus::Expired)?;
                Outcome::Applied {
                    transition: Transition::Expired,
                    escrow_funded: 0,
                    worker_payment: 0,
                    fee: 0,
                    client_refund: task.reward,
                }
            }
            Command::PostTask { .. } => unreachable!(),
        };
        Ok(Effect {
            accounts,
            task: Some(task),
            treasury,
            outcome,
        })
    }
    fn refund(
        &self,
        task: &mut Task,
        client: &mut Account,
        accounts: &mut Vec<Account>,
        status: TaskStatus,
    ) -> Result<()> {
        client.balance = client
            .balance
            .checked_add(task.reward)
            .ok_or(SimulationError::Arithmetic("refund overflow"))?;
        client.refundable_escrow = client
            .refundable_escrow
            .checked_sub(task.reward)
            .filter(|v| *v >= 0)
            .ok_or(SimulationError::Integrity("refund reserve missing"))?;
        accounts.push(client.clone());
        if let Some(worker) = task.worker {
            let mut account = self.accounts[worker as usize].clone();
            account.active_tasks = account
                .active_tasks
                .checked_sub(1)
                .ok_or(SimulationError::Integrity("worker capacity missing"))?;
            account.failed_services = account
                .failed_services
                .checked_add(1)
                .ok_or(SimulationError::Arithmetic("service counter overflow"))?;
            accounts.push(account);
        }
        task.status = status;
        Ok(())
    }
    fn commit_effect(&mut self, event: MarketEvent, effect: Effect) -> Result<()> {
        let record = Record {
            processed_index: self.journal.len() as u64,
            event,
            outcome: effect.outcome,
        };
        let mut metrics = self.metrics.clone();
        metrics.observe(&record)?;
        for account in effect.accounts {
            let id = account.id as usize;
            self.accounts[id] = account;
        }
        if let Some(task) = effect.task {
            self.tasks.insert(task.id, task);
        }
        self.treasury = effect.treasury;
        self.metrics = metrics;
        self.last_key = Some(record.event.order_key());
        self.clock = record.event.simulation_tick;
        self.journal.push(record);
        Ok(())
    }
    fn process(&mut self, event: MarketEvent) -> Result<()> {
        let effect = self.effect(&event)?;
        if matches!(event.command, Command::PostTask { .. }) {
            self.reserved_expiries = self
                .reserved_expiries
                .checked_sub(1)
                .ok_or(SimulationError::Integrity("expiry admission missing"))?;
            if let Some(task) = effect.task.as_ref() {
                if self.next_id >= MAX_EVENTS as u64 {
                    return Err(SimulationError::Capacity("reserved expiry slot missing"));
                }
                let timer = MarketEvent {
                    event_id: self.next_id,
                    simulation_tick: task.deadline_tick,
                    priority: 0,
                    sequence: self.next_id,
                    command: Command::ExpireTask { task_id: task.id },
                };
                self.next_id += 1;
                self.queue.insert(timer.order_key(), timer);
            }
        }
        self.commit_effect(event, effect)
    }
    pub fn advance_to(&mut self, tick: u64) -> Result<()> {
        if self.finished || self.faulted || tick < self.clock || tick >= self.config.ticks {
            return Err(SimulationError::Integrity("invalid engine advance"));
        }
        while self
            .queue
            .first_key_value()
            .is_some_and(|(key, _)| key.0 <= tick)
        {
            let (_, event) = self
                .queue
                .pop_first()
                .ok_or(SimulationError::Integrity("queue entry missing"))?;
            if let Err(error) = self.process(event) {
                self.faulted = true;
                return Err(error);
            }
        }
        self.clock = tick;
        if let Err(error) = self.audit() {
            self.faulted = true;
            return Err(error);
        }
        Ok(())
    }
    pub fn run(&mut self) -> Result<()> {
        self.advance_to(self.config.ticks - 1)?;
        if self.reserved_expiries != 0 || !self.queue.is_empty() {
            self.faulted = true;
            return Err(SimulationError::Integrity("unfinished event queue"));
        }
        self.finished = true;
        Ok(())
    }
    pub fn run_scenario(&mut self) -> Result<()> {
        if self.next_id != 0 || !self.journal.is_empty() || self.finished || self.faulted {
            return Err(SimulationError::Integrity(
                "scenario requires a fresh engine",
            ));
        }
        self.scenario = Scenario::NormalTaskMarketV1;
        let mut rng = DeterministicRng::from_seed(self.config.seed);
        for id in 0..self.config.scenario_tasks as u64 {
            let client = rng
                .below(self.config.agent_count as u64)
                .ok_or(SimulationError::Integrity("invalid RNG bound"))?;
            let draw = rng
                .below(self.config.agent_count as u64 - 1)
                .ok_or(SimulationError::Integrity("invalid RNG bound"))?;
            let worker = if draw >= client { draw + 1 } else { draw };
            self.schedule(
                0,
                Command::PostTask {
                    task_id: id,
                    client,
                    title: format!("research-task-{id}"),
                    acceptance_digest: "c".repeat(64),
                    reward: self.config.reward_per_task,
                    deadline_tick: 4,
                },
            )?;
            if rng.below(10000).unwrap_or(10000) < u64::from(self.config.cancellation_bps) {
                self.schedule(
                    1,
                    Command::CancelTask {
                        task_id: id,
                        client,
                    },
                )?;
                continue;
            }
            self.schedule(
                1,
                Command::AcceptTask {
                    task_id: id,
                    worker,
                },
            )?;
            if rng.below(10000).unwrap_or(10000) < u64::from(self.config.failure_bps) {
                self.schedule(
                    2,
                    Command::FailTask {
                        task_id: id,
                        worker,
                    },
                )?;
            } else {
                self.schedule(
                    2,
                    Command::SubmitTask {
                        task_id: id,
                        worker,
                        artifact_digest: "a".repeat(64),
                    },
                )?;
                self.schedule(
                    3,
                    Command::ApproveTask {
                        task_id: id,
                        client,
                    },
                )?;
            }
        }
        self.run()
    }
    pub fn audit(&self) -> Result<()> {
        let mut reserves = vec![0i64; self.accounts.len()];
        let mut active = vec![0usize; self.accounts.len()];
        let mut completed = vec![0u64; self.accounts.len()];
        let mut failed = vec![0u64; self.accounts.len()];
        let mut held = 0u128;
        let mut fees = 0u128;
        let mut funded = 0u128;
        let mut paid = 0u128;
        let mut refunded = 0u128;
        for task in self.tasks.values() {
            funded += task.reward as u128;
            if task.status.holds_escrow() {
                held += task.reward as u128;
                reserves[task.client as usize] = reserves[task.client as usize]
                    .checked_add(task.reward)
                    .ok_or(SimulationError::Arithmetic("audit reserve overflow"))?;
            }
            if let Some(worker) = task.worker {
                if worker == task.client {
                    return Err(SimulationError::Integrity("self-assigned task"));
                }
                match task.status {
                    TaskStatus::Accepted | TaskStatus::Submitted => active[worker as usize] += 1,
                    TaskStatus::Completed => completed[worker as usize] += 1,
                    TaskStatus::Failed | TaskStatus::Expired => failed[worker as usize] += 1,
                    _ => {}
                }
            }
            match task.status {
                TaskStatus::Completed => {
                    let fee = task.reward as u128 * u128::from(self.config.fee_bps) / 10000;
                    fees += fee;
                    paid += task.reward as u128 - fee;
                }
                TaskStatus::Failed | TaskStatus::Cancelled | TaskStatus::Expired => {
                    refunded += task.reward as u128
                }
                _ => {}
            }
        }
        let mut available = 0u128;
        for (id, account) in self.accounts.iter().enumerate() {
            if account.id != id as u64
                || account.balance < 0
                || account.refundable_escrow != reserves[id]
                || account
                    .balance
                    .checked_add(account.refundable_escrow)
                    .is_none()
                || account.active_tasks != active[id]
                || account.completed_services != completed[id]
                || account.failed_services != failed[id]
            {
                return Err(SimulationError::Integrity("account/task invariant failed"));
            }
            available += account.balance as u128;
        }
        if available + held + self.treasury != self.config.initial_supply()?
            || fees != self.treasury
            || self.metrics.escrow_funded != funded
            || self.metrics.worker_payments != paid
            || self.metrics.fees_collected != fees
            || self.metrics.client_refunds != refunded
        {
            return Err(SimulationError::Integrity("economic conservation failed"));
        }
        Ok(())
    }
    pub fn replay(config: MarketConfig, scenario: Scenario, records: &[Record]) -> Result<Self> {
        if records.len() > MAX_EVENTS {
            return Err(SimulationError::Capacity("journal too large"));
        }
        let mut engine = Self::new(config)?;
        engine.scenario = scenario;
        let mut ids = BTreeSet::new();
        let mut timers = BTreeMap::new();
        let mut last = None;
        for (index, record) in records.iter().enumerate() {
            let event = &record.event;
            if record.processed_index != index as u64
                || event.event_id != event.sequence
                || event.event_id >= records.len() as u64
                || !ids.insert(event.event_id)
                || event.simulation_tick >= engine.config.ticks
                || event.priority != if event.command.is_timer() { 0 } else { 1 }
                || last.is_some_and(|key| key >= event.order_key())
            {
                return Err(SimulationError::Replay(
                    "invalid journal ordering or identity",
                ));
            }
            match &event.command {
                Command::PostTask {
                    title,
                    acceptance_digest,
                    ..
                } if title.len() > 128 || acceptance_digest.len() > 64 => {
                    return Err(SimulationError::Replay("oversized task input"))
                }
                Command::SubmitTask {
                    artifact_digest, ..
                } if artifact_digest.len() > 64 => {
                    return Err(SimulationError::Replay("oversized artifact input"))
                }
                _ => {}
            }
            last = Some(event.order_key());
            if event.command.is_timer()
                && timers
                    .insert(event.command.task_id(), event.clone())
                    .is_some()
            {
                return Err(SimulationError::Replay("duplicate task timer"));
            }
        }
        let mut expected = BTreeMap::new();
        for record in records {
            let event = &record.event;
            if let Some((key, _)) = expected.first_key_value() {
                if *key <= event.order_key() && *key != event.order_key() {
                    return Err(SimulationError::Replay("mandatory timer was skipped"));
                }
            }
            if event.command.is_timer()
                && expected.remove(&event.order_key()) != Some(event.command.task_id())
            {
                return Err(SimulationError::Replay("unscheduled timer"));
            }
            let effect = engine.effect(event)?;
            if effect.outcome != record.outcome {
                return Err(SimulationError::Replay(
                    "recorded outcome differs from semantics",
                ));
            }
            if matches!(event.command, Command::PostTask { .. }) {
                if let Some(task) = effect.task.as_ref() {
                    let timer = timers
                        .get(&task.id)
                        .ok_or(SimulationError::Replay("posted task lacks mandatory timer"))?;
                    if timer.simulation_tick != task.deadline_tick
                        || timer.event_id <= event.event_id
                    {
                        return Err(SimulationError::Replay("invalid automatic expiry"));
                    }
                    expected.insert(timer.order_key(), task.id);
                }
            }
            engine.commit_effect(event.clone(), effect)?;
        }
        if !expected.is_empty() {
            return Err(SimulationError::Replay("unprocessed mandatory timer"));
        }
        engine.clock = engine.config.ticks - 1;
        engine.next_id = records.len() as u64;
        engine.finished = true;
        engine.audit()?;
        if engine.tasks.values().any(|task| task.status.holds_escrow()) {
            return Err(SimulationError::Replay("final escrow not settled"));
        }
        Ok(engine)
    }
}

fn bounded_accounts<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<Account>, D::Error> {
    crate::report::bounded_vec::<D, Account, 100_000>(d)
}
fn bounded_tasks<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<Task>, D::Error> {
    crate::report::bounded_vec::<D, Task, 10_000>(d)
}
