//! AE-014 offline capacity authorization. Tokens are deterministic fixtures, not signatures.
use crate::{
    allocation::fingerprint,
    direct::{
        DirectCommand, DirectConfig, DirectEngine, DirectOutcome, DirectReport, Receipt, Terms,
    },
    economy::{Balance, Phase, ScriptedOutcome},
    payments::{
        intentions, PaymentConfig, PaymentIntention, PaymentScenario, TransferFact, TransferKind,
    },
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use zoora_agent_economy_simulator::{SimulationError, RNG_ALGORITHM};
use zoora_task_market::metrics::decimal;
type Result<T> = std::result::Result<T, SimulationError>;
const ROUND_TICKS: u64 = 32;
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
pub enum AuthorizationScenario {
    NormalDelay,
    UnpaidBurst,
    RenewingUnpaid,
    PaidFlood,
    ObservationLag,
    EvidenceAfterExpiry,
    DuplicateAuthorization,
    ProviderOutage,
}
impl AuthorizationScenario {
    pub const ALL: [Self; 8] = [
        Self::NormalDelay,
        Self::UnpaidBurst,
        Self::RenewingUnpaid,
        Self::PaidFlood,
        Self::ObservationLag,
        Self::EvidenceAfterExpiry,
        Self::DuplicateAuthorization,
        Self::ProviderOutage,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::NormalDelay => "NORMAL_DELAY",
            Self::UnpaidBurst => "UNPAID_BURST",
            Self::RenewingUnpaid => "RENEWING_UNPAID",
            Self::PaidFlood => "PAID_FLOOD",
            Self::ObservationLag => "OBSERVATION_LAG",
            Self::EvidenceAfterExpiry => "EVIDENCE_AFTER_EXPIRY",
            Self::DuplicateAuthorization => "DUPLICATE_AUTHORIZATION",
            Self::ProviderOutage => "PROVIDER_OUTAGE",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|v| v.label() == s)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthorizationPolicy {
    UnreservedPayment,
    FundingWindowHold,
    EvidenceWindowHold,
}
impl AuthorizationPolicy {
    pub const ALL: [Self; 3] = [
        Self::UnreservedPayment,
        Self::FundingWindowHold,
        Self::EvidenceWindowHold,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::UnreservedPayment => "UNRESERVED_PAYMENT",
            Self::FundingWindowHold => "FUNDING_WINDOW_HOLD",
            Self::EvidenceWindowHold => "EVIDENCE_WINDOW_HOLD",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|v| v.label() == s)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationConfig {
    #[serde(deserialize_with = "bounded_seeds")]
    pub seeds: Vec<u64>,
    #[serde(deserialize_with = "bounded_scenarios")]
    pub scenarios: Vec<AuthorizationScenario>,
    pub agents: usize,
    pub rounds: usize,
    pub tasks_per_round: usize,
    pub provider_capacity: usize,
    pub max_quotes: usize,
    pub max_authorizations: usize,
    pub send_window: u64,
    pub evidence_grace: u64,
    pub service_ticks: u64,
    pub starting_balance: u64,
    pub price: u64,
}
bounded!(bounded_seeds, u64, 16);
bounded!(bounded_scenarios, AuthorizationScenario, 8);
impl AuthorizationConfig {
    fn plan_config(&self) -> PaymentConfig {
        PaymentConfig {
            seeds: self.seeds.clone(),
            scenarios: vec![PaymentScenario::NormalDelay],
            agents: self.agents,
            rounds: self.rounds,
            tasks_per_round: self.tasks_per_round,
            provider_capacity: self.provider_capacity,
            max_quotes: self.max_quotes,
            payment_window: self.send_window,
            evidence_grace: self.evidence_grace,
            service_ticks: self.service_ticks,
            starting_balance: self.starting_balance,
            price: self.price,
        }
    }
    pub fn validate(&self) -> Result<()> {
        self.plan_config().validate()?;
        if self.scenarios.is_empty()
            || self.scenarios.len() > 8
            || self.scenarios.iter().collect::<BTreeSet<_>>().len() != self.scenarios.len()
            || self.rounds * (self.tasks_per_round + self.agents / 2 * self.provider_capacity)
                > 2000
            || self.max_quotes > 2000
            || !(1..=8000).contains(&self.max_authorizations)
            || self.send_window < 2
        {
            return Err(SimulationError::Configuration(
                "invalid bounded authorization configuration",
            ));
        }
        Ok(())
    }
    pub fn from_toml(s: &str) -> Result<Self> {
        let c: Self = toml::from_str(s)
            .map_err(|_| SimulationError::Configuration("invalid authorization TOML"))?;
        c.validate()?;
        Ok(c)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentBinding {
    pub agreement_id: u64,
    pub client: u64,
    pub provider: u64,
    pub amount: u64,
    pub delivery_deadline: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapacityPermit {
    pub token: String,
    pub ordinal: u64,
    pub binding: PaymentBinding,
    pub issued_tick: u64,
    pub send_before: u64,
    pub observe_before: u64,
    pub consumed_tick: Option<u64>,
    pub started_tick: Option<u64>,
    pub holds_capacity: bool,
    pub expired: bool,
    pub released: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthorizationAction {
    Granted,
    CapacityRefused,
    DeadlineRefused,
    MetadataRefused,
    SendAllowed,
    UnknownToken,
    BindingMismatch,
    SendExpired,
    AlreadyConsumed,
    HoldExpired,
    AuthorizationExpired,
    Started,
    Released,
    DeliveryDeadline,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationEvent {
    pub sequence: u64,
    pub tick: u64,
    pub agreement_id: u64,
    pub provider: u64,
    pub token: Option<String>,
    pub action: AuthorizationAction,
}

/// Local fixture book. A caller must authenticate real owners outside this model.
pub struct CapacityBook {
    config: AuthorizationConfig,
    policy: AuthorizationPolicy,
    permits: Vec<CapacityPermit>,
    events: Vec<AuthorizationEvent>,
    tick: u64,
}
impl CapacityBook {
    pub fn new(config: AuthorizationConfig, policy: AuthorizationPolicy) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            config,
            policy,
            permits: vec![],
            events: vec![],
            tick: 0,
        })
    }
    pub fn permits(&self) -> &[CapacityPermit] {
        &self.permits
    }
    pub fn journal(&self) -> &[AuthorizationEvent] {
        &self.events
    }
    fn event(
        &mut self,
        b: &PaymentBinding,
        token: Option<String>,
        action: AuthorizationAction,
    ) -> Result<()> {
        if self.events.len() >= 200_000 {
            return Err(SimulationError::Configuration(
                "authorization journal budget exceeded",
            ));
        }
        self.events.push(AuthorizationEvent {
            sequence: self.events.len() as u64,
            tick: self.tick,
            agreement_id: b.agreement_id,
            provider: b.provider,
            token,
            action,
        });
        Ok(())
    }
    pub fn occupied(&self, provider: u64) -> usize {
        self.permits
            .iter()
            .filter(|p| p.binding.provider == provider && p.holds_capacity)
            .count()
    }
    pub fn advance(&mut self, tick: u64) -> Result<()> {
        if tick < self.tick || tick > 3 + self.config.rounds as u64 * ROUND_TICKS {
            return Err(SimulationError::Configuration(
                "authorization clock outside monotonic run",
            ));
        }
        self.tick = tick;
        for n in 0..self.permits.len() {
            let p = self.permits[n].clone();
            if p.released {
                continue;
            }
            if p.started_tick.is_some() {
                if tick >= p.binding.delivery_deadline {
                    self.permits[n].holds_capacity = false;
                    self.permits[n].released = true;
                    self.event(
                        &p.binding,
                        Some(p.token),
                        AuthorizationAction::DeliveryDeadline,
                    )?;
                }
                continue;
            }
            let hold_before = if self.policy == AuthorizationPolicy::FundingWindowHold {
                p.send_before
            } else {
                p.observe_before
            };
            if p.holds_capacity && tick >= hold_before {
                self.permits[n].holds_capacity = false;
                self.event(
                    &p.binding,
                    Some(p.token.clone()),
                    AuthorizationAction::HoldExpired,
                )?;
            }
            if !p.expired && tick >= p.observe_before {
                self.permits[n].expired = true;
                self.event(
                    &p.binding,
                    Some(p.token),
                    AuthorizationAction::AuthorizationExpired,
                )?;
            }
        }
        Ok(())
    }
    pub fn grant(&mut self, binding: PaymentBinding) -> Result<Option<String>> {
        if self
            .permits
            .iter()
            .any(|p| p.binding.agreement_id == binding.agreement_id && p.binding != binding)
        {
            return Err(SimulationError::Configuration(
                "agreement binding cannot change on reissue",
            ));
        }
        if binding.client >= self.config.agents as u64
            || binding.provider >= self.config.agents as u64 / 2
            || binding.client == binding.provider
            || binding.amount != self.config.price
            || binding.delivery_deadline > 3 + self.config.rounds as u64 * ROUND_TICKS
        {
            return Err(SimulationError::Configuration(
                "invalid authorization binding",
            ));
        }
        let send_before = self.tick + self.config.send_window;
        let observe_before = send_before + self.config.evidence_grace;
        let refusal = if self.permits.len() >= self.config.max_authorizations {
            Some(AuthorizationAction::MetadataRefused)
        } else if observe_before + self.config.service_ticks >= binding.delivery_deadline {
            Some(AuthorizationAction::DeadlineRefused)
        } else if self.policy != AuthorizationPolicy::UnreservedPayment
            && self.occupied(binding.provider) >= self.config.provider_capacity
        {
            Some(AuthorizationAction::CapacityRefused)
        } else {
            None
        };
        if let Some(action) = refusal {
            self.event(&binding, None, action)?;
            return Ok(None);
        }
        // At most one unresolved permit per agreement, even under repeated calls.
        if self
            .permits
            .iter()
            .any(|p| p.binding.agreement_id == binding.agreement_id && !p.expired && !p.released)
        {
            return Err(SimulationError::Configuration(
                "agreement already has active authorization",
            ));
        }
        let ordinal = self.permits.len() as u64;
        let token = fingerprint(
            b"ZOORA_AE014_CAPACITY_PERMIT_V1\0",
            &(ordinal, &binding, self.tick, send_before, observe_before),
        )?;
        self.permits.push(CapacityPermit {
            token: token.clone(),
            ordinal,
            binding: binding.clone(),
            issued_tick: self.tick,
            send_before,
            observe_before,
            consumed_tick: None,
            started_tick: None,
            holds_capacity: self.policy != AuthorizationPolicy::UnreservedPayment,
            expired: false,
            released: false,
        });
        self.event(&binding, Some(token.clone()), AuthorizationAction::Granted)?;
        Ok(Some(token))
    }
    pub fn consume(
        &mut self,
        token: &str,
        binding: &PaymentBinding,
    ) -> Result<AuthorizationAction> {
        let pos = self.permits.iter().position(|p| p.token == token);
        let action = match pos {
            None => AuthorizationAction::UnknownToken,
            Some(n) => {
                let p = &self.permits[n];
                if &p.binding != binding {
                    AuthorizationAction::BindingMismatch
                } else if p.consumed_tick.is_some() {
                    AuthorizationAction::AlreadyConsumed
                } else if p.released
                    || p.expired
                    || self.tick >= p.send_before
                    || self.tick <= p.issued_tick
                {
                    AuthorizationAction::SendExpired
                } else {
                    self.permits[n].consumed_tick = Some(self.tick);
                    AuthorizationAction::SendAllowed
                }
            }
        };
        self.event(binding, Some(token.into()), action)?;
        Ok(action)
    }
    fn start(&mut self, token: &str) -> Result<bool> {
        let Some(n) = self.permits.iter().position(|p| p.token == token) else {
            return Ok(false);
        };
        let p = self.permits[n].clone();
        if p.consumed_tick.is_none()
            || p.started_tick.is_some()
            || p.expired
            || p.released
            || self.tick >= p.observe_before
            || self.tick + self.config.service_ticks + 1 >= p.binding.delivery_deadline
        {
            return Ok(false);
        }
        if !p.holds_capacity && self.occupied(p.binding.provider) >= self.config.provider_capacity {
            return Ok(false);
        }
        self.permits[n].holds_capacity = true;
        self.permits[n].started_tick = Some(self.tick);
        self.event(&p.binding, Some(p.token), AuthorizationAction::Started)?;
        Ok(true)
    }
    fn release(&mut self, token: &str) -> Result<()> {
        let n = self
            .permits
            .iter()
            .position(|p| p.token == token)
            .ok_or(SimulationError::Integrity("unknown release token"))?;
        let p = self.permits[n].clone();
        if p.started_tick.is_none() {
            return Err(SimulationError::Integrity("release requires started work"));
        }
        if !p.released {
            self.permits[n].holds_capacity = false;
            self.permits[n].released = true;
            self.event(&p.binding, Some(p.token), AuthorizationAction::Released)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizedJob {
    pub intention: PaymentIntention,
    pub binding: PaymentBinding,
    pub quoted: bool,
    pub token: Option<String>,
    pub sent: bool,
    pub budget_refused: bool,
    pub started_tick: Option<u64>,
    pub acknowledged: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationObservation {
    pub sequence: u64,
    pub transfer_sequence: u64,
    pub receipt: Receipt,
    pub recorded: bool,
    pub timely: bool,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationCounts {
    pub intended_work: u64,
    pub quoted_work: u64,
    pub paid_work: u64,
    pub started_work: u64,
    pub acknowledged_work: u64,
    pub paid_work_not_started: u64,
    pub insufficient_budget: u64,
    pub attack_requests: u64,
    pub started_attacks: u64,
    pub permits_granted: u64,
    pub capacity_refusals: u64,
    pub deadline_refusals: u64,
    pub metadata_refusals: u64,
    pub expired_holds: u64,
    pub duplicate_send_refusals: u64,
    pub late_observations: u64,
    pub peak_provider_slots: u64,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationAmounts {
    #[serde(with = "decimal")]
    pub opening_units: u128,
    #[serde(with = "decimal")]
    pub final_wallet_units: u128,
    #[serde(with = "decimal")]
    pub payments_sent: u128,
    #[serde(with = "decimal")]
    pub voluntary_returns_sent: u128,
    #[serde(with = "decimal")]
    pub paid_work_not_started_net_units: u128,
    #[serde(with = "decimal")]
    pub unacknowledged_net_units: u128,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationMetrics {
    pub counts: AuthorizationCounts,
    pub amounts: AuthorizationAmounts,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationRound {
    pub round: usize,
    pub phase: Phase,
    pub metrics: AuthorizationMetrics,
}
struct State {
    direct: DirectEngine,
    book: CapacityBook,
    jobs: Vec<AuthorizedJob>,
    balances: Vec<u128>,
    transfers: Vec<TransferFact>,
    observations: Vec<AuthorizationObservation>,
    pending: Vec<(usize, Receipt)>,
    ready: BTreeMap<usize, u64>,
}
impl State {
    fn command(&mut self, tick: u64, c: DirectCommand) -> Result<()> {
        self.direct.record(tick, c)?;
        if self
            .direct
            .journal()
            .last()
            .is_none_or(|j| j.outcome != DirectOutcome::Recorded {})
        {
            return Err(SimulationError::Integrity(
                "authorization direct workflow rejected",
            ));
        }
        Ok(())
    }
    fn transfer(&mut self, kind: TransferKind, r: Receipt) -> Result<bool> {
        let amount = u128::from(r.amount);
        if self.balances[r.sender as usize] < amount {
            return Ok(false);
        }
        self.balances[r.sender as usize] -= amount;
        self.balances[r.recipient as usize] += amount;
        let n = self.transfers.len();
        self.transfers.push(TransferFact {
            sequence: n as u64,
            kind,
            receipt: r.clone(),
        });
        self.pending.push((n, r));
        Ok(true)
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
fn metrics(
    s: &State,
    c: &AuthorizationConfig,
    round: Option<usize>,
    peak: u64,
) -> AuthorizationMetrics {
    let jobs: Vec<_> = s
        .jobs
        .iter()
        .filter(|j| round.is_none_or(|r| j.intention.round == r))
        .collect();
    let ids: BTreeSet<_> = jobs.iter().map(|j| j.binding.agreement_id).collect();
    let mut counts = AuthorizationCounts {
        peak_provider_slots: peak,
        ..AuthorizationCounts::default()
    };
    let mut amounts = AuthorizationAmounts {
        opening_units: c.agents as u128 * c.starting_balance as u128,
        final_wallet_units: s.balances.iter().sum(),
        ..AuthorizationAmounts::default()
    };
    let mut paid = BTreeMap::<u64, u128>::new();
    let mut returned = BTreeMap::<u64, u128>::new();
    for f in s
        .transfers
        .iter()
        .filter(|f| ids.contains(&f.receipt.agreement_id))
    {
        let a = f.receipt.amount as u128;
        match f.kind {
            TransferKind::Payment => {
                amounts.payments_sent += a;
                *paid.entry(f.receipt.agreement_id).or_default() += a;
            }
            TransferKind::VoluntaryReturn => {
                amounts.voluntary_returns_sent += a;
                *returned.entry(f.receipt.agreement_id).or_default() += a;
            }
        }
    }
    for j in jobs {
        let p = paid.get(&j.binding.agreement_id).copied().unwrap_or(0);
        let net = p - returned.get(&j.binding.agreement_id).copied().unwrap_or(0);
        if j.intention.attack_fixture {
            counts.attack_requests += 1;
            counts.started_attacks += u64::from(j.started_tick.is_some());
        } else {
            counts.intended_work += 1;
            counts.quoted_work += u64::from(j.quoted);
            counts.paid_work += u64::from(p > 0);
            counts.started_work += u64::from(j.started_tick.is_some());
            counts.acknowledged_work += u64::from(j.acknowledged);
            counts.paid_work_not_started += u64::from(p > 0 && j.started_tick.is_none());
            counts.insufficient_budget += u64::from(j.budget_refused);
            if p > 0 && j.started_tick.is_none() {
                amounts.paid_work_not_started_net_units += net;
            }
        }
        if !j.acknowledged {
            amounts.unacknowledged_net_units += net;
        }
    }
    for e in s
        .book
        .journal()
        .iter()
        .filter(|e| ids.contains(&e.agreement_id))
    {
        match e.action {
            AuthorizationAction::Granted => counts.permits_granted += 1,
            AuthorizationAction::CapacityRefused => counts.capacity_refusals += 1,
            AuthorizationAction::DeadlineRefused => counts.deadline_refusals += 1,
            AuthorizationAction::MetadataRefused => counts.metadata_refusals += 1,
            AuthorizationAction::HoldExpired => counts.expired_holds += 1,
            AuthorizationAction::AlreadyConsumed => counts.duplicate_send_refusals += 1,
            _ => {}
        }
    }
    counts.late_observations = s
        .observations
        .iter()
        .filter(|o| {
            ids.contains(&o.receipt.agreement_id)
                && !o.timely
                && s.transfers[o.transfer_sequence as usize].kind == TransferKind::Payment
        })
        .count() as u64;
    AuthorizationMetrics { counts, amounts }
}
fn execute(
    c: &AuthorizationConfig,
    seed: u64,
    scenario: AuthorizationScenario,
    policy: AuthorizationPolicy,
) -> Result<(State, Vec<AuthorizationRound>, Vec<PaymentIntention>)> {
    let plan = intentions(&c.plan_config(), seed);
    let mut s = State {
        direct: DirectEngine::new(DirectConfig {
            agents: c.agents as u64,
            ticks: 3 + c.rounds as u64 * ROUND_TICKS,
            max_agreements: c.max_quotes,
        })?,
        book: CapacityBook::new(c.clone(), policy)?,
        jobs: vec![],
        balances: vec![c.starting_balance as u128; c.agents],
        transfers: vec![],
        observations: vec![],
        pending: vec![],
        ready: BTreeMap::new(),
    };
    let mut rounds = vec![];
    let mut quoted = 0;
    for round in 0..c.rounds {
        let base = 3 + round as u64 * ROUND_TICKS;
        let p = phase(round, c.rounds);
        let stress = p == Phase::Stress;
        let first = s.jobs.len();
        for i in plan.iter().filter(|i| i.round == round) {
            if i.attack_fixture
                && !(stress
                    && matches!(
                        scenario,
                        AuthorizationScenario::UnpaidBurst
                            | AuthorizationScenario::RenewingUnpaid
                            | AuthorizationScenario::PaidFlood
                    ))
            {
                continue;
            }
            let binding = PaymentBinding {
                agreement_id: i.agreement_id,
                client: i.client,
                provider: i.provider,
                amount: c.price,
                delivery_deadline: base + 29,
            };
            let admitted = quoted < c.max_quotes;
            if admitted {
                s.command(
                    base,
                    DirectCommand::Agree {
                        terms: Terms {
                            agreement_id: i.agreement_id,
                            client: i.client,
                            provider: i.provider,
                            title: format!("Synthetic authorized work {}", i.agreement_id),
                            asset: "SYNTHETIC_UNIT".into(),
                            amount: c.price,
                            delivery_deadline: binding.delivery_deadline,
                            criteria_digest: "c".repeat(64),
                        },
                    },
                )?;
                quoted += 1;
            }
            s.jobs.push(AuthorizedJob {
                intention: i.clone(),
                binding,
                quoted: admitted,
                token: None,
                sent: false,
                budget_refused: false,
                started_tick: None,
                acknowledged: false,
            });
        }
        let mut peak = 0;
        for tick in base..base + ROUND_TICKS {
            s.book.advance(tick)?;
            for pos in first..s.jobs.len() {
                let j = s.jobs[pos].clone();
                let Some(start) = j.started_tick else {
                    continue;
                };
                let done = start + c.service_ticks;
                let outcome = if stress && scenario == AuthorizationScenario::ProviderOutage {
                    ScriptedOutcome::Missing
                } else {
                    j.intention.outcome
                };
                if tick == done {
                    match outcome {
                        ScriptedOutcome::Acknowledged => s.command(
                            tick,
                            DirectCommand::Deliver {
                                agreement_id: j.binding.agreement_id,
                                provider: j.binding.provider,
                                artifact_digest: "a".repeat(64),
                            },
                        )?,
                        ScriptedOutcome::FullReturn
                        | ScriptedOutcome::PartialReturn
                        | ScriptedOutcome::RefusedReturn => s.command(
                            tick,
                            DirectCommand::Dispute {
                                agreement_id: j.binding.agreement_id,
                                client: j.binding.client,
                                reason_digest: "d".repeat(64),
                            },
                        )?,
                        _ => {}
                    }
                }
                if tick == done + 1 {
                    match outcome {
                        ScriptedOutcome::Acknowledged => {
                            s.command(
                                tick,
                                DirectCommand::Acknowledge {
                                    agreement_id: j.binding.agreement_id,
                                    client: j.binding.client,
                                },
                            )?;
                            s.jobs[pos].acknowledged = true;
                            s.book.release(j.token.as_deref().expect("started token"))?;
                        }
                        ScriptedOutcome::FullReturn
                        | ScriptedOutcome::PartialReturn
                        | ScriptedOutcome::RefusedReturn => s.command(
                            tick,
                            DirectCommand::RequestRefund {
                                agreement_id: j.binding.agreement_id,
                                client: j.binding.client,
                                amount: c.price,
                                reason_digest: "f".repeat(64),
                            },
                        )?,
                        _ => {}
                    }
                }
                if tick == done + 2 {
                    match outcome {
                        ScriptedOutcome::RefusedReturn => s.command(
                            tick,
                            DirectCommand::DeclineRefund {
                                agreement_id: j.binding.agreement_id,
                                provider: j.binding.provider,
                            },
                        )?,
                        ScriptedOutcome::FullReturn | ScriptedOutcome::PartialReturn => {
                            let a = if outcome == ScriptedOutcome::FullReturn {
                                c.price
                            } else {
                                c.price / 2
                            };
                            if a > 0
                                && !s.transfer(
                                    TransferKind::VoluntaryReturn,
                                    Receipt::synthetic(
                                        j.binding.agreement_id,
                                        1,
                                        j.binding.provider,
                                        j.binding.client,
                                        a,
                                        tick,
                                    ),
                                )?
                            {
                                return Err(SimulationError::Integrity(
                                    "voluntary return exceeds budget",
                                ));
                            }
                        }
                        _ => {}
                    }
                }
            }
            // Attempts precede client sending. No scheduler branch reads attack_fixture.
            for pos in first..s.jobs.len() {
                let j = s.jobs[pos].clone();
                if !j.quoted || j.sent || tick <= base || tick >= j.binding.delivery_deadline {
                    continue;
                }
                let current = j
                    .token
                    .as_ref()
                    .and_then(|t| s.book.permits.iter().find(|p| &p.token == t));
                let attempt = current.is_none()
                    || (stress
                        && scenario == AuthorizationScenario::RenewingUnpaid
                        && j.intention.attack_fixture
                        && current.is_some_and(|p| p.expired));
                if attempt {
                    if let Some(token) = s.book.grant(j.binding.clone())? {
                        s.jobs[pos].token = Some(token);
                    }
                }
            }
            for pos in first..s.jobs.len() {
                let j = s.jobs[pos].clone();
                let Some(token) = j.token.as_deref() else {
                    continue;
                };
                let permit = s
                    .book
                    .permits
                    .iter()
                    .find(|p| p.token == token)
                    .expect("issued token")
                    .clone();
                if j.sent
                    || tick != permit.issued_tick + 1
                    || (j.intention.attack_fixture && scenario != AuthorizationScenario::PaidFlood)
                {
                    continue;
                }
                if s.balances[j.binding.client as usize] < c.price as u128 {
                    s.jobs[pos].budget_refused = true;
                    continue;
                }
                if s.book.consume(token, &j.binding)? != AuthorizationAction::SendAllowed {
                    return Err(SimulationError::Integrity(
                        "fixture client guard refused timely send",
                    ));
                }
                let mut r = Receipt::synthetic(
                    j.binding.agreement_id,
                    0,
                    j.binding.client,
                    j.binding.provider,
                    c.price,
                    tick,
                );
                r.availability_tick = if stress && scenario == AuthorizationScenario::ObservationLag
                {
                    tick + 6
                } else if stress && scenario == AuthorizationScenario::EvidenceAfterExpiry {
                    permit.observe_before + 1
                } else {
                    tick + j.intention.observation_delay
                };
                if !s.transfer(TransferKind::Payment, r)? {
                    return Err(SimulationError::Integrity(
                        "prechecked client budget changed",
                    ));
                }
                s.jobs[pos].sent = true;
                if stress
                    && scenario == AuthorizationScenario::DuplicateAuthorization
                    && s.book.consume(token, &j.binding)? != AuthorizationAction::AlreadyConsumed
                {
                    return Err(SimulationError::Integrity(
                        "duplicate authorization consumed twice",
                    ));
                }
            }
            let available: Vec<_> = s
                .pending
                .iter()
                .filter(|(_, r)| r.availability_tick == tick)
                .cloned()
                .collect();
            s.pending.retain(|(_, r)| r.availability_tick != tick);
            for (seq, r) in available {
                let kind = s.transfers[seq].kind;
                let pos = s
                    .jobs
                    .iter()
                    .position(|j| j.binding.agreement_id == r.agreement_id)
                    .expect("fixture job");
                let j = s.jobs[pos].clone();
                s.command(
                    tick,
                    match kind {
                        TransferKind::Payment => {
                            DirectCommand::PaymentReceipt { receipt: r.clone() }
                        }
                        TransferKind::VoluntaryReturn => {
                            DirectCommand::VoluntaryRefundReceipt { receipt: r.clone() }
                        }
                    },
                )?;
                let permit = s
                    .book
                    .permits
                    .iter()
                    .find(|p| Some(&p.token) == j.token.as_ref())
                    .expect("paid permit");
                let timely = kind == TransferKind::VoluntaryReturn
                    || (r.simulation_tick < permit.send_before
                        && r.availability_tick < permit.observe_before);
                s.observations.push(AuthorizationObservation {
                    sequence: s.observations.len() as u64,
                    transfer_sequence: seq as u64,
                    receipt: r,
                    recorded: true,
                    timely,
                });
                if kind == TransferKind::Payment && timely {
                    s.ready.insert(pos, (s.observations.len() - 1) as u64);
                }
                if kind == TransferKind::VoluntaryReturn
                    && s.direct
                        .agreement(j.binding.agreement_id)
                        .is_some_and(|a| a.net_transferred() == 0)
                {
                    s.book.release(j.token.as_deref().expect("return token"))?;
                }
            }
            let mut ready: Vec<_> = s.ready.iter().map(|(p, n)| (*p, *n)).collect();
            ready.sort_by_key(|(_, n)| *n);
            for (pos, _) in ready {
                let token = s.jobs[pos].token.as_deref().expect("ready token");
                if s.book.start(token)? {
                    s.jobs[pos].started_tick = Some(tick);
                    s.ready.remove(&pos);
                }
            }
            for provider in 0..c.agents as u64 / 2 {
                let occupied = s.book.occupied(provider);
                if occupied > c.provider_capacity {
                    return Err(SimulationError::Integrity(
                        "authorization work capacity exceeded",
                    ));
                }
                peak = peak.max(occupied as u64);
            }
            if s.balances.iter().sum::<u128>() != c.agents as u128 * c.starting_balance as u128 {
                return Err(SimulationError::Integrity(
                    "authorization wallet conservation failed",
                ));
            }
        }
        rounds.push(AuthorizationRound {
            round,
            phase: p,
            metrics: metrics(&s, c, Some(round), peak),
        });
    }
    if !s.pending.is_empty() || s.book.permits.iter().any(|p| p.holds_capacity) {
        return Err(SimulationError::Integrity(
            "unfinished authorization evidence or capacity",
        ));
    }
    s.direct.finish()?;
    Ok((s, rounds, plan))
}

bounded!(bounded_intentions, PaymentIntention, 2000);
bounded!(bounded_jobs, AuthorizedJob, 2000);
bounded!(bounded_permits, CapacityPermit, 8000);
bounded!(bounded_events, AuthorizationEvent, 200000);
bounded!(bounded_transfers, TransferFact, 4000);
bounded!(bounded_observations, AuthorizationObservation, 4000);
bounded!(bounded_balances, Balance, 64);
bounded!(bounded_rounds, AuthorizationRound, 24);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationRun {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub unit: String,
    pub rng: String,
    pub config: AuthorizationConfig,
    pub seed: u64,
    pub scenario: AuthorizationScenario,
    pub policy: AuthorizationPolicy,
    #[serde(deserialize_with = "bounded_intentions")]
    pub intentions: Vec<PaymentIntention>,
    pub intentions_fingerprint: String,
    #[serde(deserialize_with = "bounded_jobs")]
    pub jobs: Vec<AuthorizedJob>,
    #[serde(deserialize_with = "bounded_permits")]
    pub permits: Vec<CapacityPermit>,
    #[serde(deserialize_with = "bounded_events")]
    pub authorizations: Vec<AuthorizationEvent>,
    #[serde(deserialize_with = "bounded_transfers")]
    pub transfers: Vec<TransferFact>,
    #[serde(deserialize_with = "bounded_observations")]
    pub observations: Vec<AuthorizationObservation>,
    #[serde(deserialize_with = "bounded_balances")]
    pub final_balances: Vec<Balance>,
    #[serde(deserialize_with = "bounded_rounds")]
    pub rounds: Vec<AuthorizationRound>,
    pub metrics: AuthorizationMetrics,
    pub direct: DirectReport,
    pub fingerprint: String,
}
impl AuthorizationRun {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE014_AUTHORIZATION_RUN_V1\0",
            &(
                (
                    &self.schema_version,
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
                &self.jobs,
                &self.permits,
                &self.authorizations,
                &self.transfers,
                &self.observations,
                &self.final_balances,
                &self.rounds,
                &self.metrics,
                &self.direct,
            ),
        )
    }
    pub fn generate(
        config: AuthorizationConfig,
        seed: u64,
        scenario: AuthorizationScenario,
        policy: AuthorizationPolicy,
    ) -> Result<Self> {
        config.validate()?;
        if !config.seeds.contains(&seed) || !config.scenarios.contains(&scenario) {
            return Err(SimulationError::Configuration(
                "authorization run outside campaign",
            ));
        }
        let (s, rounds, intentions) = execute(&config, seed, scenario, policy)?;
        let peak = rounds
            .iter()
            .map(|r| r.metrics.counts.peak_provider_slots)
            .max()
            .unwrap_or(0);
        let metrics = metrics(&s, &config, None, peak);
        let direct = DirectReport::from_engine(&s.direct)?;
        if metrics.amounts.payments_sent != direct.metrics.payments_recorded
            || metrics.amounts.voluntary_returns_sent != direct.metrics.voluntary_refunds_recorded
        {
            return Err(SimulationError::Integrity(
                "authorization adapter totals disagree",
            ));
        }
        let intentions_fingerprint =
            fingerprint(b"ZOORA_AE014_AUTHORIZATION_INTENTIONS_V1\0", &intentions)?;
        let mut r = Self {
            schema_version: 1,
            model: "zoora-authorization-run/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            unit: "SIMULATED_UNITS".into(),
            rng: RNG_ALGORITHM.into(),
            config,
            seed,
            scenario,
            policy,
            intentions,
            intentions_fingerprint,
            jobs: s.jobs,
            permits: s.book.permits,
            authorizations: s.book.events,
            transfers: s.transfers,
            observations: s.observations,
            final_balances: s
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
        r.fingerprint = r.hash()?;
        Ok(r)
    }
    pub fn verify(&self) -> Result<()> {
        self.config.validate()?;
        if self.hash()? != self.fingerprint
            || Self::generate(self.config.clone(), self.seed, self.scenario, self.policy)? != *self
        {
            return Err(SimulationError::Replay(
                "authorization run regeneration differs",
            ));
        }
        self.direct.verify()?;
        Ok(())
    }
}
bounded!(bounded_sample_events, AuthorizationEvent, 12);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationRow {
    pub seed: u64,
    pub scenario: AuthorizationScenario,
    pub policy: AuthorizationPolicy,
    pub intentions_fingerprint: String,
    pub run_fingerprint: String,
    pub metrics: AuthorizationMetrics,
    #[serde(deserialize_with = "bounded_rounds")]
    pub rounds: Vec<AuthorizationRound>,
    #[serde(deserialize_with = "bounded_sample_events")]
    pub sampled_authorizations: Vec<AuthorizationEvent>,
}
impl AuthorizationRow {
    pub fn from_run(r: AuthorizationRun) -> Self {
        let sampled_authorizations = r
            .authorizations
            .iter()
            .filter(|e| phase((e.agreement_id / 2048) as usize, r.config.rounds) == Phase::Stress)
            .take(12)
            .cloned()
            .collect();
        Self {
            seed: r.seed,
            scenario: r.scenario,
            policy: r.policy,
            intentions_fingerprint: r.intentions_fingerprint,
            run_fingerprint: r.fingerprint,
            metrics: r.metrics,
            rounds: r.rounds,
            sampled_authorizations,
        }
    }
}
bounded!(bounded_rows, AuthorizationRow, 384);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationCampaign {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub unit: String,
    pub rng: String,
    pub config: AuthorizationConfig,
    #[serde(deserialize_with = "bounded_rows")]
    pub runs: Vec<AuthorizationRow>,
    pub fingerprint: String,
}
impl AuthorizationCampaign {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE014_AUTHORIZATION_CAMPAIGN_V1\0",
            &(
                &self.schema_version,
                &self.model,
                &self.classification,
                &self.unit,
                &self.rng,
                &self.config,
                &self.runs,
            ),
        )
    }
    pub fn generate(config: AuthorizationConfig) -> Result<Self> {
        config.validate()?;
        let mut runs = vec![];
        for seed in &config.seeds {
            for scenario in &config.scenarios {
                for policy in AuthorizationPolicy::ALL {
                    runs.push(AuthorizationRow::from_run(AuthorizationRun::generate(
                        config.clone(),
                        *seed,
                        *scenario,
                        policy,
                    )?));
                }
            }
        }
        let mut r = Self {
            schema_version: 1,
            model: "zoora-authorization-campaign/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            unit: "SIMULATED_UNITS".into(),
            rng: RNG_ALGORITHM.into(),
            config,
            runs,
            fingerprint: String::new(),
        };
        r.fingerprint = r.hash()?;
        Ok(r)
    }
    pub fn verify(&self) -> Result<()> {
        self.config.validate()?;
        if self.hash()? != self.fingerprint || Self::generate(self.config.clone())? != *self {
            return Err(SimulationError::Replay(
                "authorization campaign regeneration differs",
            ));
        }
        Ok(())
    }
}
