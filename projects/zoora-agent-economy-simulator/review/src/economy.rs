//! AE-012: sustained, matched offline experiments on the existing community engine.
//! The balance ledger is a synthetic research model, never a wallet or signer.
use crate::{
    allocation::fingerprint,
    community::{
        Actor, CommunityCommand, CommunityConfig, CommunityEngine, CommunityOutcome,
        CommunityReport, Registration, Rejection,
    },
    direct::{DirectCommand, DirectOutcome, Receipt},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use zoora_agent_economy_simulator::{DeterministicRng, SimulationError, RNG_ALGORITHM};
use zoora_task_market::metrics::decimal;
type Result<T> = std::result::Result<T, SimulationError>;
const MAX_ATTEMPTS: usize = 5000;

macro_rules! bounded {
    ($name:ident, $typ:ty, $max:expr) => {
        fn $name<'de, D: serde::de::Deserializer<'de>>(
            d: D,
        ) -> std::result::Result<Vec<$typ>, D::Error> {
            crate::bounded::vec::<D, $typ, $max>(d)
        }
    };
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StressScenario {
    Balanced,
    SharedOperatorSpam,
    SybilSpam,
    ProviderOutage,
    DemandSurge,
    BudgetSqueeze,
    RefundStress,
    DigestOnly,
}
impl StressScenario {
    pub const ALL: [Self; 8] = [
        Self::Balanced,
        Self::SharedOperatorSpam,
        Self::SybilSpam,
        Self::ProviderOutage,
        Self::DemandSurge,
        Self::BudgetSqueeze,
        Self::RefundStress,
        Self::DigestOnly,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::Balanced => "BALANCED",
            Self::SharedOperatorSpam => "SHARED_OPERATOR_SPAM",
            Self::SybilSpam => "SYBIL_SPAM",
            Self::ProviderOutage => "PROVIDER_OUTAGE",
            Self::DemandSurge => "DEMAND_SURGE",
            Self::BudgetSqueeze => "BUDGET_SQUEEZE",
            Self::RefundStress => "REFUND_STRESS",
            Self::DigestOnly => "DIGEST_ONLY",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.label() == value)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdmissionPolicy {
    Baseline,
    OperatorCap,
}
impl AdmissionPolicy {
    pub const ALL: [Self; 2] = [Self::Baseline, Self::OperatorCap];
    pub fn label(self) -> &'static str {
        match self {
            Self::Baseline => "BASELINE",
            Self::OperatorCap => "OPERATOR_CAP",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.label() == value)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Phase {
    Normal,
    Stress,
    Recovery,
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
pub struct EconomyConfig {
    #[serde(deserialize_with = "bounded_seeds")]
    pub seeds: Vec<u64>,
    #[serde(deserialize_with = "bounded_scenarios")]
    pub scenarios: Vec<StressScenario>,
    pub agents: usize,
    pub rounds: usize,
    pub tasks_per_round: usize,
    pub provider_capacity: usize,
    pub max_unpaid_per_operator: usize,
    pub starting_balance: u64,
    pub price: u64,
    pub fee_bps: u64,
    pub burn_share_bps: u64,
    pub liquidity_share_bps: u64,
}
bounded!(bounded_seeds, u64, 16);
bounded!(bounded_scenarios, StressScenario, 8);
impl EconomyConfig {
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
            || !(1..=16).contains(&self.max_unpaid_per_operator)
            || self.starting_balance > 1_000_000_000_000
            || !(1..=1_000_000).contains(&self.price)
            || self.fee_bps > 1000
            || self.burn_share_bps > 10000
            || self.liquidity_share_bps > 10000
            || self.burn_share_bps + self.liquidity_share_bps > 10000
        {
            return Err(SimulationError::Configuration(
                "invalid bounded economy configuration",
            ));
        }
        let intentions = self.rounds * self.tasks_per_round * 3;
        let attacks = self.rounds * (self.agents / 2) * self.provider_capacity;
        if intentions + attacks > MAX_ATTEMPTS {
            return Err(SimulationError::Configuration(
                "economy attempt budget exceeds 5000",
            ));
        }
        Ok(())
    }
    pub fn from_toml(text: &str) -> Result<Self> {
        let config: Self = toml::from_str(text)
            .map_err(|_| SimulationError::Configuration("invalid economy TOML"))?;
        config.validate()?;
        Ok(config)
    }
    fn fee(&self) -> u64 {
        self.price * self.fee_bps / 10000
    }
    fn ticks(&self) -> u64 {
        3 + self.rounds as u64 * 8
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScriptedOutcome {
    Acknowledged,
    RefusedReturn,
    FullReturn,
    PartialReturn,
    Missing,
    DigestOnly,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Intention {
    pub round: usize,
    pub agreement_id: u64,
    pub provider: u64,
    pub client: u64,
    pub surge_only: bool,
    pub outcome: ScriptedOutcome,
}
bounded!(bounded_intentions, Intention, MAX_ATTEMPTS);
fn intentions(config: &EconomyConfig, seed: u64) -> Vec<Intention> {
    let mut rng = DeterministicRng::from_seed(seed);
    let providers = config.agents as u64 / 2;
    let clients = config.agents as u64 / 4;
    let mut list = Vec::new();
    for round in 0..config.rounds {
        for n in 0..config.tasks_per_round * 3 {
            list.push(Intention {
                round,
                agreement_id: list.len() as u64,
                provider: rng.below(providers).expect("bounded providers"),
                client: providers + rng.below(clients).expect("bounded clients"),
                surge_only: n >= config.tasks_per_round,
                outcome: match rng.below(10000).expect("bounded outcome") {
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
pub enum TransferKind {
    Payment,
    VoluntaryReturn,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LedgerEntry {
    pub sequence: u64,
    pub tick: u64,
    pub agreement_id: u64,
    pub kind: TransferKind,
    pub sender: u64,
    pub recipient: u64,
    pub amount: u64,
    pub fee: u64,
    pub burned: u64,
    pub liquidity_budget: u64,
    pub treasury: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Balance {
    pub agent_id: u64,
    #[serde(with = "decimal")]
    pub units: u128,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stocks {
    #[serde(with = "decimal")]
    pub opening_units: u128,
    #[serde(with = "decimal")]
    pub agent_liquid_units: u128,
    #[serde(with = "decimal")]
    pub treasury_units: u128,
    #[serde(with = "decimal")]
    pub liquidity_budget_units: u128,
    #[serde(with = "decimal")]
    pub burned_units: u128,
}
impl Stocks {
    pub fn conserved(&self) -> bool {
        self.agent_liquid_units
            .checked_add(self.treasury_units)
            .and_then(|v| v.checked_add(self.liquidity_budget_units))
            .and_then(|v| v.checked_add(self.burned_units))
            == Some(self.opening_units)
    }
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Flows {
    #[serde(with = "decimal")]
    pub payments: u128,
    #[serde(with = "decimal")]
    pub voluntary_returns: u128,
    #[serde(with = "decimal")]
    pub fees: u128,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "decision",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum AdmissionDecision {
    Admitted {},
    BudgetUnavailable {},
    OperatorReservationLimit {},
    EngineRejected { reason: Rejection },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Admission {
    pub tick: u64,
    pub agreement_id: u64,
    pub provider: u64,
    pub client: u64,
    pub declared_operator: u64,
    pub unpaid_attack: bool,
    pub decision: AdmissionDecision,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Counts {
    pub intended_work: u64,
    pub admitted_work: u64,
    pub acknowledged_work: u64,
    pub attack_requests: u64,
    pub admitted_attacks: u64,
    pub operator_limit_rejections: u64,
    pub budget_rejections: u64,
    pub provider_capacity_rejections: u64,
    pub unavailable_provider_rejections: u64,
    pub other_engine_rejections: u64,
    pub refused_returns: u64,
    pub digest_without_acknowledgment: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoundSummary {
    pub round: usize,
    pub phase: Phase,
    pub counts: Counts,
    pub flows: Flows,
    pub stocks: Stocks,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyMetrics {
    pub counts: Counts,
    pub flows: Flows,
    pub stocks: Stocks,
    #[serde(with = "decimal")]
    pub unacknowledged_net_units: u128,
    #[serde(with = "decimal")]
    pub undelivered_net_units: u128,
    pub acknowledged_per_intended_bps: Option<u64>,
    pub recovery_acknowledged_per_intended_bps: Option<u64>,
    pub largest_provider_payment_share_bps: Option<u64>,
}
struct Ledger {
    balances: Vec<u128>,
    stocks: Stocks,
    entries: Vec<LedgerEntry>,
}
impl Ledger {
    fn new(agents: usize, opening: u64) -> Self {
        let total = agents as u128 * u128::from(opening);
        Self {
            balances: vec![u128::from(opening); agents],
            stocks: Stocks {
                opening_units: total,
                agent_liquid_units: total,
                ..Stocks::default()
            },
            entries: Vec::new(),
        }
    }
    fn transfer(
        &mut self,
        config: &EconomyConfig,
        tick: u64,
        i: &Intention,
        kind: TransferKind,
        amount: u64,
    ) -> Result<()> {
        let (sender, recipient) = match kind {
            TransferKind::Payment => (i.client, i.provider),
            TransferKind::VoluntaryReturn => (i.provider, i.client),
        };
        let fee = if kind == TransferKind::Payment {
            config.fee()
        } else {
            0
        };
        let burned = fee * config.burn_share_bps / 10000;
        let liquidity_budget = fee * config.liquidity_share_bps / 10000;
        let treasury = fee - burned - liquidity_budget;
        let debit = u128::from(amount) + u128::from(fee);
        if self.balances[sender as usize] < debit {
            return Err(SimulationError::Integrity(
                "synthetic transfer exceeds budget",
            ));
        }
        self.balances[sender as usize] -= debit;
        self.balances[recipient as usize] += u128::from(amount);
        self.stocks.agent_liquid_units -= u128::from(fee);
        self.stocks.burned_units += u128::from(burned);
        self.stocks.liquidity_budget_units += u128::from(liquidity_budget);
        self.stocks.treasury_units += u128::from(treasury);
        if !self.stocks.conserved()
            || self.balances.iter().sum::<u128>() != self.stocks.agent_liquid_units
        {
            return Err(SimulationError::Integrity(
                "synthetic stock conservation failed",
            ));
        }
        self.entries.push(LedgerEntry {
            sequence: self.entries.len() as u64,
            tick,
            agreement_id: i.agreement_id,
            kind,
            sender,
            recipient,
            amount,
            fee,
            burned,
            liquidity_budget,
            treasury,
        });
        Ok(())
    }
}
fn actor(id: u64) -> Actor {
    Actor::Agent { agent_id: id }
}
fn record_workflow(
    e: &mut CommunityEngine,
    tick: u64,
    id: u64,
    command: DirectCommand,
) -> Result<()> {
    e.record(tick, actor(id), CommunityCommand::Workflow { command })?;
    if !matches!(
        e.journal().last().map(|r| &r.outcome),
        Some(CommunityOutcome::Forwarded {
            direct_outcome: DirectOutcome::Recorded {},
            ..
        })
    ) {
        return Err(SimulationError::Integrity(
            "scripted workflow unexpectedly rejected",
        ));
    }
    Ok(())
}
fn admit(
    e: &mut CommunityEngine,
    config: &EconomyConfig,
    policy: AdmissionPolicy,
    ledger: &Ledger,
    admissions: &mut Vec<Admission>,
    i: &Intention,
    unpaid_attack: bool,
) -> Result<()> {
    let tick = 3 + i.round as u64 * 8;
    let operator = e
        .profile(i.client)
        .ok_or(SimulationError::Integrity("missing client"))?
        .registration
        .operator_id;
    let unpaid = admissions
        .iter()
        .filter(|a| {
            a.declared_operator == operator
                && a.decision == (AdmissionDecision::Admitted {})
                && e.agreement(a.agreement_id)
                    .is_some_and(|g| g.payments_received == 0 && g.terms.delivery_deadline > tick)
        })
        .count();
    let decision = if !unpaid_attack
        && ledger.balances[i.client as usize] < u128::from(config.price + config.fee())
    {
        AdmissionDecision::BudgetUnavailable {}
    } else if policy == AdmissionPolicy::OperatorCap && unpaid >= config.max_unpaid_per_operator {
        AdmissionDecision::OperatorReservationLimit {}
    } else {
        e.record(
            tick,
            actor(i.client),
            CommunityCommand::AcceptOffer {
                offer_id: i.provider,
                agreement_id: i.agreement_id,
            },
        )?;
        match &e
            .journal()
            .last()
            .ok_or(SimulationError::Integrity("missing admission record"))?
            .outcome
        {
            CommunityOutcome::Forwarded {
                direct_outcome: DirectOutcome::Recorded {},
                ..
            } => AdmissionDecision::Admitted {},
            CommunityOutcome::Rejected { reason } => {
                AdmissionDecision::EngineRejected { reason: *reason }
            }
            _ => return Err(SimulationError::Integrity("unexpected admission outcome")),
        }
    };
    admissions.push(Admission {
        tick,
        agreement_id: i.agreement_id,
        provider: i.provider,
        client: i.client,
        declared_operator: operator,
        unpaid_attack,
        decision,
    });
    Ok(())
}

fn summarize_counts(admissions: &[Admission], admitted: &[Intention]) -> Counts {
    let mut c = Counts::default();
    for a in admissions {
        if a.unpaid_attack {
            c.attack_requests += 1;
            if a.decision == (AdmissionDecision::Admitted {}) {
                c.admitted_attacks += 1;
            }
        } else {
            c.intended_work += 1;
            match a.decision {
                AdmissionDecision::Admitted {} => c.admitted_work += 1,
                AdmissionDecision::BudgetUnavailable {} => c.budget_rejections += 1,
                AdmissionDecision::EngineRejected {
                    reason: Rejection::ProviderCapacity,
                } => c.provider_capacity_rejections += 1,
                AdmissionDecision::EngineRejected {
                    reason: Rejection::OfferUnavailable,
                } => c.unavailable_provider_rejections += 1,
                AdmissionDecision::EngineRejected { .. } => c.other_engine_rejections += 1,
                AdmissionDecision::OperatorReservationLimit {} => {}
            }
        }
        if a.decision == (AdmissionDecision::OperatorReservationLimit {}) {
            c.operator_limit_rejections += 1;
        }
    }
    for i in admitted {
        match i.outcome {
            ScriptedOutcome::Acknowledged => c.acknowledged_work += 1,
            ScriptedOutcome::RefusedReturn => c.refused_returns += 1,
            ScriptedOutcome::DigestOnly => c.digest_without_acknowledgment += 1,
            _ => {}
        }
    }
    c
}
fn flows(entries: &[LedgerEntry]) -> Flows {
    let mut f = Flows::default();
    for e in entries {
        match e.kind {
            TransferKind::Payment => f.payments += u128::from(e.amount),
            TransferKind::VoluntaryReturn => f.voluntary_returns += u128::from(e.amount),
        }
        f.fees += u128::from(e.fee);
    }
    f
}
fn total_counts(rounds: &[RoundSummary]) -> Counts {
    let mut total = Counts::default();
    for r in rounds {
        macro_rules! add { ($($field:ident),*) => { $(total.$field += r.counts.$field;)* }; }
        add!(
            intended_work,
            admitted_work,
            acknowledged_work,
            attack_requests,
            admitted_attacks,
            operator_limit_rejections,
            budget_rejections,
            provider_capacity_rejections,
            unavailable_provider_rejections,
            other_engine_rejections,
            refused_returns,
            digest_without_acknowledgment
        );
    }
    total
}
fn execute(
    config: &EconomyConfig,
    scenario: StressScenario,
    policy: AdmissionPolicy,
    workload: &[Intention],
) -> Result<(CommunityReport, Ledger, Vec<Admission>, Vec<RoundSummary>)> {
    let providers = config.agents as u64 / 2;
    let attacker_start = config.agents as u64 * 3 / 4;
    let mut engine = CommunityEngine::new(CommunityConfig {
        agents: config.agents,
        ticks: config.ticks(),
        max_pending_per_provider: config.provider_capacity,
        ..CommunityConfig::default()
    })?;
    let opening = if scenario == StressScenario::BudgetSqueeze {
        config.starting_balance / 10
    } else {
        config.starting_balance
    };
    let mut ledger = Ledger::new(config.agents, opening);
    let mut admissions = Vec::new();
    let mut rounds = Vec::new();
    for id in 0..config.agents as u64 {
        let operator_id = if id >= attacker_start && scenario != StressScenario::SybilSpam {
            attacker_start
        } else {
            id
        };
        engine.record(
            0,
            Actor::Operator { operator_id },
            CommunityCommand::Register {
                registration: Registration {
                    agent_id: id,
                    operator_id,
                    handle: format!("agent_{id}"),
                    wallet_label: format!("synthetic-wallet-{id}"),
                    capabilities: vec!["research".into()],
                },
            },
        )?;
    }
    for id in 0..providers {
        engine.record(
            1,
            actor(id),
            CommunityCommand::CreateProject {
                project_id: id,
                title: format!("Research provider {id}"),
                summary: "Scripted deliverables; no independent quality judgment.".into(),
            },
        )?;
        engine.record(
            1,
            actor(id),
            CommunityCommand::PublishOffer {
                offer_id: id,
                project_id: id,
                title: format!("Synthetic service {id}"),
                criteria_digest: "c".repeat(64),
                amount: config.price,
                delivery_ticks: 6,
            },
        )?;
    }
    for round in 0..config.rounds {
        let current_phase = phase(round, config.rounds);
        let tick = 3 + round as u64 * 8;
        let admission_start = admissions.len();
        let ledger_start = ledger.entries.len();
        if scenario == StressScenario::ProviderOutage
            && (round == config.rounds / 3 || round == config.rounds * 2 / 3)
        {
            for id in (0..providers).step_by(2) {
                engine.record(
                    tick,
                    Actor::Operator { operator_id: id },
                    CommunityCommand::SetActive {
                        agent_id: id,
                        active: current_phase != Phase::Stress,
                    },
                )?;
            }
        }
        if current_phase == Phase::Stress
            && matches!(
                scenario,
                StressScenario::SharedOperatorSpam | StressScenario::SybilSpam
            )
        {
            for provider in 0..providers {
                for n in 0..config.provider_capacity {
                    let offset = provider * config.provider_capacity as u64 + n as u64;
                    let i = Intention {
                        round,
                        agreement_id: 100_000 + round as u64 * 1024 + offset,
                        provider,
                        client: attacker_start + offset % (config.agents as u64 - attacker_start),
                        surge_only: false,
                        outcome: ScriptedOutcome::Missing,
                    };
                    admit(
                        &mut engine,
                        config,
                        policy,
                        &ledger,
                        &mut admissions,
                        &i,
                        true,
                    )?;
                }
            }
        }
        let mut admitted = Vec::new();
        for base in workload.iter().filter(|i| i.round == round) {
            if base.surge_only
                && !(scenario == StressScenario::DemandSurge && current_phase == Phase::Stress)
            {
                continue;
            }
            let mut i = base.clone();
            if current_phase == Phase::Stress {
                if scenario == StressScenario::RefundStress {
                    i.outcome = ScriptedOutcome::RefusedReturn;
                }
                if scenario == StressScenario::DigestOnly {
                    i.outcome = ScriptedOutcome::DigestOnly;
                }
            }
            admit(
                &mut engine,
                config,
                policy,
                &ledger,
                &mut admissions,
                &i,
                false,
            )?;
            if admissions
                .last()
                .is_some_and(|a| a.decision == (AdmissionDecision::Admitted {}))
            {
                record_workflow(
                    &mut engine,
                    tick,
                    i.client,
                    DirectCommand::PaymentReceipt {
                        receipt: Receipt::synthetic(
                            i.agreement_id,
                            0,
                            i.client,
                            i.provider,
                            config.price,
                            tick,
                        ),
                    },
                )?;
                ledger.transfer(config, tick, &i, TransferKind::Payment, config.price)?;
                admitted.push(i);
            }
        }
        for i in &admitted {
            match i.outcome {
                ScriptedOutcome::Acknowledged | ScriptedOutcome::DigestOnly => {
                    record_workflow(
                        &mut engine,
                        tick + 2,
                        i.provider,
                        DirectCommand::Deliver {
                            agreement_id: i.agreement_id,
                            provider: i.provider,
                            artifact_digest: "a".repeat(64),
                        },
                    )?;
                }
                ScriptedOutcome::RefusedReturn
                | ScriptedOutcome::FullReturn
                | ScriptedOutcome::PartialReturn => {
                    record_workflow(
                        &mut engine,
                        tick + 2,
                        i.client,
                        DirectCommand::Dispute {
                            agreement_id: i.agreement_id,
                            client: i.client,
                            reason_digest: "d".repeat(64),
                        },
                    )?;
                }
                ScriptedOutcome::Missing => {}
            }
        }
        for i in &admitted {
            match i.outcome {
                ScriptedOutcome::Acknowledged => record_workflow(
                    &mut engine,
                    tick + 3,
                    i.client,
                    DirectCommand::Acknowledge {
                        agreement_id: i.agreement_id,
                        client: i.client,
                    },
                )?,
                ScriptedOutcome::RefusedReturn
                | ScriptedOutcome::FullReturn
                | ScriptedOutcome::PartialReturn => {
                    record_workflow(
                        &mut engine,
                        tick + 3,
                        i.client,
                        DirectCommand::RequestRefund {
                            agreement_id: i.agreement_id,
                            client: i.client,
                            amount: config.price,
                            reason_digest: "f".repeat(64),
                        },
                    )?;
                }
                _ => {}
            }
        }
        for i in &admitted {
            match i.outcome {
                ScriptedOutcome::RefusedReturn => record_workflow(
                    &mut engine,
                    tick + 4,
                    i.provider,
                    DirectCommand::DeclineRefund {
                        agreement_id: i.agreement_id,
                        provider: i.provider,
                    },
                )?,
                ScriptedOutcome::FullReturn | ScriptedOutcome::PartialReturn => {
                    let amount = if i.outcome == ScriptedOutcome::FullReturn {
                        config.price
                    } else {
                        config.price / 2
                    };
                    if amount > 0 {
                        record_workflow(
                            &mut engine,
                            tick + 4,
                            i.provider,
                            DirectCommand::VoluntaryRefundReceipt {
                                receipt: Receipt::synthetic(
                                    i.agreement_id,
                                    1,
                                    i.provider,
                                    i.client,
                                    amount,
                                    tick + 4,
                                ),
                            },
                        )?;
                        ledger.transfer(
                            config,
                            tick + 4,
                            i,
                            TransferKind::VoluntaryReturn,
                            amount,
                        )?;
                    }
                }
                _ => {}
            }
        }
        rounds.push(RoundSummary {
            round,
            phase: current_phase,
            counts: summarize_counts(&admissions[admission_start..], &admitted),
            flows: flows(&ledger.entries[ledger_start..]),
            stocks: ledger.stocks.clone(),
        });
    }
    engine.finish()?;
    let report = CommunityReport::from_engine(&engine)?;
    Ok((report, ledger, admissions, rounds))
}

bounded!(bounded_balances, Balance, 64);
bounded!(bounded_ledger, LedgerEntry, 10_000);
bounded!(bounded_admissions, Admission, MAX_ATTEMPTS);
bounded!(bounded_rounds, RoundSummary, 24);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyRun {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub unit: String,
    pub rng: String,
    pub config: EconomyConfig,
    pub seed: u64,
    pub scenario: StressScenario,
    pub policy: AdmissionPolicy,
    #[serde(deserialize_with = "bounded_intentions")]
    pub intentions: Vec<Intention>,
    pub intentions_fingerprint: String,
    #[serde(deserialize_with = "bounded_admissions")]
    pub admissions: Vec<Admission>,
    #[serde(deserialize_with = "bounded_ledger")]
    pub ledger: Vec<LedgerEntry>,
    #[serde(deserialize_with = "bounded_balances")]
    pub final_balances: Vec<Balance>,
    #[serde(deserialize_with = "bounded_rounds")]
    pub rounds: Vec<RoundSummary>,
    pub metrics: EconomyMetrics,
    pub community: CommunityReport,
    pub fingerprint: String,
}
fn rate(numerator: u64, denominator: u64) -> Option<u64> {
    (numerator * 10000).checked_div(denominator)
}
impl EconomyRun {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE012_ECONOMY_RUN_V1\0",
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
                &self.admissions,
                &self.ledger,
                &self.final_balances,
                &self.rounds,
                &self.metrics,
                &self.community,
            ),
        )
    }
    pub fn generate(
        config: EconomyConfig,
        seed: u64,
        scenario: StressScenario,
        policy: AdmissionPolicy,
    ) -> Result<Self> {
        config.validate()?;
        if !config.seeds.contains(&seed) || !config.scenarios.contains(&scenario) {
            return Err(SimulationError::Configuration(
                "run seed/scenario must belong to campaign",
            ));
        }
        let intentions = intentions(&config, seed);
        let intentions_fingerprint = fingerprint(b"ZOORA_AE012_INTENTIONS_V1\0", &intentions)?;
        let (community, ledger, admissions, rounds) =
            execute(&config, scenario, policy, &intentions)?;
        let counts = total_counts(&rounds);
        let recovery: Vec<_> = rounds
            .iter()
            .filter(|r| r.phase == Phase::Recovery)
            .cloned()
            .collect();
        let recovery_counts = total_counts(&recovery);
        let mut provider_payments = vec![0_u128; config.agents];
        for e in &ledger.entries {
            if e.kind == TransferKind::Payment {
                provider_payments[e.recipient as usize] += u128::from(e.amount);
            }
        }
        let f = flows(&ledger.entries);
        let largest = provider_payments.into_iter().max().unwrap_or(0);
        let metrics = EconomyMetrics {
            acknowledged_per_intended_bps: rate(counts.acknowledged_work, counts.intended_work),
            recovery_acknowledged_per_intended_bps: rate(
                recovery_counts.acknowledged_work,
                recovery_counts.intended_work,
            ),
            largest_provider_payment_share_bps: (largest * 10000)
                .checked_div(f.payments)
                .map(|v| v as u64),
            counts,
            flows: f,
            stocks: ledger.stocks,
            unacknowledged_net_units: community
                .direct
                .agreements
                .iter()
                .filter(|a| !a.delivery_acknowledged)
                .map(|a| a.net_transferred())
                .sum(),
            undelivered_net_units: community
                .direct
                .agreements
                .iter()
                .filter(|a| a.delivery_digest.is_none())
                .map(|a| a.net_transferred())
                .sum(),
        };
        let mut run = Self {
            schema_version: 1,
            model: "zoora-economy-run/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            unit: "SIMULATED_UNITS".into(),
            rng: RNG_ALGORITHM.into(),
            config,
            seed,
            scenario,
            policy,
            intentions,
            intentions_fingerprint,
            admissions,
            ledger: ledger.entries,
            final_balances: ledger
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
            community,
            fingerprint: String::new(),
        };
        run.fingerprint = run.hash()?;
        Ok(run)
    }
    pub fn verify(&self) -> Result<()> {
        self.config.validate()?;
        if self.fingerprint != self.hash()?
            || Self::generate(self.config.clone(), self.seed, self.scenario, self.policy)? != *self
        {
            return Err(SimulationError::Replay("economy run regeneration differs"));
        }
        self.community.verify()?;
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyRow {
    pub seed: u64,
    pub scenario: StressScenario,
    pub policy: AdmissionPolicy,
    pub intentions_fingerprint: String,
    pub run_fingerprint: String,
    pub community_fingerprint: String,
    pub metrics: EconomyMetrics,
    #[serde(deserialize_with = "bounded_rounds")]
    pub rounds: Vec<RoundSummary>,
}
impl EconomyRow {
    pub fn from_run(run: EconomyRun) -> Self {
        Self {
            seed: run.seed,
            scenario: run.scenario,
            policy: run.policy,
            intentions_fingerprint: run.intentions_fingerprint,
            run_fingerprint: run.fingerprint,
            community_fingerprint: run.community.fingerprint,
            metrics: run.metrics,
            rounds: run.rounds,
        }
    }
}
bounded!(bounded_rows, EconomyRow, 256);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyCampaign {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub unit: String,
    pub rng: String,
    pub config: EconomyConfig,
    #[serde(deserialize_with = "bounded_rows")]
    pub runs: Vec<EconomyRow>,
    pub fingerprint: String,
}
impl EconomyCampaign {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE012_ECONOMY_CAMPAIGN_V1\0",
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
    pub fn generate(config: EconomyConfig) -> Result<Self> {
        config.validate()?;
        let mut runs = Vec::new();
        for seed in &config.seeds {
            for scenario in &config.scenarios {
                for policy in AdmissionPolicy::ALL {
                    runs.push(EconomyRow::from_run(EconomyRun::generate(
                        config.clone(),
                        *seed,
                        *scenario,
                        policy,
                    )?));
                }
            }
        }
        let mut campaign = Self {
            schema_version: 1,
            model: "zoora-economy-campaign/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            unit: "SIMULATED_UNITS".into(),
            rng: RNG_ALGORITHM.into(),
            config,
            runs,
            fingerprint: String::new(),
        };
        campaign.fingerprint = campaign.hash()?;
        Ok(campaign)
    }
    pub fn verify(&self) -> Result<()> {
        self.config.validate()?;
        if self.fingerprint != self.hash()? || Self::generate(self.config.clone())? != *self {
            return Err(SimulationError::Replay(
                "economy campaign regeneration differs",
            ));
        }
        Ok(())
    }
}
