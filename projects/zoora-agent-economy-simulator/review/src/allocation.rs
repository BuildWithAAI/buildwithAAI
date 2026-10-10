//! Opt-in allocation. Operator labels are declared synthetic identities, not authentication.
use crate::{config::MAX_EVENTS, types::*, ReviewConfig, ReviewEngine, ReviewReport, Scenario};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{self, Write},
};
use zoora_agent_economy_simulator::SimulationError;
type Result<T> = std::result::Result<T, SimulationError>;
pub const POLICY: &str = "DECLARED_OPERATOR_FAIR_REVIEW_ONE_APPEAL_V1";
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllocationConfig {
    #[serde(deserialize_with = "bounded_pool")]
    pub reviewer_accounts: Vec<u64>,
    pub max_active_per_operator: u64,
}
fn bounded_pool<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<u64>, D::Error> {
    crate::bounded::vec::<D, u64, 100_000>(d)
}
impl AllocationConfig {
    pub fn validate(&self, review: &ReviewConfig) -> Result<()> {
        review.validate()?;
        if self.reviewer_accounts.is_empty()
            || self.reviewer_accounts.len() > 100_000
            || self.max_active_per_operator == 0
            || self.max_active_per_operator > 5000
            || self.reviewer_accounts.windows(2).any(|v| v[0] >= v[1])
            || self
                .reviewer_accounts
                .iter()
                .any(|v| review.operator(*v).is_none())
        {
            return Err(SimulationError::Configuration(
                "invalid sorted reviewer pool or operator capacity",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Stage {
    Primary,
    Appeal,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Action {
    Assigned,
    Released,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllocationRecord {
    pub event_id: u64,
    pub simulation_tick: u64,
    pub task_id: u64,
    pub stage: Stage,
    pub reviewer: u64,
    pub operator: u64,
    pub action: Action,
}
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Load {
    active: u64,
    assigned: u64,
}
pub(crate) struct Allocator {
    config: AllocationConfig,
    pool: BTreeMap<u64, u64>, // account -> declared operator
    operators: BTreeMap<u64, Load>,
    accounts: BTreeMap<u64, Load>,
    reservations: BTreeMap<(u64, Stage), u64>,
    journal: Vec<AllocationRecord>,
}
impl Allocator {
    pub(crate) fn new(review: &ReviewConfig, config: AllocationConfig) -> Result<Self> {
        config.validate(review)?;
        let pool: BTreeMap<_, _> = config
            .reviewer_accounts
            .iter()
            .map(|id| (*id, review.operator(*id).expect("validated pool")))
            .collect();
        let accounts = pool.keys().map(|id| (*id, Load::default())).collect();
        let operators = pool.values().map(|id| (*id, Load::default())).collect();
        Ok(Self {
            config,
            pool,
            accounts,
            operators,
            reservations: BTreeMap::new(),
            journal: Vec::new(),
        })
    }
    pub(crate) fn config(&self) -> &AllocationConfig {
        &self.config
    }
    pub(crate) fn journal(&self) -> &[AllocationRecord] {
        &self.journal
    }
    pub(crate) fn select(&self, excluded: &[u64]) -> std::result::Result<u64, Rejection> {
        let mut eligible = false;
        let mut best = None;
        for (account, operator) in &self.pool {
            if excluded.contains(operator) {
                continue;
            }
            eligible = true;
            let op = &self.operators[operator];
            if op.active >= self.config.max_active_per_operator {
                continue;
            }
            let a = &self.accounts[account];
            let key = (
                op.active,
                op.assigned,
                *operator,
                a.active,
                a.assigned,
                *account,
            );
            if best.is_none_or(|(previous, _)| key < previous) {
                best = Some((key, *account));
            }
        }
        best.map(|(_, account)| account).ok_or(if eligible {
            Rejection::ReviewerCapacity
        } else {
            Rejection::NoIndependentReviewer
        })
    }
    pub(crate) fn assign(&mut self, event: &Event, stage: Stage, reviewer: u64) -> Result<()> {
        let operator = *self
            .pool
            .get(&reviewer)
            .ok_or(SimulationError::Integrity("assignment outside pool"))?;
        if self
            .reservations
            .contains_key(&(event.command.task_id(), stage))
            || self.operators[&operator].active >= self.config.max_active_per_operator
        {
            return Err(SimulationError::Integrity(
                "duplicate or over-capacity assignment",
            ));
        }
        self.reservations
            .insert((event.command.task_id(), stage), reviewer);
        for load in [
            self.operators.get_mut(&operator).expect("pool load"),
            self.accounts.get_mut(&reviewer).expect("account load"),
        ] {
            load.active += 1;
            load.assigned += 1;
        }
        self.record(event, stage, reviewer, operator, Action::Assigned)
    }
    pub(crate) fn release(&mut self, event: &Event, stage: Stage) -> Result<()> {
        let Some(reviewer) = self.reservations.remove(&(event.command.task_id(), stage)) else {
            return Ok(());
        };
        let operator = self.pool[&reviewer];
        for load in [
            self.operators.get_mut(&operator).expect("pool load"),
            self.accounts.get_mut(&reviewer).expect("account load"),
        ] {
            load.active = load
                .active
                .checked_sub(1)
                .ok_or(SimulationError::Integrity("allocation load underflow"))?;
        }
        self.record(event, stage, reviewer, operator, Action::Released)
    }
    fn record(
        &mut self,
        event: &Event,
        stage: Stage,
        reviewer: u64,
        operator: u64,
        action: Action,
    ) -> Result<()> {
        if self.journal.len() >= MAX_EVENTS * 2 {
            return Err(SimulationError::Capacity("allocation journal exhausted"));
        }
        self.journal.push(AllocationRecord {
            event_id: event.event_id,
            simulation_tick: event.simulation_tick,
            task_id: event.command.task_id(),
            stage,
            reviewer,
            operator,
            action,
        });
        Ok(())
    }
    pub(crate) fn audit(&self, cases: &BTreeMap<u64, ReviewCase>) -> Result<()> {
        let mut expected = BTreeMap::new();
        for case in cases.values() {
            if !matches!(
                case.status,
                CaseStatus::Completed
                    | CaseStatus::Refunded
                    | CaseStatus::Cancelled
                    | CaseStatus::Failed
                    | CaseStatus::Expired
            ) {
                if case.primary_decision.is_none() {
                    expected.insert((case.task_id, Stage::Primary), case.primary_reviewer);
                }
                if let Some(appeal) = &case.appeal {
                    if case.appeal_decision.is_none() {
                        expected.insert((case.task_id, Stage::Appeal), appeal.reviewer);
                    }
                }
            }
        }
        let mut reconstructed = BTreeMap::new();
        let mut operators: BTreeMap<_, _> = self
            .operators
            .keys()
            .map(|id| (*id, Load::default()))
            .collect();
        let mut accounts: BTreeMap<_, _> = self
            .accounts
            .keys()
            .map(|id| (*id, Load::default()))
            .collect();
        for record in &self.journal {
            if self.pool.get(&record.reviewer) != Some(&record.operator) {
                return Err(SimulationError::Integrity("allocation operator differs"));
            }
            let key = (record.task_id, record.stage);
            match record.action {
                Action::Assigned => {
                    if reconstructed.insert(key, record.reviewer).is_some() {
                        return Err(SimulationError::Integrity("duplicate allocation record"));
                    }
                    for load in [
                        operators.get_mut(&record.operator).expect("operator"),
                        accounts.get_mut(&record.reviewer).expect("reviewer"),
                    ] {
                        load.active += 1;
                        load.assigned += 1;
                    }
                    if operators[&record.operator].active > self.config.max_active_per_operator {
                        return Err(SimulationError::Integrity("operator capacity exceeded"));
                    }
                }
                Action::Released => {
                    if reconstructed.remove(&key) != Some(record.reviewer) {
                        return Err(SimulationError::Integrity("allocation release differs"));
                    }
                    for load in [
                        operators.get_mut(&record.operator).expect("operator"),
                        accounts.get_mut(&record.reviewer).expect("reviewer"),
                    ] {
                        load.active = load
                            .active
                            .checked_sub(1)
                            .ok_or(SimulationError::Integrity("allocation release underflow"))?;
                    }
                }
            }
        }
        if expected != self.reservations
            || reconstructed != expected
            || operators != self.operators
            || accounts != self.accounts
        {
            return Err(SimulationError::Integrity(
                "allocation ledger or reservation invariant failed",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllocationMetrics {
    pub assignments_by_operator: BTreeMap<u64, u64>,
    pub assignments_by_account: BTreeMap<u64, u64>,
    pub peak_active_by_operator: BTreeMap<u64, u64>,
    pub decisions_by_operator: BTreeMap<u64, u64>,
    pub largest_operator_decision_share_bps: Option<u64>,
    pub capacity_rejections: u64,
    pub independence_rejections: u64,
    pub active_at_finish: u64,
}
impl AllocationMetrics {
    fn compute(engine: &ReviewEngine) -> Self {
        let mut metrics = Self::default();
        let mut active = BTreeMap::<u64, u64>::new();
        for r in engine.allocation_journal() {
            let count = active.entry(r.operator).or_default();
            match r.action {
                Action::Assigned => {
                    *count += 1;
                    *metrics
                        .assignments_by_operator
                        .entry(r.operator)
                        .or_default() += 1;
                    *metrics
                        .assignments_by_account
                        .entry(r.reviewer)
                        .or_default() += 1;
                    let peak = metrics
                        .peak_active_by_operator
                        .entry(r.operator)
                        .or_default();
                    *peak = (*peak).max(*count);
                }
                Action::Released => *count -= 1,
            }
        }
        metrics.active_at_finish = active.values().sum();
        for r in engine.journal() {
            if matches!(
                r.outcome,
                Outcome::Rejected {
                    reason: Rejection::ReviewerCapacity
                }
            ) {
                metrics.capacity_rejections += 1;
            }
            if matches!(
                r.outcome,
                Outcome::Rejected {
                    reason: Rejection::OperatorConflict | Rejection::NoIndependentReviewer
                }
            ) {
                metrics.independence_rejections += 1;
            }
        }
        for case in engine.cases() {
            for decision in [case.primary_decision, case.appeal_decision]
                .into_iter()
                .flatten()
            {
                if let Some(op) = engine.config().operator(decision.reviewer) {
                    *metrics.decisions_by_operator.entry(op).or_default() += 1;
                }
            }
        }
        let total: u64 = metrics.decisions_by_operator.values().sum();
        if total > 0 {
            metrics.largest_operator_decision_share_bps = metrics
                .decisions_by_operator
                .values()
                .max()
                .map(|max| max * 10000 / total);
        }
        metrics
    }
}
struct HashWriter(Sha256);
impl Write for HashWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub(crate) fn fingerprint<T: Serialize>(prefix: &[u8], value: &T) -> Result<String> {
    let mut writer = HashWriter(Sha256::new());
    writer.0.update(prefix);
    serde_json::to_writer(&mut writer, value)
        .map_err(|_| SimulationError::Integrity("fingerprint encoding failed"))?;
    Ok(format!("{:x}", writer.0.finalize()))
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllocationReport {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub allocation: AllocationConfig,
    pub review: ReviewReport,
    #[serde(deserialize_with = "bounded_records")]
    pub allocation_journal: Vec<AllocationRecord>,
    pub metrics: AllocationMetrics,
    pub fingerprint: String,
}
fn bounded_records<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<AllocationRecord>, D::Error> {
    crate::bounded::vec::<D, AllocationRecord, { MAX_EVENTS * 2 }>(d)
}
impl AllocationReport {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE004_ALLOCATION_V1\0",
            &(
                self.schema_version,
                &self.model,
                &self.classification,
                &self.allocation,
                &self.review,
                &self.allocation_journal,
                &self.metrics,
            ),
        )
    }
    pub fn from_engine(engine: &ReviewEngine) -> Result<Self> {
        let allocation = engine
            .allocation_config()
            .ok_or(SimulationError::Integrity("allocation policy missing"))?
            .clone();
        let mut report = Self {
            schema_version: 1,
            model: "zoora-review-allocation/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            allocation,
            review: ReviewReport::snapshot(engine, POLICY)?,
            allocation_journal: engine.allocation_journal().to_vec(),
            metrics: AllocationMetrics::compute(engine),
            fingerprint: String::new(),
        };
        report.fingerprint = report.hash()?;
        Ok(report)
    }
    pub fn verify(&self) -> Result<()> {
        self.allocation.validate(&self.review.config)?;
        if self.schema_version != 1
            || self.model != "zoora-review-allocation/0.1.0"
            || self.classification != "SYNTHETIC"
            || self.review.scenario != Scenario::ManualReviewV1
            || self.review.policy != POLICY
            || self.allocation_journal.len() > MAX_EVENTS * 2
            || self.fingerprint != self.hash()?
        {
            return Err(SimulationError::Replay(
                "allocation identity or fingerprint differs",
            ));
        }
        self.review.market.verify()?;
        let engine = ReviewEngine::from_allocated_operations(
            self.review.config.clone(),
            self.allocation.clone(),
            &self.review.operations,
        )?;
        if Self::from_engine(&engine)? != *self {
            return Err(SimulationError::Replay(
                "allocation operation replay differs",
            ));
        }
        Ok(())
    }
}
