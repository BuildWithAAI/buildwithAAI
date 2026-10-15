//! AE-013: payment observations, bounded work queues and noncustodial admission.
//! All wallets, receipts, identities and work outcomes are explicit offline fixtures.
use crate::{
    allocation::fingerprint,
    direct::{
        DirectCommand, DirectConfig, DirectEngine, DirectOutcome, DirectReport, Receipt, Terms,
    },
    economy::{Balance, Phase, ScriptedOutcome},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use zoora_agent_economy_simulator::{DeterministicRng, SimulationError, RNG_ALGORITHM};
use zoora_task_market::metrics::decimal;
type Result<T> = std::result::Result<T, SimulationError>;
const MAX_REQUESTS: usize = 5000;
const ROUND_TICKS: u64 = 16;

macro_rules! bounded {
    ($name:ident,$typ:ty,$max:expr) => {
        fn $name<'de, D: serde::de::Deserializer<'de>>(
            d: D,
        ) -> std::result::Result<Vec<$typ>, D::Error> {
            crate::bounded::vec::<D, $typ, $max>(d)
        }
    };
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentScenario {
    NormalDelay,
    UnpaidSybilFlood,
    PaidSybilFlood,
    ObservationLag,
    LatePayment,
    DuplicateReceipts,
    OutOfTerms,
    UnbackedClaims,
}
impl PaymentScenario {
    pub const ALL: [Self; 8] = [
        Self::NormalDelay,
        Self::UnpaidSybilFlood,
        Self::PaidSybilFlood,
        Self::ObservationLag,
        Self::LatePayment,
        Self::DuplicateReceipts,
        Self::OutOfTerms,
        Self::UnbackedClaims,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::NormalDelay => "NORMAL_DELAY",
            Self::UnpaidSybilFlood => "UNPAID_SYBIL_FLOOD",
            Self::PaidSybilFlood => "PAID_SYBIL_FLOOD",
            Self::ObservationLag => "OBSERVATION_LAG",
            Self::LatePayment => "LATE_PAYMENT",
            Self::DuplicateReceipts => "DUPLICATE_RECEIPTS",
            Self::OutOfTerms => "OUT_OF_TERMS",
            Self::UnbackedClaims => "UNBACKED_CLAIMS",
        }
    }
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.label() == text)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentPolicy {
    ReserveOnQuote,
    StrictObservation,
    EvidenceGrace,
}
impl PaymentPolicy {
    pub const ALL: [Self; 3] = [
        Self::ReserveOnQuote,
        Self::StrictObservation,
        Self::EvidenceGrace,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::ReserveOnQuote => "RESERVE_ON_QUOTE",
            Self::StrictObservation => "STRICT_OBSERVATION",
            Self::EvidenceGrace => "EVIDENCE_GRACE",
        }
    }
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.label() == text)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentConfig {
    #[serde(deserialize_with = "bounded_seeds")]
    pub seeds: Vec<u64>,
    #[serde(deserialize_with = "bounded_scenarios")]
    pub scenarios: Vec<PaymentScenario>,
    pub agents: usize,
    pub rounds: usize,
    pub tasks_per_round: usize,
    pub provider_capacity: usize,
    pub max_quotes: usize,
    pub payment_window: u64,
    pub evidence_grace: u64,
    pub service_ticks: u64,
    pub starting_balance: u64,
    pub price: u64,
}
bounded!(bounded_seeds, u64, 16);
bounded!(bounded_scenarios, PaymentScenario, 8);
impl PaymentConfig {
    pub fn validate(&self) -> Result<()> {
        if self.seeds.is_empty()
            || self.seeds.len() > 16
            || self.seeds.windows(2).any(|s| s[0] >= s[1])
            || self.scenarios.is_empty()
            || self.scenarios.len() > 8
            || self.scenarios.iter().collect::<BTreeSet<_>>().len() != self.scenarios.len()
            || !(12..=64).contains(&self.agents)
            || !self.agents.is_multiple_of(4)
            || !(3..=24).contains(&self.rounds)
            || !(1..=64).contains(&self.tasks_per_round)
            || !(1..=16).contains(&self.provider_capacity)
            || !(1..=5000).contains(&self.max_quotes)
            || !(1..=6).contains(&self.payment_window)
            || self.evidence_grace > 6
            || !(1..=3).contains(&self.service_ticks)
            || self.payment_window + self.evidence_grace + self.service_ticks > 12
            || self.starting_balance > 1_000_000_000_000
            || !(1..=1_000_000).contains(&self.price)
        {
            return Err(SimulationError::Configuration(
                "invalid bounded payment campaign configuration",
            ));
        }
        if self.rounds * (self.tasks_per_round + self.agents / 2 * self.provider_capacity)
            > MAX_REQUESTS
        {
            return Err(SimulationError::Configuration(
                "payment intention budget exceeds 5000",
            ));
        }
        Ok(())
    }
    pub fn from_toml(text: &str) -> Result<Self> {
        let c: Self = toml::from_str(text)
            .map_err(|_| SimulationError::Configuration("invalid payment campaign TOML"))?;
        c.validate()?;
        Ok(c)
    }
    fn ticks(&self) -> u64 {
        3 + self.rounds as u64 * ROUND_TICKS
    }
}
fn phase(round: usize, rounds: usize) -> Phase {
    if round < rounds / 3 {
        Phase::Normal
    } else if round < rounds * 2 / 3 {
        Phase::Stress
    } else {
        Phase::Recovery
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentIntention {
    pub round: usize,
    pub agreement_id: u64,
    pub provider: u64,
    pub client: u64,
    pub attack_fixture: bool,
    pub observation_delay: u64,
    pub outcome: ScriptedOutcome,
}
bounded!(bounded_intentions, PaymentIntention, MAX_REQUESTS);
fn intentions(c: &PaymentConfig, seed: u64) -> Vec<PaymentIntention> {
    let mut rng = DeterministicRng::from_seed(seed);
    let mut list = Vec::new();
    let providers = c.agents as u64 / 2;
    for round in 0..c.rounds {
        for provider in 0..providers {
            for n in 0..c.provider_capacity {
                let offset = provider * c.provider_capacity as u64 + n as u64;
                list.push(PaymentIntention {
                    round,
                    agreement_id: round as u64 * 2048 + offset,
                    provider,
                    client: c.agents as u64 * 3 / 4 + offset % (c.agents as u64 / 4),
                    attack_fixture: true,
                    observation_delay: 1,
                    outcome: ScriptedOutcome::Missing,
                });
            }
        }
        for n in 0..c.tasks_per_round {
            list.push(PaymentIntention {
                round,
                agreement_id: round as u64 * 2048 + 1024 + n as u64,
                provider: rng.below(providers).expect("providers"),
                client: providers + rng.below(c.agents as u64 / 4).expect("clients"),
                attack_fixture: false,
                observation_delay: 1 + rng.below(2).expect("observation lag"),
                outcome: match rng.below(10000).expect("outcome") {
                    0..=5999 => ScriptedOutcome::Acknowledged,
                    6000..=6999 => ScriptedOutcome::RefusedReturn,
                    7000..=7999 => ScriptedOutcome::FullReturn,
                    8000..=8999 => ScriptedOutcome::PartialReturn,
                    _ => ScriptedOutcome::Missing,
                },
            });
        }
    }
    list
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QuoteDecision {
    Reserved,
    Unreserved,
    ProviderCapacity,
    MetadataCapacity,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkQuote {
    pub intention: PaymentIntention,
    pub quote_tick: u64,
    pub funding_cutoff: u64,
    pub evidence_cutoff: u64,
    pub delivery_deadline: u64,
    pub decision: QuoteDecision,
    pub started_tick: Option<u64>,
    pub acknowledged: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransferKind {
    Payment,
    VoluntaryReturn,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferFact {
    pub sequence: u64,
    pub kind: TransferKind,
    pub receipt: Receipt,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReceiptEligibility {
    Eligible,
    UnbackedClaim,
    Duplicate,
    AdapterRejected,
    LateTransfer,
    LateObservation,
    DeliveryWindowClosed,
    ReturnObservation,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentObservation {
    pub sequence: u64,
    pub receipt: Receipt,
    pub transfer_sequence: Option<u64>,
    pub direct_outcome: Option<DirectOutcome>,
    pub eligibility: ReceiptEligibility,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QueueAction {
    Ready,
    Started,
    Released,
    DeliveryDeadline,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueueEvent {
    pub sequence: u64,
    pub tick: u64,
    pub agreement_id: u64,
    pub action: QueueAction,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentCounts {
    pub intended_work: u64,
    pub quoted_work: u64,
    pub paid_work: u64,
    pub started_work: u64,
    pub acknowledged_work: u64,
    pub attack_requests: u64,
    pub quoted_attacks: u64,
    pub paid_attacks: u64,
    pub started_attacks: u64,
    pub work_capacity_rejections: u64,
    pub work_metadata_rejections: u64,
    pub insufficient_budget: u64,
    pub unbacked_claims: u64,
    pub duplicate_observations: u64,
    pub adapter_rejections: u64,
    pub late_transfer_observations: u64,
    pub late_evidence_observations: u64,
    pub paid_work_not_started: u64,
    pub peak_occupied_slots: u64,
    pub peak_paid_queue: u64,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentAmounts {
    #[serde(with = "decimal")]
    pub opening_units: u128,
    #[serde(with = "decimal")]
    pub final_wallet_units: u128,
    #[serde(with = "decimal")]
    pub payments_sent: u128,
    #[serde(with = "decimal")]
    pub voluntary_returns_sent: u128,
    #[serde(with = "decimal")]
    pub adapter_payments_recorded: u128,
    #[serde(with = "decimal")]
    pub observed_unapplied_payment_units: u128,
    #[serde(with = "decimal")]
    pub paid_not_started_net_units: u128,
    #[serde(with = "decimal")]
    pub unacknowledged_net_units: u128,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentRound {
    pub round: usize,
    pub phase: Phase,
    pub counts: PaymentCounts,
    pub amounts: PaymentAmounts,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentMetrics {
    pub counts: PaymentCounts,
    pub amounts: PaymentAmounts,
    pub acknowledged_per_intended_bps: Option<u64>,
    pub recovery_acknowledged_per_intended_bps: Option<u64>,
}

struct Job {
    view: WorkQuote,
    slot: bool,
    ready: bool,
    ready_sequence: Option<u64>,
    finished: bool,
}
impl Job {
    fn quoted(&self) -> bool {
        matches!(
            self.view.decision,
            QuoteDecision::Reserved | QuoteDecision::Unreserved
        )
    }
}
struct State {
    direct: DirectEngine,
    balances: Vec<u128>,
    transfers: Vec<TransferFact>,
    observations: Vec<PaymentObservation>,
    queue: Vec<QueueEvent>,
    jobs: Vec<Job>,
    seen: BTreeSet<String>,
    pending: Vec<Receipt>,
    insufficient: BTreeSet<u64>,
}
impl State {
    fn event(&mut self, tick: u64, id: u64, action: QueueAction) {
        self.queue.push(QueueEvent {
            sequence: self.queue.len() as u64,
            tick,
            agreement_id: id,
            action,
        });
    }
    fn command(&mut self, tick: u64, command: DirectCommand) -> Result<DirectOutcome> {
        self.direct.record(tick, command)?;
        self.direct
            .journal()
            .last()
            .map(|r| r.outcome.clone())
            .ok_or(SimulationError::Integrity("missing direct payment record"))
    }
    fn workflow(&mut self, tick: u64, command: DirectCommand) -> Result<()> {
        if self.command(tick, command)? != (DirectOutcome::Recorded {}) {
            return Err(SimulationError::Integrity(
                "scripted payment workflow rejected",
            ));
        }
        Ok(())
    }
    fn send(&mut self, kind: TransferKind, receipt: Receipt) -> Result<bool> {
        let before = self.balances.iter().sum::<u128>();
        let amount = u128::from(receipt.amount);
        let sender = receipt.sender as usize;
        let recipient = receipt.recipient as usize;
        if self.balances[sender] < amount {
            self.insufficient.insert(receipt.agreement_id);
            return Ok(false);
        }
        self.balances[sender] -= amount;
        self.balances[recipient] += amount;
        if self.balances.iter().sum::<u128>() != before {
            return Err(SimulationError::Integrity(
                "transfer balance conservation failed",
            ));
        }
        self.transfers.push(TransferFact {
            sequence: self.transfers.len() as u64,
            kind,
            receipt: receipt.clone(),
        });
        self.pending.push(receipt);
        Ok(true)
    }
}

fn eligibility(
    policy: PaymentPolicy,
    q: &WorkQuote,
    r: &Receipt,
    service_ticks: u64,
) -> ReceiptEligibility {
    if r.availability_tick + service_ticks + 1 >= q.delivery_deadline {
        return ReceiptEligibility::DeliveryWindowClosed;
    }
    if policy == PaymentPolicy::ReserveOnQuote {
        return ReceiptEligibility::Eligible;
    }
    if r.simulation_tick >= q.funding_cutoff {
        return ReceiptEligibility::LateTransfer;
    }
    let cutoff = if policy == PaymentPolicy::StrictObservation {
        q.funding_cutoff
    } else {
        q.evidence_cutoff
    };
    if r.availability_tick >= cutoff {
        ReceiptEligibility::LateObservation
    } else {
        ReceiptEligibility::Eligible
    }
}
fn observe(s: &mut State, c: &PaymentConfig, policy: PaymentPolicy, r: Receipt) -> Result<()> {
    let fact = s.transfers.iter().find(|f| f.receipt == r).cloned();
    let (transfer_sequence, direct_outcome, decision) = if let Some(f) = fact {
        if !s.seen.insert(r.transaction_ref.clone()) {
            (Some(f.sequence), None, ReceiptEligibility::Duplicate)
        } else {
            let command = match f.kind {
                TransferKind::Payment => DirectCommand::PaymentReceipt { receipt: r.clone() },
                TransferKind::VoluntaryReturn => {
                    DirectCommand::VoluntaryRefundReceipt { receipt: r.clone() }
                }
            };
            let outcome = s.command(r.availability_tick, command)?;
            let decision = if outcome != (DirectOutcome::Recorded {}) {
                ReceiptEligibility::AdapterRejected
            } else if f.kind == TransferKind::VoluntaryReturn {
                if s.direct
                    .agreement(r.agreement_id)
                    .is_some_and(|a| a.net_transferred() == 0)
                {
                    let pos = s
                        .jobs
                        .iter()
                        .position(|j| j.view.intention.agreement_id == r.agreement_id)
                        .ok_or(SimulationError::Integrity("returned fixture has no quote"))?;
                    s.jobs[pos].finished = true;
                    release(s, pos, r.availability_tick, QueueAction::Released);
                }
                ReceiptEligibility::ReturnObservation
            } else {
                let pos = s
                    .jobs
                    .iter()
                    .position(|j| j.view.intention.agreement_id == r.agreement_id)
                    .ok_or(SimulationError::Integrity("observed fixture has no quote"))?;
                let decision = eligibility(policy, &s.jobs[pos].view, &r, c.service_ticks);
                if decision == ReceiptEligibility::Eligible {
                    s.jobs[pos].ready_sequence = Some(s.queue.len() as u64);
                    s.jobs[pos].ready = true;
                    s.event(r.availability_tick, r.agreement_id, QueueAction::Ready);
                }
                decision
            };
            (Some(f.sequence), Some(outcome), decision)
        }
    } else {
        (None, None, ReceiptEligibility::UnbackedClaim)
    };
    s.observations.push(PaymentObservation {
        sequence: s.observations.len() as u64,
        receipt: r,
        transfer_sequence,
        direct_outcome,
        eligibility: decision,
    });
    Ok(())
}
fn release(s: &mut State, pos: usize, tick: u64, action: QueueAction) {
    if s.jobs[pos].slot {
        s.jobs[pos].slot = false;
        s.event(tick, s.jobs[pos].view.intention.agreement_id, action);
    }
}
fn work_step(s: &mut State, c: &PaymentConfig, pos: usize, tick: u64) -> Result<()> {
    let view = s.jobs[pos].view.clone();
    let i = &view.intention;
    if tick >= view.delivery_deadline {
        release(s, pos, tick, QueueAction::DeliveryDeadline);
        s.jobs[pos].ready = false;
    }
    let Some(start) = view.started_tick else {
        return Ok(());
    };
    let done = start + c.service_ticks;
    if tick == done {
        match i.outcome {
            ScriptedOutcome::Acknowledged | ScriptedOutcome::DigestOnly => s.workflow(
                tick,
                DirectCommand::Deliver {
                    agreement_id: i.agreement_id,
                    provider: i.provider,
                    artifact_digest: "a".repeat(64),
                },
            )?,
            ScriptedOutcome::RefusedReturn
            | ScriptedOutcome::FullReturn
            | ScriptedOutcome::PartialReturn => s.workflow(
                tick,
                DirectCommand::Dispute {
                    agreement_id: i.agreement_id,
                    client: i.client,
                    reason_digest: "d".repeat(64),
                },
            )?,
            ScriptedOutcome::Missing => {}
        }
    }
    if tick == done + 1 {
        match i.outcome {
            ScriptedOutcome::Acknowledged => {
                s.workflow(
                    tick,
                    DirectCommand::Acknowledge {
                        agreement_id: i.agreement_id,
                        client: i.client,
                    },
                )?;
                s.jobs[pos].view.acknowledged = true;
                s.jobs[pos].finished = true;
                release(s, pos, tick, QueueAction::Released);
            }
            ScriptedOutcome::RefusedReturn
            | ScriptedOutcome::FullReturn
            | ScriptedOutcome::PartialReturn => s.workflow(
                tick,
                DirectCommand::RequestRefund {
                    agreement_id: i.agreement_id,
                    client: i.client,
                    amount: c.price,
                    reason_digest: "f".repeat(64),
                },
            )?,
            _ => {}
        }
    }
    if tick == done + 2 {
        match i.outcome {
            ScriptedOutcome::RefusedReturn => s.workflow(
                tick,
                DirectCommand::DeclineRefund {
                    agreement_id: i.agreement_id,
                    provider: i.provider,
                },
            )?,
            ScriptedOutcome::FullReturn | ScriptedOutcome::PartialReturn => {
                let amount = if i.outcome == ScriptedOutcome::FullReturn {
                    c.price
                } else {
                    c.price / 2
                };
                if amount > 0
                    && !s.send(
                        TransferKind::VoluntaryReturn,
                        Receipt::synthetic(i.agreement_id, 1, i.provider, i.client, amount, tick),
                    )?
                {
                    return Err(SimulationError::Integrity(
                        "scripted voluntary return exceeds provider budget",
                    ));
                }
            }
            _ => {}
        }
    }
    Ok(())
}
fn summarize(
    s: &State,
    c: &PaymentConfig,
    round: Option<usize>,
    peaks: (u64, u64),
) -> (PaymentCounts, PaymentAmounts) {
    let jobs: Vec<_> = s
        .jobs
        .iter()
        .filter(|j| round.is_none_or(|r| j.view.intention.round == r))
        .collect();
    let ids: BTreeSet<_> = jobs.iter().map(|j| j.view.intention.agreement_id).collect();
    let transfers: Vec<_> = s
        .transfers
        .iter()
        .filter(|f| ids.contains(&f.receipt.agreement_id))
        .collect();
    let observations: Vec<_> = s
        .observations
        .iter()
        .filter(|o| ids.contains(&o.receipt.agreement_id))
        .collect();
    let mut paid = BTreeMap::<u64, u128>::new();
    let mut returned = BTreeMap::<u64, u128>::new();
    let opening = c.agents as u128 * u128::from(c.starting_balance);
    let mut amounts = PaymentAmounts {
        opening_units: opening,
        final_wallet_units: s.balances.iter().sum(),
        ..PaymentAmounts::default()
    };
    for f in &transfers {
        let amount = u128::from(f.receipt.amount);
        let id = f.receipt.agreement_id;
        match f.kind {
            TransferKind::Payment => {
                amounts.payments_sent += amount;
                *paid.entry(id).or_default() += amount;
            }
            TransferKind::VoluntaryReturn => {
                amounts.voluntary_returns_sent += amount;
                *returned.entry(id).or_default() += amount;
            }
        }
    }
    let credited: BTreeSet<_> = observations
        .iter()
        .filter(|o| o.direct_outcome == Some(DirectOutcome::Recorded {}))
        .filter_map(|o| o.transfer_sequence)
        .collect();
    for f in transfers.iter().filter(|f| f.kind == TransferKind::Payment) {
        if credited.contains(&f.sequence) {
            amounts.adapter_payments_recorded += u128::from(f.receipt.amount);
        } else {
            amounts.observed_unapplied_payment_units += u128::from(f.receipt.amount);
        }
    }
    let mut counts = PaymentCounts {
        peak_occupied_slots: peaks.0,
        peak_paid_queue: peaks.1,
        ..PaymentCounts::default()
    };
    for j in jobs {
        let i = &j.view.intention;
        let is_paid = paid.contains_key(&i.agreement_id);
        if i.attack_fixture {
            counts.attack_requests += 1;
            counts.quoted_attacks += u64::from(j.quoted());
            counts.paid_attacks += u64::from(is_paid);
            counts.started_attacks += u64::from(j.view.started_tick.is_some());
        } else {
            counts.intended_work += 1;
            counts.quoted_work += u64::from(j.quoted());
            counts.paid_work += u64::from(is_paid);
            counts.started_work += u64::from(j.view.started_tick.is_some());
            counts.acknowledged_work += u64::from(j.view.acknowledged);
            counts.work_capacity_rejections +=
                u64::from(j.view.decision == QuoteDecision::ProviderCapacity);
            counts.work_metadata_rejections +=
                u64::from(j.view.decision == QuoteDecision::MetadataCapacity);
            counts.insufficient_budget += u64::from(s.insufficient.contains(&i.agreement_id));
            counts.paid_work_not_started += u64::from(is_paid && j.view.started_tick.is_none());
        }
        let net = paid.get(&i.agreement_id).copied().unwrap_or(0)
            - returned.get(&i.agreement_id).copied().unwrap_or(0);
        if j.view.started_tick.is_none() {
            amounts.paid_not_started_net_units += net;
        }
        if !j.view.acknowledged {
            amounts.unacknowledged_net_units += net;
        }
    }
    for o in observations {
        match o.eligibility {
            ReceiptEligibility::UnbackedClaim => counts.unbacked_claims += 1,
            ReceiptEligibility::Duplicate => counts.duplicate_observations += 1,
            ReceiptEligibility::AdapterRejected => counts.adapter_rejections += 1,
            ReceiptEligibility::LateTransfer => counts.late_transfer_observations += 1,
            ReceiptEligibility::LateObservation => counts.late_evidence_observations += 1,
            _ => {}
        }
    }
    (counts, amounts)
}
fn execute(
    c: &PaymentConfig,
    scenario: PaymentScenario,
    policy: PaymentPolicy,
    plan: &[PaymentIntention],
) -> Result<(State, Vec<PaymentRound>)> {
    let mut s = State {
        direct: DirectEngine::new(DirectConfig {
            agents: c.agents as u64,
            ticks: c.ticks(),
            max_agreements: c.max_quotes,
        })?,
        balances: vec![u128::from(c.starting_balance); c.agents],
        transfers: Vec::new(),
        observations: Vec::new(),
        queue: Vec::new(),
        jobs: Vec::new(),
        seen: BTreeSet::new(),
        pending: Vec::new(),
        insufficient: BTreeSet::new(),
    };
    let mut rounds = Vec::new();
    let mut quoted = 0;
    for round in 0..c.rounds {
        let p = phase(round, c.rounds);
        let base = 3 + round as u64 * ROUND_TICKS;
        let first = s.jobs.len();
        for i in plan.iter().filter(|i| i.round == round) {
            if i.attack_fixture
                && !(p == Phase::Stress
                    && matches!(
                        scenario,
                        PaymentScenario::UnpaidSybilFlood
                            | PaymentScenario::PaidSybilFlood
                            | PaymentScenario::UnbackedClaims
                    ))
            {
                continue;
            }
            let occupied = s
                .jobs
                .iter()
                .filter(|j| j.slot && j.view.intention.provider == i.provider)
                .count();
            let decision = if quoted >= c.max_quotes {
                QuoteDecision::MetadataCapacity
            } else if policy == PaymentPolicy::ReserveOnQuote && occupied >= c.provider_capacity {
                QuoteDecision::ProviderCapacity
            } else if policy == PaymentPolicy::ReserveOnQuote {
                QuoteDecision::Reserved
            } else {
                QuoteDecision::Unreserved
            };
            let view = WorkQuote {
                intention: i.clone(),
                quote_tick: base,
                funding_cutoff: base + c.payment_window,
                evidence_cutoff: base + c.payment_window + c.evidence_grace,
                delivery_deadline: base + 13,
                decision,
                started_tick: None,
                acknowledged: false,
            };
            if matches!(
                decision,
                QuoteDecision::Reserved | QuoteDecision::Unreserved
            ) {
                s.workflow(
                    base,
                    DirectCommand::Agree {
                        terms: Terms {
                            agreement_id: i.agreement_id,
                            client: i.client,
                            provider: i.provider,
                            title: format!("Synthetic work {}", i.agreement_id),
                            asset: "SYNTHETIC_UNIT".into(),
                            amount: c.price,
                            delivery_deadline: view.delivery_deadline,
                            criteria_digest: "c".repeat(64),
                        },
                    },
                )?;
                quoted += 1;
            }
            s.jobs.push(Job {
                view,
                slot: decision == QuoteDecision::Reserved,
                ready: false,
                ready_sequence: None,
                finished: false,
            });
        }
        let mut peaks = (0, 0);
        for tick in base..base + ROUND_TICKS {
            for pos in first..s.jobs.len() {
                work_step(&mut s, c, pos, tick)?;
            }
            for pos in first..s.jobs.len() {
                let q = s.jobs[pos].view.clone();
                let i = &q.intention;
                let late = p == Phase::Stress
                    && scenario == PaymentScenario::LatePayment
                    && !i.attack_fixture;
                let send_tick = if late {
                    base + c.payment_window + 1
                } else {
                    base + 1
                };
                if tick == send_tick
                    && s.jobs[pos].quoted()
                    && (!i.attack_fixture || scenario == PaymentScenario::PaidSybilFlood)
                {
                    let amount = c.price
                        + u64::from(
                            p == Phase::Stress
                                && scenario == PaymentScenario::OutOfTerms
                                && !i.attack_fixture,
                        );
                    let mut receipt =
                        Receipt::synthetic(i.agreement_id, 0, i.client, i.provider, amount, tick);
                    receipt.availability_tick = if p == Phase::Stress
                        && scenario == PaymentScenario::ObservationLag
                        && !i.attack_fixture
                    {
                        base + 7
                    } else {
                        tick + i.observation_delay
                    };
                    if s.send(TransferKind::Payment, receipt.clone())?
                        && p == Phase::Stress
                        && scenario == PaymentScenario::DuplicateReceipts
                    {
                        s.pending.push(receipt);
                    }
                }
                if tick == base + 1
                    && p == Phase::Stress
                    && scenario == PaymentScenario::UnbackedClaims
                    && i.attack_fixture
                {
                    s.pending.push(Receipt::synthetic(
                        i.agreement_id,
                        77,
                        i.client,
                        i.provider,
                        c.price,
                        tick,
                    ));
                }
            }
            let ready: Vec<_> = s
                .pending
                .iter()
                .filter(|r| r.availability_tick == tick)
                .cloned()
                .collect();
            s.pending.retain(|r| r.availability_tick != tick);
            for receipt in ready {
                observe(&mut s, c, policy, receipt)?;
            }
            for provider in 0..c.agents as u64 / 2 {
                let mut occupied = s
                    .jobs
                    .iter()
                    .filter(|j| j.slot && j.view.intention.provider == provider)
                    .count();
                peaks.0 = peaks.0.max(occupied as u64);
                let queued = s.jobs[first..]
                    .iter()
                    .filter(|j| {
                        j.ready
                            && j.view.started_tick.is_none()
                            && j.view.intention.provider == provider
                    })
                    .count();
                peaks.1 = peaks.1.max(queued as u64);
                let mut candidates: Vec<_> = (first..s.jobs.len())
                    .filter(|pos| s.jobs[*pos].ready)
                    .collect();
                candidates.sort_by_key(|pos| s.jobs[*pos].ready_sequence);
                for pos in candidates {
                    let j = &s.jobs[pos];
                    if !j.ready
                        || j.finished
                        || j.view.started_tick.is_some()
                        || j.view.intention.provider != provider
                        || tick + c.service_ticks + 1 >= j.view.delivery_deadline
                    {
                        continue;
                    }
                    if !j.slot && occupied >= c.provider_capacity {
                        continue;
                    }
                    if !j.slot {
                        s.jobs[pos].slot = true;
                        occupied += 1;
                    }
                    s.jobs[pos].view.started_tick = Some(tick);
                    s.jobs[pos].ready = false;
                    s.event(
                        tick,
                        s.jobs[pos].view.intention.agreement_id,
                        QueueAction::Started,
                    );
                }
                if occupied > c.provider_capacity {
                    return Err(SimulationError::Integrity(
                        "provider work capacity exceeded",
                    ));
                }
                peaks.0 = peaks.0.max(occupied as u64);
            }
            if s.balances.iter().sum::<u128>() != c.agents as u128 * u128::from(c.starting_balance)
            {
                return Err(SimulationError::Integrity(
                    "synthetic payment balances do not conserve units",
                ));
            }
        }
        let (counts, amounts) = summarize(&s, c, Some(round), peaks);
        rounds.push(PaymentRound {
            round,
            phase: p,
            counts,
            amounts,
        });
    }
    if !s.pending.is_empty() {
        return Err(SimulationError::Integrity(
            "unobserved fixture remains after payment study",
        ));
    }
    s.direct.finish()?;
    Ok((s, rounds))
}

bounded!(bounded_quotes, WorkQuote, MAX_REQUESTS);
bounded!(bounded_transfers, TransferFact, 10_000);
bounded!(bounded_observations, PaymentObservation, 20_000);
bounded!(bounded_queue, QueueEvent, 20_000);
bounded!(bounded_balances, Balance, 64);
bounded!(bounded_rounds, PaymentRound, 24);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentRun {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub unit: String,
    pub rng: String,
    pub config: PaymentConfig,
    pub seed: u64,
    pub scenario: PaymentScenario,
    pub policy: PaymentPolicy,
    #[serde(deserialize_with = "bounded_intentions")]
    pub intentions: Vec<PaymentIntention>,
    pub intentions_fingerprint: String,
    #[serde(deserialize_with = "bounded_quotes")]
    pub quotes: Vec<WorkQuote>,
    #[serde(deserialize_with = "bounded_transfers")]
    pub transfers: Vec<TransferFact>,
    #[serde(deserialize_with = "bounded_observations")]
    pub observations: Vec<PaymentObservation>,
    #[serde(deserialize_with = "bounded_queue")]
    pub queue: Vec<QueueEvent>,
    #[serde(deserialize_with = "bounded_balances")]
    pub final_balances: Vec<Balance>,
    #[serde(deserialize_with = "bounded_rounds")]
    pub rounds: Vec<PaymentRound>,
    pub metrics: PaymentMetrics,
    pub direct: DirectReport,
    pub fingerprint: String,
}
fn rate(n: u64, d: u64) -> Option<u64> {
    (n * 10000).checked_div(d)
}
impl PaymentRun {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE013_PAYMENT_RUN_V1\0",
            &(
                (
                    self.schema_version,
                    &self.model,
                    &self.classification,
                    &self.unit,
                    &self.rng,
                ),
                &self.config,
                self.seed,
                self.scenario,
                self.policy,
                &self.intentions,
                &self.intentions_fingerprint,
                &self.quotes,
                &self.transfers,
                &self.observations,
                &self.queue,
                &self.final_balances,
                &self.rounds,
                &self.metrics,
                &self.direct,
            ),
        )
    }
    pub fn generate(
        config: PaymentConfig,
        seed: u64,
        scenario: PaymentScenario,
        policy: PaymentPolicy,
    ) -> Result<Self> {
        config.validate()?;
        if !config.seeds.contains(&seed) || !config.scenarios.contains(&scenario) {
            return Err(SimulationError::Configuration(
                "payment run must belong to configured campaign",
            ));
        }
        let intentions = intentions(&config, seed);
        let intentions_fingerprint =
            fingerprint(b"ZOORA_AE013_PAYMENT_INTENTIONS_V1\0", &intentions)?;
        let (state, rounds) = execute(&config, scenario, policy, &intentions)?;
        let peaks = (
            rounds
                .iter()
                .map(|r| r.counts.peak_occupied_slots)
                .max()
                .unwrap_or(0),
            rounds
                .iter()
                .map(|r| r.counts.peak_paid_queue)
                .max()
                .unwrap_or(0),
        );
        let (counts, amounts) = summarize(&state, &config, None, peaks);
        let recovery: Vec<_> = rounds
            .iter()
            .filter(|r| r.phase == Phase::Recovery)
            .collect();
        let metrics = PaymentMetrics {
            acknowledged_per_intended_bps: rate(counts.acknowledged_work, counts.intended_work),
            recovery_acknowledged_per_intended_bps: rate(
                recovery.iter().map(|r| r.counts.acknowledged_work).sum(),
                recovery.iter().map(|r| r.counts.intended_work).sum(),
            ),
            counts,
            amounts,
        };
        let direct = DirectReport::from_engine(&state.direct)?;
        if direct.metrics.payments_recorded != metrics.amounts.adapter_payments_recorded
            || direct.metrics.voluntary_refunds_recorded != metrics.amounts.voluntary_returns_sent
            || metrics.amounts.opening_units != metrics.amounts.final_wallet_units
            || metrics.amounts.payments_sent
                != metrics.amounts.adapter_payments_recorded
                    + metrics.amounts.observed_unapplied_payment_units
        {
            return Err(SimulationError::Integrity(
                "payment fact and adapter totals disagree",
            ));
        }
        let mut report = Self {
            schema_version: 1,
            model: "zoora-payment-run/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            unit: "SIMULATED_UNITS".into(),
            rng: RNG_ALGORITHM.into(),
            config,
            seed,
            scenario,
            policy,
            intentions,
            intentions_fingerprint,
            quotes: state.jobs.into_iter().map(|j| j.view).collect(),
            transfers: state.transfers,
            observations: state.observations,
            queue: state.queue,
            final_balances: state
                .balances
                .into_iter()
                .enumerate()
                .map(|(id, units)| Balance {
                    agent_id: id as u64,
                    units,
                })
                .collect(),
            rounds,
            metrics,
            direct,
            fingerprint: String::new(),
        };
        report.fingerprint = report.hash()?;
        Ok(report)
    }
    pub fn verify(&self) -> Result<()> {
        self.config.validate()?;
        if self.fingerprint != self.hash()?
            || Self::generate(self.config.clone(), self.seed, self.scenario, self.policy)? != *self
        {
            return Err(SimulationError::Replay("payment run regeneration differs"));
        }
        self.direct.verify()?;
        Ok(())
    }
}
bounded!(bounded_samples, PaymentObservation, 12);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentRow {
    pub seed: u64,
    pub scenario: PaymentScenario,
    pub policy: PaymentPolicy,
    pub intentions_fingerprint: String,
    pub run_fingerprint: String,
    pub metrics: PaymentMetrics,
    #[serde(deserialize_with = "bounded_rounds")]
    pub rounds: Vec<PaymentRound>,
    #[serde(deserialize_with = "bounded_samples")]
    pub sampled_stress_observations: Vec<PaymentObservation>,
}
impl PaymentRow {
    pub fn from_run(run: PaymentRun) -> Self {
        let sampled_stress_observations = run
            .observations
            .iter()
            .filter(|o| {
                phase((o.receipt.agreement_id / 2048) as usize, run.config.rounds) == Phase::Stress
            })
            .take(12)
            .cloned()
            .collect();
        Self {
            seed: run.seed,
            scenario: run.scenario,
            policy: run.policy,
            intentions_fingerprint: run.intentions_fingerprint,
            run_fingerprint: run.fingerprint,
            metrics: run.metrics,
            rounds: run.rounds,
            sampled_stress_observations,
        }
    }
}
bounded!(bounded_rows, PaymentRow, 384);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentCampaign {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub unit: String,
    pub rng: String,
    pub config: PaymentConfig,
    #[serde(deserialize_with = "bounded_rows")]
    pub runs: Vec<PaymentRow>,
    pub fingerprint: String,
}
impl PaymentCampaign {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE013_PAYMENT_CAMPAIGN_V1\0",
            &(
                self.schema_version,
                &self.model,
                &self.classification,
                &self.unit,
                &self.rng,
                &self.config,
                &self.runs,
            ),
        )
    }
    pub fn generate(config: PaymentConfig) -> Result<Self> {
        config.validate()?;
        let mut runs = Vec::new();
        for seed in &config.seeds {
            for scenario in &config.scenarios {
                for policy in PaymentPolicy::ALL {
                    runs.push(PaymentRow::from_run(PaymentRun::generate(
                        config.clone(),
                        *seed,
                        *scenario,
                        policy,
                    )?));
                }
            }
        }
        let mut report = Self {
            schema_version: 1,
            model: "zoora-payment-campaign/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            unit: "SIMULATED_UNITS".into(),
            rng: RNG_ALGORITHM.into(),
            config,
            runs,
            fingerprint: String::new(),
        };
        report.fingerprint = report.hash()?;
        Ok(report)
    }
    pub fn verify(&self) -> Result<()> {
        self.config.validate()?;
        if self.fingerprint != self.hash()? || Self::generate(self.config.clone())? != *self {
            return Err(SimulationError::Replay(
                "payment campaign regeneration differs",
            ));
        }
        Ok(())
    }
}
