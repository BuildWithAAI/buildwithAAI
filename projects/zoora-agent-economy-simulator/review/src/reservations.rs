//! AE-015: bounded wallet/provider reservation controls over the shared work engine.
//! Wallet IDs and permit hashes are fixtures, never ownership or Sybil proof.
use crate::{
    allocation::fingerprint,
    authorization::{
        controlled_transcript, AuthorizationAction, AuthorizationConfig, AuthorizationMetrics,
        AuthorizationScenario, CapacityPermit, FixtureOptions, GrantControl, PaymentBinding,
        WorkTranscript,
    },
    economy::Phase,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use zoora_agent_economy_simulator::{SimulationError, RNG_ALGORITHM};
type Result<T> = std::result::Result<T, SimulationError>;
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
pub enum ReservationScenario {
    NormalDelay,
    ConcentratedUnpaid,
    RotatingUnpaid,
    SlowPayer,
    ObservationLag,
    PaidFlood,
    EvidenceAfterExpiry,
    ProviderOutage,
}
impl ReservationScenario {
    pub const ALL: [Self; 8] = [
        Self::NormalDelay,
        Self::ConcentratedUnpaid,
        Self::RotatingUnpaid,
        Self::SlowPayer,
        Self::ObservationLag,
        Self::PaidFlood,
        Self::EvidenceAfterExpiry,
        Self::ProviderOutage,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::NormalDelay => "NORMAL_DELAY",
            Self::ConcentratedUnpaid => "CONCENTRATED_UNPAID",
            Self::RotatingUnpaid => "ROTATING_UNPAID",
            Self::SlowPayer => "SLOW_PAYER",
            Self::ObservationLag => "OBSERVATION_LAG",
            Self::PaidFlood => "PAID_FLOOD",
            Self::EvidenceAfterExpiry => "EVIDENCE_AFTER_EXPIRY",
            Self::ProviderOutage => "PROVIDER_OUTAGE",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|x| x.label() == s)
    }
    pub fn base(self) -> AuthorizationScenario {
        match self {
            Self::ConcentratedUnpaid | Self::RotatingUnpaid => {
                AuthorizationScenario::RenewingUnpaid
            }
            Self::ObservationLag => AuthorizationScenario::ObservationLag,
            Self::PaidFlood => AuthorizationScenario::PaidFlood,
            Self::EvidenceAfterExpiry => AuthorizationScenario::EvidenceAfterExpiry,
            Self::ProviderOutage => AuthorizationScenario::ProviderOutage,
            _ => AuthorizationScenario::NormalDelay,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReservationPolicy {
    EvidenceHold,
    PendingQuota,
    QuotaCooldown,
}
impl ReservationPolicy {
    pub const ALL: [Self; 3] = [Self::EvidenceHold, Self::PendingQuota, Self::QuotaCooldown];
    pub fn label(self) -> &'static str {
        match self {
            Self::EvidenceHold => "EVIDENCE_HOLD",
            Self::PendingQuota => "PENDING_QUOTA",
            Self::QuotaCooldown => "QUOTA_COOLDOWN",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|x| x.label() == s)
    }
}
bounded!(bounded_scenarios, ReservationScenario, 8);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReservationConfig {
    pub cooldown_ticks: u64,
    #[serde(deserialize_with = "bounded_scenarios")]
    pub scenarios: Vec<ReservationScenario>,
    pub authorization: AuthorizationConfig,
}
impl ReservationConfig {
    pub fn validate(&self) -> Result<()> {
        self.authorization.validate()?;
        if !(1..=16).contains(&self.cooldown_ticks)
            || self.scenarios.is_empty()
            || self.scenarios.len() > 8
            || self.scenarios.iter().collect::<BTreeSet<_>>().len() != self.scenarios.len()
            || self
                .scenarios
                .iter()
                .any(|s| !self.authorization.scenarios.contains(&s.base()))
        {
            return Err(SimulationError::Configuration(
                "invalid bounded reservation configuration",
            ));
        }
        Ok(())
    }
    pub fn from_toml(s: &str) -> Result<Self> {
        let c: Self = toml::from_str(s)
            .map_err(|_| SimulationError::Configuration("invalid reservation TOML"))?;
        c.validate()?;
        Ok(c)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ControlReason {
    Eligible,
    PendingQuota,
    ExpiryCooldown,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlDecision {
    pub sequence: u64,
    pub tick: u64,
    pub binding: PaymentBinding,
    pub reason: ControlReason,
    pub blocking_token: Option<String>,
    pub blocked_until: Option<u64>,
}
pub struct ReservationControl {
    policy: ReservationPolicy,
    cooldown: u64,
    decisions: Vec<ControlDecision>,
}
impl ReservationControl {
    pub fn new(policy: ReservationPolicy, cooldown: u64) -> Result<Self> {
        if !(1..=16).contains(&cooldown) {
            return Err(SimulationError::Configuration(
                "invalid reservation cooldown",
            ));
        }
        Ok(Self {
            policy,
            cooldown,
            decisions: vec![],
        })
    }
    pub fn decisions(&self) -> &[ControlDecision] {
        &self.decisions
    }
    pub fn evaluate(
        &mut self,
        tick: u64,
        binding: &PaymentBinding,
        permits: &[CapacityPermit],
    ) -> Result<ControlReason> {
        if self.decisions.len() >= 200_000 {
            return Err(SimulationError::Configuration(
                "reservation decision budget exceeded",
            ));
        }
        let relevant = || {
            permits.iter().filter(|p| {
                p.binding.client == binding.client && p.binding.provider == binding.provider
            })
        };
        let pending = if self.policy == ReservationPolicy::EvidenceHold {
            None
        } else {
            relevant().find(|p| p.holds_capacity && p.consumed_tick.is_none())
        };
        let expired = if self.policy != ReservationPolicy::QuotaCooldown {
            None
        } else {
            relevant()
                .filter(|p| {
                    p.expired
                        && p.consumed_tick.is_none()
                        && tick < p.observe_before.saturating_add(self.cooldown)
                })
                .max_by_key(|p| (p.observe_before, p.ordinal))
        };
        let (reason, blocking_token, blocked_until) = if let Some(p) = pending {
            (ControlReason::PendingQuota, Some(p.token.clone()), None)
        } else if let Some(p) = expired {
            (
                ControlReason::ExpiryCooldown,
                Some(p.token.clone()),
                Some(p.observe_before.saturating_add(self.cooldown)),
            )
        } else {
            (ControlReason::Eligible, None, None)
        };
        self.decisions.push(ControlDecision {
            sequence: self.decisions.len() as u64,
            tick,
            binding: binding.clone(),
            reason,
            blocking_token,
            blocked_until,
        });
        Ok(reason)
    }
}
impl GrantControl for ReservationControl {
    fn allow(
        &mut self,
        tick: u64,
        binding: &PaymentBinding,
        permits: &[CapacityPermit],
    ) -> Result<bool> {
        Ok(self.evaluate(tick, binding, permits)? == ControlReason::Eligible)
    }
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlMetrics {
    pub attempts: u64,
    pub eligible_attempts: u64,
    pub quota_refusals: u64,
    pub cooldown_refusals: u64,
    pub unused_authorization_expiries: u64,
    pub paid_authorization_expiries: u64,
    pub expired_client_send_attempts: u64,
    pub peak_pending_wallet_provider: u64,
    pub ordinary_wallets_with_demand: u64,
    pub ordinary_wallets_acknowledged: u64,
    pub minimum_acknowledged_per_demanded_wallet: u64,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WalletOutcome {
    pub wallet: u64,
    pub intended: u64,
    pub paid: u64,
    pub started: u64,
    pub acknowledged: u64,
}
fn summarize(
    work: &WorkTranscript,
    decisions: &[ControlDecision],
) -> (ControlMetrics, Vec<WalletOutcome>) {
    let mut m = ControlMetrics {
        attempts: decisions.len() as u64,
        ..ControlMetrics::default()
    };
    for d in decisions {
        match d.reason {
            ControlReason::Eligible => m.eligible_attempts += 1,
            ControlReason::PendingQuota => m.quota_refusals += 1,
            ControlReason::ExpiryCooldown => m.cooldown_refusals += 1,
        }
    }
    let permits: BTreeMap<_, _> = work.permits.iter().map(|p| (&p.token, p)).collect();
    let mut pending = BTreeMap::<(u64, u64), BTreeSet<String>>::new();
    for e in &work.authorizations {
        let Some(token) = e.token.as_ref() else {
            continue;
        };
        let p = permits[token];
        let key = (p.binding.client, p.binding.provider);
        match e.action {
            AuthorizationAction::Granted => {
                pending.entry(key).or_default().insert(token.clone());
            }
            AuthorizationAction::SendAllowed | AuthorizationAction::HoldExpired => {
                pending.entry(key).or_default().remove(token);
            }
            AuthorizationAction::AuthorizationExpired => {
                if p.consumed_tick.is_some() {
                    m.paid_authorization_expiries += 1;
                } else {
                    m.unused_authorization_expiries += 1;
                }
            }
            AuthorizationAction::SendExpired => m.expired_client_send_attempts += 1,
            _ => {}
        }
        m.peak_pending_wallet_provider = m
            .peak_pending_wallet_provider
            .max(pending.get(&key).map_or(0, |s| s.len() as u64));
    }
    let mut wallets = BTreeMap::<u64, WalletOutcome>::new();
    for j in work.jobs.iter().filter(|j| !j.intention.attack_fixture) {
        let w = wallets
            .entry(j.binding.client)
            .or_insert_with(|| WalletOutcome {
                wallet: j.binding.client,
                ..WalletOutcome::default()
            });
        w.intended += 1;
        w.paid += u64::from(j.sent);
        w.started += u64::from(j.started_tick.is_some());
        w.acknowledged += u64::from(j.acknowledged);
    }
    m.ordinary_wallets_with_demand = wallets.len() as u64;
    m.ordinary_wallets_acknowledged =
        wallets.values().filter(|w| w.acknowledged > 0).count() as u64;
    m.minimum_acknowledged_per_demanded_wallet =
        wallets.values().map(|w| w.acknowledged).min().unwrap_or(0);
    (m, wallets.into_values().collect())
}
bounded!(bounded_decisions, ControlDecision, 200000);
bounded!(bounded_wallets, WalletOutcome, 64);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReservationRun {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub unit: String,
    pub rng: String,
    pub config: ReservationConfig,
    pub seed: u64,
    pub scenario: ReservationScenario,
    pub policy: ReservationPolicy,
    pub intentions_fingerprint: String,
    pub work: WorkTranscript,
    #[serde(deserialize_with = "bounded_decisions")]
    pub decisions: Vec<ControlDecision>,
    pub controls: ControlMetrics,
    #[serde(deserialize_with = "bounded_wallets")]
    pub wallets: Vec<WalletOutcome>,
    pub fingerprint: String,
}
impl ReservationRun {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE015_RESERVATION_RUN_V1\0",
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
                &self.intentions_fingerprint,
                &self.work,
                &self.decisions,
                &self.controls,
                &self.wallets,
            ),
        )
    }
    pub fn generate(
        config: ReservationConfig,
        seed: u64,
        scenario: ReservationScenario,
        policy: ReservationPolicy,
    ) -> Result<Self> {
        config.validate()?;
        if !config.scenarios.contains(&scenario) || !config.authorization.seeds.contains(&seed) {
            return Err(SimulationError::Configuration(
                "reservation run outside campaign",
            ));
        }
        let mut control = ReservationControl::new(policy, config.cooldown_ticks)?;
        let work = controlled_transcript(
            &config.authorization,
            seed,
            scenario.base(),
            &mut control,
            FixtureOptions {
                concentrate_attack_wallet: scenario == ReservationScenario::ConcentratedUnpaid,
                slow_first_send: scenario == ReservationScenario::SlowPayer,
            },
        )?;
        let intentions_fingerprint =
            fingerprint(b"ZOORA_AE015_RESERVATION_INTENTIONS_V1\0", &work.intentions)?;
        let (controls, wallets) = summarize(&work, &control.decisions);
        let mut r = Self {
            schema_version: 1,
            model: "zoora-reservation-run/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            unit: "SIMULATED_UNITS".into(),
            rng: RNG_ALGORITHM.into(),
            config,
            seed,
            scenario,
            policy,
            intentions_fingerprint,
            work,
            decisions: control.decisions,
            controls,
            wallets,
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
                "reservation run regeneration differs",
            ));
        }
        self.work.direct.verify()?;
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReservationRound {
    pub round: usize,
    pub phase: Phase,
    pub work: AuthorizationMetrics,
    pub attempts: u64,
    pub quota_refusals: u64,
    pub cooldown_refusals: u64,
}
bounded!(bounded_rounds, ReservationRound, 24);
bounded!(bounded_samples, ControlDecision, 12);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReservationRow {
    pub seed: u64,
    pub scenario: ReservationScenario,
    pub policy: ReservationPolicy,
    pub intentions_fingerprint: String,
    pub run_fingerprint: String,
    pub metrics: AuthorizationMetrics,
    pub controls: ControlMetrics,
    #[serde(deserialize_with = "bounded_wallets")]
    pub wallets: Vec<WalletOutcome>,
    #[serde(deserialize_with = "bounded_rounds")]
    pub rounds: Vec<ReservationRound>,
    #[serde(deserialize_with = "bounded_samples")]
    pub sampled_decisions: Vec<ControlDecision>,
}
impl ReservationRow {
    pub fn from_run(r: ReservationRun) -> Self {
        let rounds = r
            .work
            .rounds
            .iter()
            .map(|round| {
                let list: Vec<_> = r
                    .decisions
                    .iter()
                    .filter(|d| d.binding.agreement_id / 2048 == round.round as u64)
                    .collect();
                ReservationRound {
                    round: round.round,
                    phase: round.phase,
                    work: round.metrics.clone(),
                    attempts: list.len() as u64,
                    quota_refusals: list
                        .iter()
                        .filter(|d| d.reason == ControlReason::PendingQuota)
                        .count() as u64,
                    cooldown_refusals: list
                        .iter()
                        .filter(|d| d.reason == ControlReason::ExpiryCooldown)
                        .count() as u64,
                }
            })
            .collect();
        let sampled_decisions = r
            .decisions
            .iter()
            .filter(|d| {
                let round = (d.binding.agreement_id / 2048) as usize;
                round >= r.config.authorization.rounds / 3
                    && round < r.config.authorization.rounds * 2 / 3
            })
            .take(12)
            .cloned()
            .collect();
        Self {
            seed: r.seed,
            scenario: r.scenario,
            policy: r.policy,
            intentions_fingerprint: r.intentions_fingerprint,
            run_fingerprint: r.fingerprint,
            metrics: r.work.metrics,
            controls: r.controls,
            wallets: r.wallets,
            rounds,
            sampled_decisions,
        }
    }
}
bounded!(bounded_rows, ReservationRow, 384);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReservationCampaign {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub unit: String,
    pub rng: String,
    pub config: ReservationConfig,
    #[serde(deserialize_with = "bounded_rows")]
    pub runs: Vec<ReservationRow>,
    pub fingerprint: String,
}
impl ReservationCampaign {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE015_RESERVATION_CAMPAIGN_V1\0",
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
    pub fn generate(config: ReservationConfig) -> Result<Self> {
        config.validate()?;
        let mut runs = vec![];
        for seed in &config.authorization.seeds {
            for scenario in &config.scenarios {
                for policy in ReservationPolicy::ALL {
                    runs.push(ReservationRow::from_run(ReservationRun::generate(
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
            model: "zoora-reservation-campaign/0.1.0".into(),
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
                "reservation campaign regeneration differs",
            ));
        }
        Ok(())
    }
}
