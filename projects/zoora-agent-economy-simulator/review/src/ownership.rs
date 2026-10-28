//! AE-018: declared-operator capacity and full-notional exposure admission.
//! Only new commitments are gated. Valid incoming receipt facts are forwarded.
use crate::{allocation::fingerprint, recovery::*, trust::*};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use zoora_agent_economy_simulator::SimulationError;
use zoora_task_market::metrics::decimal;
type Result<T> = std::result::Result<T, SimulationError>;
pub const MAX_OWNER_ACTIONS: usize = MAX_ACTIONS / 2;
macro_rules! bounded {
    ($name:ident,$typ:ty,$max:expr) => {
        fn $name<'de, D: serde::de::Deserializer<'de>>(
            d: D,
        ) -> std::result::Result<Vec<$typ>, D::Error> {
            crate::bounded::vec::<D, $typ, $max>(d)
        }
    };
}
bounded!(actions, RecoveryAction, MAX_OWNER_ACTIONS);
bounded!(journal, OwnerRecord, MAX_OWNER_ACTIONS);
bounded!(owners, OwnerState, 64);
bounded!(agents, u64, 64);
bounded!(agreements, u64, MAX_CONTRACTS);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerConfig {
    pub payment_caps: [u64; 3],
    pub recovery: RecoveryConfig,
}
impl OwnerConfig {
    pub fn validate(&self) -> Result<()> {
        self.recovery.validate()?;
        if self.payment_caps[0] == 0 || self.payment_caps.windows(2).any(|w| w[0] > w[1]) {
            return Err(SimulationError::Configuration("invalid owner payment caps"));
        }
        Ok(())
    }
    pub fn from_toml(text: &str) -> Result<Self> {
        let c: Self = toml::from_str(text)
            .map_err(|_| SimulationError::Configuration("invalid owner TOML"))?;
        c.validate()?;
        Ok(c)
    }
    fn operator(&self, agent: u64) -> Option<u64> {
        usize::try_from(agent)
            .ok()
            .and_then(|i| self.recovery.trust.operators.get(i))
            .copied()
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OwnerPolicy {
    AgentOnly,
    OwnerCount,
    OwnerRisk,
}
pub const POLICIES: [OwnerPolicy; 3] = [
    OwnerPolicy::AgentOnly,
    OwnerPolicy::OwnerCount,
    OwnerPolicy::OwnerRisk,
];
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerState {
    pub operator: u64,
    #[serde(deserialize_with = "agents")]
    pub agents: Vec<u64>,
    pub tier: u8,
    pub limit_source_agent: u64,
    pub work_limit: usize,
    pub payment_limit: u64,
    #[serde(deserialize_with = "agreements")]
    pub active_agreements: Vec<u64>,
    #[serde(with = "decimal")]
    pub reserved_payment_units: u128,
    #[serde(with = "decimal")]
    pub active_assigned_net_units: u128,
    #[serde(with = "decimal")]
    pub active_lead_net_units: u128,
    pub dispute_hold: bool,
    pub over_work_limit: bool,
    pub over_payment_limit: bool,
}
fn states(
    config: &OwnerConfig,
    profiles: &[TrustProfile],
    work: &[WorkExposure],
) -> Result<Vec<OwnerState>> {
    if profiles.len() != config.recovery.trust.operators.len() {
        return Err(SimulationError::Integrity("owner profile count differs"));
    }
    let mut map = BTreeMap::<u64, OwnerState>::new();
    for p in profiles {
        let op = config
            .operator(p.agent)
            .ok_or(SimulationError::Integrity("owner profile identity differs"))?;
        let o = map.entry(op).or_insert_with(|| OwnerState {
            operator: op,
            agents: vec![],
            tier: p.tier,
            limit_source_agent: p.agent,
            work_limit: p.limits.work,
            payment_limit: config.payment_caps[p.tier as usize],
            active_agreements: vec![],
            reserved_payment_units: 0,
            active_assigned_net_units: 0,
            active_lead_net_units: 0,
            dispute_hold: false,
            over_work_limit: false,
            over_payment_limit: false,
        });
        o.agents.push(p.agent);
        if p.tier > o.tier {
            o.tier = p.tier;
            o.limit_source_agent = p.agent;
            o.work_limit = p.limits.work;
            o.payment_limit = config.payment_caps[p.tier as usize];
        }
        o.dispute_hold |= p.dispute_hold;
    }
    for w in work.iter().filter(|w| w.active) {
        let ops: BTreeSet<_> = w
            .workers
            .iter()
            .filter_map(|a| config.operator(*a))
            .collect();
        for op in ops {
            let o = map
                .get_mut(&op)
                .ok_or(SimulationError::Integrity("worker owner missing"))?;
            o.active_agreements.push(w.id);
            o.reserved_payment_units = o
                .reserved_payment_units
                .checked_add(u128::from(w.payment_units))
                .ok_or(SimulationError::Integrity("owner reserve overflow"))?;
            o.active_assigned_net_units =
                o.active_assigned_net_units.checked_add(w.net_paid).ok_or(
                    SimulationError::Integrity("owner assigned exposure overflow"),
                )?;
            if config.operator(w.lead) == Some(op) {
                o.active_lead_net_units = o
                    .active_lead_net_units
                    .checked_add(w.net_paid)
                    .ok_or(SimulationError::Integrity("owner lead exposure overflow"))?;
            }
        }
    }
    for o in map.values_mut() {
        o.over_work_limit = o.active_agreements.len() > o.work_limit;
        o.over_payment_limit = o.reserved_payment_units > u128::from(o.payment_limit);
    }
    Ok(map.into_values().collect())
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OwnerRejection {
    OwnerHold,
    OwnerWorkLimit,
    OwnerPaymentLimit,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum OwnerOutcome {
    Forwarded {
        outcome: RecoveryOutcome,
    },
    Refused {
        operator: u64,
        reason: OwnerRejection,
    },
}
fn gate(
    config: &OwnerConfig,
    policy: OwnerPolicy,
    action: &RecoveryAction,
    owners: &[OwnerState],
) -> Option<(u64, OwnerRejection)> {
    if policy == OwnerPolicy::AgentOnly {
        return None;
    }
    let RecoveryCommand::Trust {
        actor: TrustActor::Agent { agent },
        command,
    } = &action.command
    else {
        return None;
    };
    let owner = |op| owners.iter().find(|o| o.operator == op);
    match command {
        TrustCommand::OpenContract { plan } if *agent == plan.lead => {
            let mut ops = BTreeSet::new();
            for s in &plan.shares {
                ops.insert(config.operator(s.agent)?);
            }
            for op in ops {
                let o = owner(op)?;
                if policy == OwnerPolicy::OwnerRisk && o.dispute_hold {
                    return Some((op, OwnerRejection::OwnerHold));
                }
                if o.active_agreements.len() >= o.work_limit {
                    return Some((op, OwnerRejection::OwnerWorkLimit));
                }
                if policy == OwnerPolicy::OwnerRisk
                    && o.reserved_payment_units + u128::from(plan.payment_units)
                        > u128::from(o.payment_limit)
                {
                    return Some((op, OwnerRejection::OwnerPaymentLimit));
                }
            }
        }
        TrustCommand::CreateGroup { .. } | TrustCommand::JoinGroup { .. }
            if policy == OwnerPolicy::OwnerRisk =>
        {
            let op = config.operator(*agent)?;
            let o = owner(op)?;
            if o.dispute_hold || o.over_work_limit || o.over_payment_limit {
                return Some((op, OwnerRejection::OwnerHold));
            }
        }
        _ => {}
    }
    None
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerInput {
    pub config: OwnerConfig,
    pub policy: OwnerPolicy,
    #[serde(deserialize_with = "actions")]
    pub actions: Vec<RecoveryAction>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerRecord {
    pub sequence: usize,
    pub action: RecoveryAction,
    pub advance_sequence: usize,
    pub delegated_sequence: Option<usize>,
    pub outcome: OwnerOutcome,
    #[serde(deserialize_with = "owners")]
    pub owners_after: Vec<OwnerState>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerMetrics {
    pub owner_rejections: usize,
    pub delegated_rejections: usize,
    pub agreements_opened: usize,
    #[serde(with = "decimal")]
    pub payments_recorded: u128,
    #[serde(with = "decimal")]
    pub voluntary_returns_recorded: u128,
    #[serde(with = "decimal")]
    pub net_transferred: u128,
}
pub struct OwnerEngine {
    config: OwnerConfig,
    policy: OwnerPolicy,
    recovery: RecoveryEngine,
    actions: Vec<RecoveryAction>,
    journal: Vec<OwnerRecord>,
    inner_count: usize,
    clock: u64,
}
impl OwnerEngine {
    pub fn new(config: OwnerConfig, policy: OwnerPolicy) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            recovery: RecoveryEngine::new(config.recovery.clone())?,
            config,
            policy,
            actions: vec![],
            journal: vec![],
            inner_count: 0,
            clock: 0,
        })
    }
    pub fn case(&self, id: u64) -> Option<&ReviewCase> {
        self.recovery.case(id)
    }
    pub fn binding(&self, id: u64) -> Result<String> {
        self.recovery.binding(id)
    }
    pub fn owners(&self) -> Result<Vec<OwnerState>> {
        states(
            &self.config,
            &self.recovery.profiles()?,
            &self.recovery.work_exposures(),
        )
    }
    pub fn record(&mut self, action: RecoveryAction) -> Result<OwnerOutcome> {
        if self.actions.len() >= MAX_OWNER_ACTIONS
            || action.tick < self.clock
            || action.tick >= self.config.recovery.trust.ticks - 1
            || serde_json::to_vec(&action)
                .map_err(|_| SimulationError::Configuration("owner action encoding"))?
                .len()
                > 16384
        {
            return Err(SimulationError::Capacity(
                "owner time or action bound exceeded",
            ));
        }
        self.clock = action.tick;
        let advance_sequence = self.inner_count;
        self.recovery.record(RecoveryAction {
            tick: self.clock,
            command: RecoveryCommand::Advance {},
        })?;
        self.inner_count += 1;
        let decision = gate(&self.config, self.policy, &action, &self.owners()?);
        let (delegated_sequence, outcome) = if let Some((operator, reason)) = decision {
            (None, OwnerOutcome::Refused { operator, reason })
        } else {
            let seq = self.inner_count;
            let outcome = self.recovery.record(action.clone())?;
            self.inner_count += 1;
            (Some(seq), OwnerOutcome::Forwarded { outcome })
        };
        self.journal.push(OwnerRecord {
            sequence: self.journal.len(),
            action: action.clone(),
            advance_sequence,
            delegated_sequence,
            outcome,
            owners_after: self.owners()?,
        });
        self.actions.push(action);
        Ok(outcome)
    }
    pub fn finish(self) -> Result<OwnerReport> {
        let (recovery, work) = self.recovery.finish_with_work()?;
        let owners = states(&self.config, &recovery.trust.profiles, &work)?;
        let m = &recovery.trust.direct.metrics;
        let metrics = OwnerMetrics {
            owner_rejections: self
                .journal
                .iter()
                .filter(|r| matches!(r.outcome, OwnerOutcome::Refused { .. }))
                .count(),
            delegated_rejections: self
                .journal
                .iter()
                .filter(|r| {
                    matches!(
                        r.outcome,
                        OwnerOutcome::Forwarded {
                            outcome: RecoveryOutcome::Rejected { .. }
                                | RecoveryOutcome::Trust {
                                    outcome: TrustOutcome::Rejected { .. }
                                }
                        }
                    )
                })
                .count(),
            agreements_opened: recovery.trust.contracts.len(),
            payments_recorded: m.payments_recorded,
            voluntary_returns_recorded: m.voluntary_refunds_recorded,
            net_transferred: m.net_transferred,
        };
        let mut r = OwnerReport {
            schema_version: 1,
            model: "zoora-owner-risk-run/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            input: OwnerInput {
                config: self.config,
                policy: self.policy,
                actions: self.actions,
            },
            journal: self.journal,
            owners,
            metrics,
            recovery,
            fingerprint: String::new(),
        };
        r.fingerprint = r.hash()?;
        Ok(r)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerReport {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub input: OwnerInput,
    #[serde(deserialize_with = "journal")]
    pub journal: Vec<OwnerRecord>,
    #[serde(deserialize_with = "owners")]
    pub owners: Vec<OwnerState>,
    pub metrics: OwnerMetrics,
    pub recovery: RecoveryReport,
    pub fingerprint: String,
}
impl OwnerReport {
    pub fn generate(input: OwnerInput) -> Result<Self> {
        if input.actions.len() > MAX_OWNER_ACTIONS {
            return Err(SimulationError::Capacity("owner action budget exceeded"));
        }
        let mut e = OwnerEngine::new(input.config, input.policy)?;
        for a in input.actions {
            e.record(a)?;
        }
        e.finish()
    }
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE018_OWNER_RUN_V1\0",
            &(
                self.schema_version,
                &self.model,
                &self.classification,
                &self.input,
                &self.journal,
                &self.owners,
                &self.metrics,
                &self.recovery,
            ),
        )
    }
    pub fn verify(&self) -> Result<()> {
        if self.fingerprint != self.hash()? || *self != Self::generate(self.input.clone())? {
            return Err(SimulationError::Replay(
                "owner admission, exposure or history differs",
            ));
        }
        self.recovery.verify()
    }
}
