//! AE-016 offline admission and work-credit adapter. Actors, reviews, operator
//! labels and receipt sources are declared fixtures, never authentication.
use crate::{
    allocation::fingerprint,
    direct::{
        Agreement, DirectCommand, DirectConfig, DirectEngine, DirectOutcome, DirectReport, Terms,
    },
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use zoora_agent_economy_simulator::SimulationError;
use zoora_task_market::types::valid_digest;
type Result<T> = std::result::Result<T, SimulationError>;
pub const MAX_ACTIONS: usize = 4096;
pub const MAX_CONTRACTS: usize = 512;
pub const CREDIT_SCALE: u64 = 10_000;
macro_rules! bounded {
    ($name:ident,$typ:ty,$max:expr) => {
        fn $name<'de, D: serde::de::Deserializer<'de>>(
            d: D,
        ) -> std::result::Result<Vec<$typ>, D::Error> {
            crate::bounded::vec::<D, $typ, $max>(d)
        }
    };
}
bounded!(operators, u64, 64);
bounded!(shares, WorkShare, 16);
bounded!(actions, TrustAction, MAX_ACTIONS);
bounded!(records, TrustRecord, MAX_ACTIONS);
bounded!(profiles, TrustProfile, 64);
bounded!(contracts, WorkContract, MAX_CONTRACTS);
bounded!(groups, Group, 128);
bounded!(projects, Project, 128);
bounded!(members, u64, 64);
bounded!(artifacts, Contribution, 16);
bounded!(credits, CreditShare, 16);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustConfig {
    #[serde(deserialize_with = "operators")]
    pub operators: Vec<u64>,
    pub reviewer_operator: u64,
    pub ticks: u64,
    pub maturity_ticks: u64,
    pub minimum_age_ticks: u64,
    pub minimum_customer_operators: usize,
    pub tier_one_credits: u64,
    pub tier_two_credits: u64,
}
impl TrustConfig {
    pub fn validate(&self) -> Result<()> {
        if !(8..=64).contains(&self.operators.len())
            || self
                .operators
                .iter()
                .any(|x| *x > 1_000_000 || *x == self.reviewer_operator)
            || self.reviewer_operator > 1_000_000
            || !(100..=10_000).contains(&self.ticks)
            || !(1..=100).contains(&self.maturity_ticks)
            || !(1..=1000).contains(&self.minimum_age_ticks)
            || self.minimum_age_ticks >= self.ticks
            || self.maturity_ticks >= self.ticks
            || !(2..=8).contains(&self.minimum_customer_operators)
            || !(1..=1_000_000).contains(&self.tier_one_credits)
            || self.tier_two_credits <= self.tier_one_credits
            || self.tier_two_credits > 1_000_000
        {
            return Err(SimulationError::Configuration(
                "invalid bounded trust configuration",
            ));
        }
        Ok(())
    }
    pub fn from_toml(text: &str) -> Result<Self> {
        let c: Self = toml::from_str(text)
            .map_err(|_| SimulationError::Configuration("invalid trust TOML"))?;
        c.validate()?;
        Ok(c)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum TrustActor {
    Agent { agent: u64 },
    ReviewFixture {},
    ReceiptFixture {},
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GroupKind {
    Development,
    CommunityFunded,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub id: u64,
    pub kind: GroupKind,
    #[serde(deserialize_with = "members")]
    pub members: Vec<u64>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: u64,
    pub work_budget: u64,
    pub issued_units: u64,
    pub scope_digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkShare {
    pub agent: u64,
    pub basis_points: u32,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractPlan {
    pub id: u64,
    pub project: u64,
    pub client: u64,
    pub lead: u64,
    pub group: Option<u64>,
    pub payment_units: u64,
    pub work_units: u64,
    pub deadline: u64,
    pub criteria_digest: String,
    #[serde(deserialize_with = "shares")]
    pub shares: Vec<WorkShare>,
}
impl ContractPlan {
    pub fn digest(&self) -> Result<String> {
        fingerprint(b"ZOORA_AE016_CONSENT_V1\0", self)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contribution {
    pub agent: u64,
    pub artifact_digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreditShare {
    pub agent: u64,
    pub allocated_microunits: u64,
    pub earned_microunits: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkContract {
    pub plan: ContractPlan,
    #[serde(deserialize_with = "artifacts")]
    pub contributions: Vec<Contribution>,
    pub accepted_tick: Option<u64>,
    pub reviewed_tick: Option<u64>,
    pub review_digest: Option<String>,
    #[serde(deserialize_with = "credits")]
    pub credit_shares: Vec<CreditShare>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum TrustCommand {
    ReviewAgent {
        agent: u64,
        approved: bool,
        evidence_digest: String,
    },
    CreateGroup {
        id: u64,
        kind: GroupKind,
    },
    JoinGroup {
        id: u64,
    },
    LeaveGroup {
        id: u64,
    },
    DefineProject {
        id: u64,
        work_budget: u64,
        scope_digest: String,
    },
    Consent {
        plan_digest: String,
    },
    OpenContract {
        plan: ContractPlan,
    },
    Contribute {
        contract_id: u64,
        artifact_digest: String,
    },
    Direct {
        command: DirectCommand,
    },
    ConfirmWork {
        contract_id: u64,
        review_digest: String,
    },
    Advance {},
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustAction {
    pub tick: u64,
    pub actor: TrustActor,
    pub command: TrustCommand,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustInput {
    pub config: TrustConfig,
    #[serde(deserialize_with = "actions")]
    pub actions: Vec<TrustAction>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrustRejection {
    WrongActor,
    InvalidEvidence,
    InvalidTerms,
    UnknownRecord,
    DuplicateRecord,
    WorkLimit,
    MembershipLimit,
    DisputeHold,
    MissingConsent,
    ProjectBudget,
    NotMember,
    ActiveGroupWork,
    WrongState,
    TooEarly,
    CustomerNotReviewed,
    ReusedArtifact,
    DirectRejected,
    Capacity,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum TrustOutcome {
    Applied {},
    Rejected { reason: TrustRejection },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustLimits {
    pub work: usize,
    pub development: usize,
    pub community_funded: usize,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustProfile {
    pub agent: u64,
    pub review_fixture_approved: bool,
    pub tier: u8,
    pub earned_credit_microunits: u64,
    pub confirmed_contracts: usize,
    pub customer_operators: usize,
    pub active_contracts: usize,
    pub development_memberships: usize,
    pub community_funded_memberships: usize,
    pub dispute_hold: bool,
    pub limits: TrustLimits,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustRecord {
    pub sequence: usize,
    pub action: TrustAction,
    pub outcome: TrustOutcome,
    #[serde(deserialize_with = "profiles")]
    pub profiles_after: Vec<TrustProfile>,
}

pub struct TrustEngine {
    config: TrustConfig,
    clock: u64,
    approved: BTreeSet<u64>,
    groups: BTreeMap<u64, Group>,
    projects: BTreeMap<u64, Project>,
    contracts: BTreeMap<u64, WorkContract>,
    consents: BTreeSet<(u64, String)>,
    credited_artifacts: BTreeSet<String>,
    direct: DirectEngine,
    actions: Vec<TrustAction>,
    journal: Vec<TrustRecord>,
}
impl TrustEngine {
    pub fn new(config: TrustConfig) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            direct: DirectEngine::new(DirectConfig {
                agents: config.operators.len() as u64,
                ticks: config.ticks,
                max_agreements: MAX_CONTRACTS,
            })?,
            config,
            clock: 0,
            approved: BTreeSet::new(),
            groups: BTreeMap::new(),
            projects: BTreeMap::new(),
            contracts: BTreeMap::new(),
            consents: BTreeSet::new(),
            credited_artifacts: BTreeSet::new(),
            actions: vec![],
            journal: vec![],
        })
    }
    fn exists(&self, agent: u64) -> bool {
        agent < self.config.operators.len() as u64
    }
    fn agreement(&self, id: u64) -> &Agreement {
        self.direct
            .agreement(id)
            .expect("contract has direct terms")
    }
    fn eligible_credit(&self, id: u64) -> bool {
        let a = self.agreement(id);
        a.delivery_acknowledged
            && a.payments_received == u128::from(a.terms.amount)
            && a.voluntary_refunds_received == 0
            && a.dispute_digest.is_none()
            && a.refund_request_digest.is_none()
            && !a.delivery_overdue
    }
    fn active(&self, id: u64) -> bool {
        let a = self.agreement(id);
        if a.payments_received > 0 && a.net_transferred() == 0 {
            return false;
        }
        if a.payments_received == 0 && self.clock >= a.terms.delivery_deadline {
            return false;
        }
        !(a.delivery_acknowledged
            && a.voluntary_refunds_received == 0
            && a.dispute_digest.is_none()
            && a.refund_request_digest.is_none())
    }
    pub fn profile(&self, agent: u64) -> Result<TrustProfile> {
        if !self.exists(agent) {
            return Err(SimulationError::Configuration("unknown trust agent"));
        }
        let mut earned = 0;
        let mut confirmed = 0;
        let mut customers = BTreeSet::new();
        let mut active = 0;
        let mut dispute = false;
        for (id, c) in &self.contracts {
            if !c.plan.shares.iter().any(|s| s.agent == agent) {
                continue;
            }
            active += usize::from(self.active(*id));
            let a = self.agreement(*id);
            dispute |= (a.dispute_digest.is_some() || a.refund_request_digest.is_some())
                && a.net_transferred() > 0;
            if self.eligible_credit(*id) && self.approved.contains(&c.plan.client) {
                for s in &c.credit_shares {
                    if s.agent == agent && s.earned_microunits > 0 {
                        earned += s.earned_microunits;
                        confirmed += 1;
                        customers.insert(self.config.operators[c.plan.client as usize]);
                    }
                }
            }
        }
        let reviewed = self.approved.contains(&agent);
        let tier = if reviewed
            && !dispute
            && self.clock >= self.config.minimum_age_ticks
            && customers.len() >= self.config.minimum_customer_operators
        {
            if earned >= self.config.tier_two_credits * CREDIT_SCALE {
                2
            } else if earned >= self.config.tier_one_credits * CREDIT_SCALE {
                1
            } else {
                0
            }
        } else {
            0
        };
        let limits = match tier {
            2 => TrustLimits {
                work: 4,
                development: 3,
                community_funded: 3,
            },
            1 => TrustLimits {
                work: 2,
                development: 2,
                community_funded: 2,
            },
            _ => TrustLimits {
                work: 1,
                development: 1,
                community_funded: 1,
            },
        };
        let memberships = |kind| {
            self.groups
                .values()
                .filter(|g| g.kind == kind && g.members.contains(&agent))
                .count()
        };
        Ok(TrustProfile {
            agent,
            review_fixture_approved: reviewed,
            tier,
            earned_credit_microunits: earned,
            confirmed_contracts: confirmed,
            customer_operators: customers.len(),
            active_contracts: active,
            development_memberships: memberships(GroupKind::Development),
            community_funded_memberships: memberships(GroupKind::CommunityFunded),
            dispute_hold: dispute,
            limits,
        })
    }
    fn all_profiles(&self) -> Result<Vec<TrustProfile>> {
        (0..self.config.operators.len() as u64)
            .map(|a| self.profile(a))
            .collect()
    }
    fn agent(actor: TrustActor) -> std::result::Result<u64, TrustRejection> {
        if let TrustActor::Agent { agent } = actor {
            Ok(agent)
        } else {
            Err(TrustRejection::WrongActor)
        }
    }
    fn membership_room(
        &self,
        agent: u64,
        kind: GroupKind,
    ) -> std::result::Result<(), TrustRejection> {
        let p = self
            .profile(agent)
            .map_err(|_| TrustRejection::WrongActor)?;
        if p.dispute_hold {
            return Err(TrustRejection::DisputeHold);
        }
        let (count, limit) = match kind {
            GroupKind::Development => (p.development_memberships, p.limits.development),
            GroupKind::CommunityFunded => {
                (p.community_funded_memberships, p.limits.community_funded)
            }
        };
        if count >= limit {
            Err(TrustRejection::MembershipLimit)
        } else {
            Ok(())
        }
    }
    pub fn record(&mut self, action: TrustAction) -> Result<TrustOutcome> {
        if self.actions.len() >= MAX_ACTIONS
            || action.tick < self.clock
            || action.tick >= self.config.ticks - 1
            || serde_json::to_vec(&action)
                .map_err(|_| SimulationError::Configuration("trust action encoding"))?
                .len()
                > 16_384
        {
            return Err(SimulationError::Capacity(
                "trust time, input or action bound exceeded",
            ));
        }
        self.clock = action.tick;
        let outcome = if matches!(action.actor, TrustActor::Agent { agent } if !self.exists(agent))
        {
            TrustOutcome::Rejected {
                reason: TrustRejection::WrongActor,
            }
        } else {
            match self.apply(&action) {
                Ok(()) => TrustOutcome::Applied {},
                Err(reason) => TrustOutcome::Rejected { reason },
            }
        };
        self.actions.push(action.clone());
        self.journal.push(TrustRecord {
            sequence: self.journal.len(),
            action,
            outcome,
            profiles_after: self.all_profiles()?,
        });
        Ok(outcome)
    }
    fn apply(&mut self, action: &TrustAction) -> std::result::Result<(), TrustRejection> {
        use TrustRejection::*;
        let review = action.actor == TrustActor::ReviewFixture {};
        match &action.command {
            TrustCommand::ReviewAgent {
                agent,
                approved,
                evidence_digest,
            } => {
                if !review {
                    return Err(WrongActor);
                }
                if !self.exists(*agent) || !valid_digest(evidence_digest) {
                    return Err(InvalidEvidence);
                }
                if *approved {
                    self.approved.insert(*agent);
                } else {
                    self.approved.remove(agent);
                }
            }
            TrustCommand::DefineProject {
                id,
                work_budget,
                scope_digest,
            } => {
                if !review {
                    return Err(WrongActor);
                }
                if !valid_digest(scope_digest) || !(1..=1_000_000).contains(work_budget) {
                    return Err(InvalidEvidence);
                }
                if self.projects.contains_key(id)
                    || self
                        .projects
                        .values()
                        .any(|p| p.scope_digest == *scope_digest)
                {
                    return Err(DuplicateRecord);
                }
                if self.projects.len() >= 128 {
                    return Err(Capacity);
                }
                self.projects.insert(
                    *id,
                    Project {
                        id: *id,
                        work_budget: *work_budget,
                        issued_units: 0,
                        scope_digest: scope_digest.clone(),
                    },
                );
            }
            TrustCommand::CreateGroup { id, kind } => {
                let agent = Self::agent(action.actor)?;
                if self.groups.contains_key(id) {
                    return Err(DuplicateRecord);
                }
                if self.groups.len() >= 128 {
                    return Err(Capacity);
                }
                self.membership_room(agent, *kind)?;
                self.groups.insert(
                    *id,
                    Group {
                        id: *id,
                        kind: *kind,
                        members: vec![agent],
                    },
                );
            }
            TrustCommand::JoinGroup { id } => {
                let agent = Self::agent(action.actor)?;
                let g = self.groups.get(id).ok_or(UnknownRecord)?;
                if g.members.contains(&agent) {
                    return Err(DuplicateRecord);
                }
                self.membership_room(agent, g.kind)?;
                let g = self.groups.get_mut(id).expect("group checked");
                g.members.push(agent);
                g.members.sort_unstable();
            }
            TrustCommand::LeaveGroup { id } => {
                let agent = Self::agent(action.actor)?;
                let g = self.groups.get(id).ok_or(UnknownRecord)?;
                if !g.members.contains(&agent) {
                    return Err(NotMember);
                }
                if self.contracts.iter().any(|(i, c)| {
                    c.plan.group == Some(*id)
                        && c.plan.shares.iter().any(|s| s.agent == agent)
                        && self.active(*i)
                }) {
                    return Err(ActiveGroupWork);
                }
                self.groups
                    .get_mut(id)
                    .expect("group checked")
                    .members
                    .retain(|a| *a != agent);
            }
            TrustCommand::Consent { plan_digest } => {
                let agent = Self::agent(action.actor)?;
                if !valid_digest(plan_digest) {
                    return Err(InvalidEvidence);
                }
                if !self.consents.insert((agent, plan_digest.clone())) {
                    return Err(DuplicateRecord);
                }
            }
            TrustCommand::OpenContract { plan } => {
                self.open(action.actor, plan)?;
            }
            TrustCommand::Contribute {
                contract_id,
                artifact_digest,
            } => {
                let agent = Self::agent(action.actor)?;
                if !valid_digest(artifact_digest) {
                    return Err(InvalidEvidence);
                }
                let c = self.contracts.get(contract_id).ok_or(UnknownRecord)?;
                if !c.plan.shares.iter().any(|s| s.agent == agent) {
                    return Err(NotMember);
                }
                let a = self.agreement(*contract_id);
                if self.clock >= c.plan.deadline
                    || a.payments_received != u128::from(c.plan.payment_units)
                    || a.voluntary_refunds_received > 0
                    || a.delivery_digest.is_some()
                {
                    return Err(WrongState);
                }
                if c.contributions.iter().any(|x| x.agent == agent) {
                    return Err(DuplicateRecord);
                }
                let c = self
                    .contracts
                    .get_mut(contract_id)
                    .expect("contract checked");
                c.contributions.push(Contribution {
                    agent,
                    artifact_digest: artifact_digest.clone(),
                });
                c.contributions.sort_by_key(|x| x.agent);
            }
            TrustCommand::Direct { command } => {
                self.direct_action(action.actor, command)?;
            }
            TrustCommand::ConfirmWork {
                contract_id,
                review_digest,
            } => {
                if !review {
                    return Err(WrongActor);
                }
                if !valid_digest(review_digest) {
                    return Err(InvalidEvidence);
                }
                let c = self.contracts.get(contract_id).ok_or(UnknownRecord)?;
                if c.reviewed_tick.is_some() {
                    return Err(DuplicateRecord);
                }
                if !self.eligible_credit(*contract_id) {
                    return Err(WrongState);
                }
                if self.clock
                    < c.accepted_tick
                        .ok_or(WrongState)?
                        .saturating_add(self.config.maturity_ticks)
                {
                    return Err(TooEarly);
                }
                if !self.approved.contains(&c.plan.client) {
                    return Err(CustomerNotReviewed);
                }
                let artifacts: BTreeSet<_> =
                    c.contributions.iter().map(|x| &x.artifact_digest).collect();
                if artifacts.len() != c.contributions.len()
                    || artifacts
                        .iter()
                        .any(|x| self.credited_artifacts.contains(*x))
                {
                    return Err(ReusedArtifact);
                }
                let allocated = allocate(c.plan.work_units, &c.plan.shares);
                let client_op = self.config.operators[c.plan.client as usize];
                let credit_shares = allocated
                    .into_iter()
                    .map(|(agent, units)| CreditShare {
                        agent,
                        allocated_microunits: units,
                        earned_microunits: if self.config.operators[agent as usize] == client_op {
                            0
                        } else {
                            units
                        },
                    })
                    .collect();
                self.credited_artifacts
                    .extend(artifacts.into_iter().cloned());
                let c = self
                    .contracts
                    .get_mut(contract_id)
                    .expect("contract checked");
                c.reviewed_tick = Some(self.clock);
                c.review_digest = Some(review_digest.clone());
                c.credit_shares = credit_shares;
            }
            TrustCommand::Advance {} => {
                if !review {
                    return Err(WrongActor);
                }
            }
        }
        Ok(())
    }
    fn open(
        &mut self,
        actor: TrustActor,
        p: &ContractPlan,
    ) -> std::result::Result<(), TrustRejection> {
        use TrustRejection::*;
        if Self::agent(actor)? != p.lead {
            return Err(WrongActor);
        }
        if self.contracts.contains_key(&p.id) {
            return Err(DuplicateRecord);
        }
        if self.contracts.len() >= MAX_CONTRACTS {
            return Err(Capacity);
        }
        if !self.exists(p.client)
            || p.shares.is_empty()
            || p.shares.len() > 16
            || p.shares.iter().any(|s| {
                !self.exists(s.agent)
                    || s.agent == p.client
                    || s.basis_points == 0
                    || s.basis_points > 10_000
            })
            || p.shares.windows(2).any(|w| w[0].agent >= w[1].agent)
            || !p.shares.iter().any(|s| s.agent == p.lead)
            || p.shares.iter().map(|s| s.basis_points).sum::<u32>() != 10_000
            || p.payment_units == 0
            || p.work_units == 0
            || p.work_units > 1_000_000
            || p.deadline <= self.clock
            || p.deadline >= self.config.ticks - 1
            || !valid_digest(&p.criteria_digest)
        {
            return Err(InvalidTerms);
        }
        if let Some(id) = p.group {
            let g = self.groups.get(&id).ok_or(UnknownRecord)?;
            if p.shares.iter().any(|s| !g.members.contains(&s.agent)) {
                return Err(NotMember);
            }
        } else if p.shares.len() != 1 {
            return Err(InvalidTerms);
        }
        for s in &p.shares {
            let profile = self.profile(s.agent).map_err(|_| InvalidTerms)?;
            if profile.dispute_hold {
                return Err(DisputeHold);
            }
            if profile.active_contracts >= profile.limits.work {
                return Err(WorkLimit);
            }
        }
        let project = self.projects.get(&p.project).ok_or(UnknownRecord)?;
        if project.issued_units + p.work_units > project.work_budget {
            return Err(ProjectBudget);
        }
        let digest = p.digest().map_err(|_| InvalidEvidence)?;
        for agent in std::iter::once(p.client).chain(p.shares.iter().map(|s| s.agent)) {
            if !self.consents.contains(&(agent, digest.clone())) {
                return Err(MissingConsent);
            }
        }
        self.direct
            .record(
                self.clock,
                DirectCommand::Agree {
                    terms: Terms {
                        agreement_id: p.id,
                        client: p.client,
                        provider: p.lead,
                        title: "AE-016 synthetic work".into(),
                        asset: "SYNTHETIC_UNIT".into(),
                        amount: p.payment_units,
                        delivery_deadline: p.deadline,
                        criteria_digest: p.criteria_digest.clone(),
                    },
                },
            )
            .map_err(|_| Capacity)?;
        if !matches!(
            self.direct
                .journal()
                .last()
                .expect("record appended")
                .outcome,
            DirectOutcome::Recorded {}
        ) {
            return Err(DirectRejected);
        }
        self.projects
            .get_mut(&p.project)
            .expect("project checked")
            .issued_units += p.work_units;
        for agent in std::iter::once(p.client).chain(p.shares.iter().map(|s| s.agent)) {
            self.consents.remove(&(agent, digest.clone()));
        }
        self.contracts.insert(
            p.id,
            WorkContract {
                plan: p.clone(),
                contributions: vec![],
                accepted_tick: None,
                reviewed_tick: None,
                review_digest: None,
                credit_shares: vec![],
            },
        );
        Ok(())
    }
    fn direct_action(
        &mut self,
        actor: TrustActor,
        command: &DirectCommand,
    ) -> std::result::Result<(), TrustRejection> {
        use TrustRejection::*;
        let (id, expected) = match command {
            DirectCommand::PaymentReceipt { receipt }
            | DirectCommand::VoluntaryRefundReceipt { receipt } => {
                (receipt.agreement_id, TrustActor::ReceiptFixture {})
            }
            DirectCommand::Deliver {
                agreement_id,
                provider,
                ..
            } => (*agreement_id, TrustActor::Agent { agent: *provider }),
            DirectCommand::Acknowledge {
                agreement_id,
                client,
            }
            | DirectCommand::Dispute {
                agreement_id,
                client,
                ..
            }
            | DirectCommand::RequestRefund {
                agreement_id,
                client,
                ..
            } => (*agreement_id, TrustActor::Agent { agent: *client }),
            DirectCommand::DeclineRefund {
                agreement_id,
                provider,
            } => (*agreement_id, TrustActor::Agent { agent: *provider }),
            DirectCommand::Agree { .. } | DirectCommand::Finish {} => return Err(WrongActor),
        };
        if actor != expected {
            return Err(WrongActor);
        }
        let c = self.contracts.get(&id).ok_or(UnknownRecord)?;
        if let DirectCommand::Deliver { .. } = command {
            if c.contributions.len() != c.plan.shares.len() {
                return Err(WrongState);
            }
        }
        self.direct
            .record(self.clock, command.clone())
            .map_err(|_| Capacity)?;
        if !matches!(
            self.direct
                .journal()
                .last()
                .expect("record appended")
                .outcome,
            DirectOutcome::Recorded {}
        ) {
            return Err(DirectRejected);
        }
        if matches!(command, DirectCommand::Acknowledge { .. }) {
            self.contracts
                .get_mut(&id)
                .expect("contract checked")
                .accepted_tick = Some(self.clock);
        }
        Ok(())
    }
    pub fn finish(mut self) -> Result<TrustReport> {
        self.clock = self.config.ticks - 1;
        self.direct.finish()?;
        let final_profiles = self.all_profiles()?;
        let mut r = TrustReport {
            schema_version: 1,
            model: "zoora-trust-run/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            credit_unit: "WORK_CREDIT_1_10000".into(),
            input: TrustInput {
                config: self.config,
                actions: self.actions,
            },
            journal: self.journal,
            groups: self.groups.into_values().collect(),
            projects: self.projects.into_values().collect(),
            contracts: self.contracts.into_values().collect(),
            profiles: final_profiles,
            direct: DirectReport::from_engine(&self.direct)?,
            fingerprint: String::new(),
        };
        r.fingerprint = r.hash()?;
        Ok(r)
    }
}

/// Exact fractional work credit. Carrying 1/10,000 credit units avoids the
/// per-contract rounding bonus that could reward splitting one job into many.
fn allocate(units: u64, shares: &[WorkShare]) -> Vec<(u64, u64)> {
    shares
        .iter()
        .map(|s| (s.agent, units * u64::from(s.basis_points)))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustReport {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub credit_unit: String,
    pub input: TrustInput,
    #[serde(deserialize_with = "records")]
    pub journal: Vec<TrustRecord>,
    #[serde(deserialize_with = "groups")]
    pub groups: Vec<Group>,
    #[serde(deserialize_with = "projects")]
    pub projects: Vec<Project>,
    #[serde(deserialize_with = "contracts")]
    pub contracts: Vec<WorkContract>,
    #[serde(deserialize_with = "profiles")]
    pub profiles: Vec<TrustProfile>,
    pub direct: DirectReport,
    pub fingerprint: String,
}
impl TrustReport {
    pub fn generate(input: TrustInput) -> Result<Self> {
        if input.actions.len() > MAX_ACTIONS {
            return Err(SimulationError::Capacity("trust action budget exceeded"));
        }
        let mut e = TrustEngine::new(input.config)?;
        for a in input.actions {
            e.record(a)?;
        }
        e.finish()
    }
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE016_TRUST_RUN_V1\0",
            &(
                self.schema_version,
                &self.model,
                &self.classification,
                &self.credit_unit,
                &self.input,
                &self.journal,
                &self.groups,
                &self.projects,
                &self.contracts,
                &self.profiles,
                &self.direct,
            ),
        )
    }
    pub fn verify(&self) -> Result<()> {
        self.input.config.validate()?;
        if self.fingerprint != self.hash()? || *self != Self::generate(self.input.clone())? {
            return Err(SimulationError::Replay(
                "trust history, credit, admission or report differs",
            ));
        }
        self.direct.verify()
    }
}
