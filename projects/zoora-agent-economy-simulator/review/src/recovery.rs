//! AE-017: declared review/appeal fixtures over the shared trust runtime.
//! Reviews decide workflow access only; they never move or reverse funds.
use crate::{
    allocation::fingerprint,
    direct::{Agreement, DirectCommand},
    trust::*,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use zoora_agent_economy_simulator::SimulationError;
use zoora_task_market::types::valid_digest;
type Result<T> = std::result::Result<T, SimulationError>;
pub const MAX_CASES: usize = 64;
macro_rules! bounded {
    ($name:ident,$typ:ty,$max:expr) => {
        fn $name<'de, D: serde::de::Deserializer<'de>>(
            d: D,
        ) -> std::result::Result<Vec<$typ>, D::Error> {
            crate::bounded::vec::<D, $typ, $max>(d)
        }
    };
}
bounded!(reviewers, Reviewer, 8);
bounded!(actions, RecoveryAction, MAX_ACTIONS);
bounded!(cases, ReviewCase, MAX_CASES);
bounded!(events, CaseEvent, 2048);
bounded!(journal, RecoveryRecord, MAX_ACTIONS);
bounded!(evidence, CaseEvidence, 8);
bounded!(assignments, u64, 2);
bounded!(profiles, TrustProfile, 64);
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reviewer {
    pub id: u64,
    pub operator: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryConfig {
    pub trust: TrustConfig,
    #[serde(deserialize_with = "reviewers")]
    pub reviewers: Vec<Reviewer>,
    pub response_ticks: u64,
    pub complaint_ticks: u64,
    pub evidence_ticks: u64,
    pub primary_review_ticks: u64,
    pub appeal_ticks: u64,
    pub appellate_review_ticks: u64,
}
impl RecoveryConfig {
    pub fn validate(&self) -> Result<()> {
        self.trust.validate()?;
        if !(3..=8).contains(&self.reviewers.len())
            || self.reviewers.windows(2).any(|w| w[0].id >= w[1].id)
            || self.reviewers.iter().any(|r| r.operator > 1_000_000)
            || !(1..=8).contains(&self.response_ticks)
            || !(1..=16).contains(&self.complaint_ticks)
            || !(1..=8).contains(&self.evidence_ticks)
            || !(2..=16).contains(&self.primary_review_ticks)
            || self.primary_review_ticks <= self.evidence_ticks
            || !(1..=8).contains(&self.appeal_ticks)
            || !(2..=16).contains(&self.appellate_review_ticks)
            || self.appellate_review_ticks <= self.evidence_ticks
        {
            return Err(SimulationError::Configuration(
                "invalid recovery configuration",
            ));
        }
        Ok(())
    }
    pub fn from_toml(s: &str) -> Result<Self> {
        let c: Self = toml::from_str(s)
            .map_err(|_| SimulationError::Configuration("invalid recovery TOML"))?;
        c.validate()?;
        Ok(c)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaseKind {
    Complaint,
    CustomerNonresponse,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkVerdict {
    AcceptWork,
    RejectWork,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaseStatus {
    Evidence,
    PrimaryReview,
    Provisional,
    AppellateEvidence,
    AppellateReview,
    FinalAccepted,
    FinalRejected,
    Expired,
    Stale,
    Withdrawn,
    Returned,
}
impl CaseStatus {
    fn terminal(self) -> bool {
        matches!(
            self,
            Self::FinalAccepted
                | Self::FinalRejected
                | Self::Expired
                | Self::Stale
                | Self::Withdrawn
                | Self::Returned
        )
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseEvidence {
    pub agent: u64,
    pub digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerdictRecord {
    pub reviewer: u64,
    pub tick: u64,
    pub verdict: WorkVerdict,
    pub binding: String,
    pub reason_digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewCase {
    pub id: u64,
    pub contract_id: u64,
    pub opener: u64,
    pub kind: CaseKind,
    pub opened_tick: u64,
    pub reason_digest: String,
    pub evidence_until: u64,
    pub primary_deadline: u64,
    #[serde(deserialize_with = "assignments")]
    pub primary_assignments: Vec<u64>,
    pub primary: Option<VerdictRecord>,
    pub appeal_until: Option<u64>,
    pub appellant: Option<u64>,
    pub appeal_reason: Option<String>,
    pub appellate_reviewer: Option<u64>,
    pub appellate_evidence_until: Option<u64>,
    pub appellate_deadline: Option<u64>,
    pub appellate: Option<VerdictRecord>,
    #[serde(deserialize_with = "evidence")]
    pub evidence: Vec<CaseEvidence>,
    pub status: CaseStatus,
    pub final_tick: Option<u64>,
    pub returned_tick: Option<u64>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RecoveryCommand {
    Trust {
        actor: TrustActor,
        command: TrustCommand,
    },
    OpenCase {
        agent: u64,
        contract_id: u64,
        kind: CaseKind,
        reason_digest: String,
    },
    SubmitEvidence {
        agent: u64,
        case_id: u64,
        evidence_digest: String,
    },
    PrimaryVerdict {
        reviewer: u64,
        case_id: u64,
        verdict: WorkVerdict,
        binding: String,
        reason_digest: String,
    },
    Appeal {
        agent: u64,
        case_id: u64,
        reason_digest: String,
    },
    AppellateVerdict {
        reviewer: u64,
        case_id: u64,
        verdict: WorkVerdict,
        binding: String,
        reason_digest: String,
    },
    Withdraw {
        agent: u64,
        case_id: u64,
    },
    Advance {},
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryAction {
    pub tick: u64,
    pub command: RecoveryCommand,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryInput {
    pub config: RecoveryConfig,
    #[serde(deserialize_with = "actions")]
    pub actions: Vec<RecoveryAction>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryRejection {
    UnknownRecord,
    WrongParty,
    WrongReviewer,
    WrongState,
    TooEarly,
    WindowClosed,
    NoIndependentPanel,
    InvalidEvidence,
    BindingMismatch,
    WorkNotAcceptable,
    DuplicateCase,
    Capacity,
    UseCaseWorkflow,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum RecoveryOutcome {
    Applied,
    Trust { outcome: TrustOutcome },
    Rejected { reason: RecoveryRejection },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryRecord {
    pub sequence: usize,
    pub action: RecoveryAction,
    pub outcome: RecoveryOutcome,
    pub event_count_after: usize,
    #[serde(deserialize_with = "profiles")]
    pub profiles_after: Vec<TrustProfile>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaseEventKind {
    Opened,
    EvidenceSubmitted,
    PrimaryWindowOpened,
    PrimaryReassigned,
    PrimaryDecision,
    AppealFiled,
    AppellateWindowOpened,
    AppellateDecision,
    Finalized,
    Expired,
    EvidenceStale,
    Withdrawn,
    ReturnObserved,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseEvent {
    pub sequence: usize,
    pub tick: u64,
    pub visible_actions: usize,
    pub kind: CaseEventKind,
    pub case: ReviewCase,
}

struct CaseBook {
    config: RecoveryConfig,
    cases: BTreeMap<u64, ReviewCase>,
    by_contract: BTreeMap<u64, u64>,
    events: Vec<CaseEvent>,
    visible_actions: usize,
    delivery_ticks: BTreeMap<u64, u64>,
}
impl CaseBook {
    fn emit(&mut self, tick: u64, id: u64, kind: CaseEventKind) {
        self.events.push(CaseEvent {
            sequence: self.events.len(),
            tick,
            visible_actions: self.visible_actions,
            kind,
            case: self.cases[&id].clone(),
        });
    }
    fn parties<'a>(
        &self,
        e: &'a TrustEngine,
        id: u64,
    ) -> Option<(&'a WorkContract, &'a Agreement)> {
        e.evidence(id)
    }
    fn party(&self, e: &TrustEngine, id: u64, agent: u64) -> bool {
        self.parties(e, id).is_some_and(|(c, _)| {
            c.plan.client == agent || c.plan.shares.iter().any(|s| s.agent == agent)
        })
    }
    fn eligible_reviewers(&self, e: &TrustEngine, id: u64, excluded: &BTreeSet<u64>) -> Vec<u64> {
        let Some((c, _)) = e.evidence(id) else {
            return vec![];
        };
        let mut parties = BTreeSet::from([
            self.config.trust.reviewer_operator,
            self.config.trust.operators[c.plan.client as usize],
        ]);
        parties.extend(
            c.plan
                .shares
                .iter()
                .map(|s| self.config.trust.operators[s.agent as usize]),
        );
        self.config
            .reviewers
            .iter()
            .filter(|r| !parties.contains(&r.operator) && !excluded.contains(&r.operator))
            .map(|r| r.id)
            .collect()
    }
    fn reviewer_operator(&self, id: u64) -> u64 {
        self.config
            .reviewers
            .iter()
            .find(|r| r.id == id)
            .expect("assigned reviewer exists")
            .operator
    }
    fn select(&self, eligible: &[u64], case_id: u64) -> u64 {
        eligible[case_id as usize % eligible.len()]
    }
    fn binding(&self, e: &TrustEngine, id: u64) -> Result<String> {
        let c = self
            .cases
            .get(&id)
            .ok_or(SimulationError::Integrity("unknown recovery case"))?;
        let (work, a) = e
            .evidence(c.contract_id)
            .ok_or(SimulationError::Integrity("unknown recovery work"))?;
        fingerprint(
            b"ZOORA_AE017_REVIEW_BINDING_V1\0",
            &(
                c.id,
                c.contract_id,
                c.opener,
                c.kind,
                c.opened_tick,
                &c.reason_digest,
                &c.evidence,
                &c.appeal_reason,
                work.plan.digest()?,
                &work.contributions,
                a.payments_received.to_string(),
                a.voluntary_refunds_received.to_string(),
                &a.delivery_digest,
                e.delivery_tick(c.contract_id),
            ),
        )
    }
    fn acceptable(e: &TrustEngine, id: u64) -> bool {
        e.evidence(id).is_some_and(|(c, a)| {
            a.payments_received == u128::from(c.plan.payment_units)
                && a.voluntary_refunds_received == 0
                && a.delivery_digest.is_some()
                && e.delivery_tick(id).is_some_and(|t| t < c.plan.deadline)
                && c.contributions.len() == c.plan.shares.len()
                && !a.delivery_overdue
        })
    }
    fn verdict_status(&self, e: &TrustEngine, c: &ReviewCase, v: &VerdictRecord) -> CaseStatus {
        if self.binding(e, c.id).ok().as_deref() != Some(v.binding.as_str()) {
            CaseStatus::Stale
        } else if v.verdict == WorkVerdict::AcceptWork {
            if Self::acceptable(e, c.contract_id) {
                CaseStatus::FinalAccepted
            } else {
                CaseStatus::Stale
            }
        } else {
            CaseStatus::FinalRejected
        }
    }
    fn next_timer(c: &ReviewCase) -> Option<u64> {
        match c.status {
            CaseStatus::Evidence => Some(c.evidence_until),
            CaseStatus::PrimaryReview => Some(c.primary_deadline),
            CaseStatus::Provisional => c.appeal_until,
            CaseStatus::AppellateEvidence => c.appellate_evidence_until,
            CaseStatus::AppellateReview => c.appellate_deadline,
            _ => None,
        }
    }
    fn advance(&mut self, tick: u64, e: &TrustEngine) -> Result<()> {
        let returned: Vec<_> = self
            .cases
            .values()
            .filter(|c| {
                c.returned_tick.is_none()
                    && e.evidence(c.contract_id)
                        .is_some_and(|(_, a)| a.payments_received > 0 && a.net_transferred() == 0)
            })
            .map(|c| c.id)
            .collect();
        for id in returned {
            let c = self.cases.get_mut(&id).expect("case exists");
            c.returned_tick = Some(tick);
            if !c.status.terminal() {
                c.status = CaseStatus::Returned;
                c.final_tick = Some(tick);
            }
            self.emit(tick, id, CaseEventKind::ReturnObserved);
        }
        loop {
            let next = self
                .cases
                .values()
                .filter_map(|c| Self::next_timer(c).map(|t| (t, c.id)))
                .filter(|(t, _)| *t <= tick)
                .min();
            let Some((due, id)) = next else { break };
            let old = self.cases[&id].clone();
            let event = match old.status {
                CaseStatus::Evidence => {
                    self.cases.get_mut(&id).expect("case exists").status =
                        CaseStatus::PrimaryReview;
                    CaseEventKind::PrimaryWindowOpened
                }
                CaseStatus::PrimaryReview => {
                    if old.primary_assignments.len() == 1 {
                        let excluded = old
                            .primary_assignments
                            .iter()
                            .map(|r| self.reviewer_operator(*r))
                            .collect();
                        let eligible = self.eligible_reviewers(e, old.contract_id, &excluded);
                        let selected = self.select(&eligible, id);
                        let c = self.cases.get_mut(&id).expect("case exists");
                        c.primary_assignments.push(selected);
                        c.primary_deadline = due + self.config.primary_review_ticks;
                        CaseEventKind::PrimaryReassigned
                    } else {
                        let c = self.cases.get_mut(&id).expect("case exists");
                        c.status = CaseStatus::Expired;
                        c.final_tick = Some(due);
                        CaseEventKind::Expired
                    }
                }
                CaseStatus::Provisional => {
                    let status = self.verdict_status(
                        e,
                        &old,
                        old.primary.as_ref().expect("provisional verdict"),
                    );
                    let c = self.cases.get_mut(&id).expect("case exists");
                    c.status = status;
                    c.final_tick = Some(due);
                    if status == CaseStatus::Stale {
                        CaseEventKind::EvidenceStale
                    } else {
                        CaseEventKind::Finalized
                    }
                }
                CaseStatus::AppellateEvidence => {
                    self.cases.get_mut(&id).expect("case exists").status =
                        CaseStatus::AppellateReview;
                    CaseEventKind::AppellateWindowOpened
                }
                CaseStatus::AppellateReview => {
                    let c = self.cases.get_mut(&id).expect("case exists");
                    c.status = CaseStatus::Expired;
                    c.final_tick = Some(due);
                    CaseEventKind::Expired
                }
                _ => return Err(SimulationError::Integrity("invalid case timer")),
            };
            self.emit(due, id, event);
        }
        if self.events.len() > 2048 {
            return Err(SimulationError::Capacity("case event budget exceeded"));
        }
        Ok(())
    }
    fn apply(
        &mut self,
        tick: u64,
        cmd: &RecoveryCommand,
        e: &TrustEngine,
    ) -> std::result::Result<(), RecoveryRejection> {
        use RecoveryRejection::*;
        match cmd {
            RecoveryCommand::OpenCase {
                agent,
                contract_id,
                kind,
                reason_digest,
            } => {
                let (work, a) = e.evidence(*contract_id).ok_or(UnknownRecord)?;
                if !self.party(e, *contract_id, *agent) {
                    return Err(WrongParty);
                }
                if !valid_digest(reason_digest) {
                    return Err(InvalidEvidence);
                }
                if self.by_contract.contains_key(contract_id) {
                    return Err(DuplicateCase);
                }
                if a.net_transferred() == 0 {
                    return Err(WrongState);
                }
                match kind {
                    CaseKind::Complaint => {
                        if *agent != work.plan.client {
                            return Err(WrongParty);
                        }
                        if a.delivery_digest.is_none() && tick < work.plan.deadline {
                            return Err(TooEarly);
                        }
                        let anchor = work.accepted_tick.unwrap_or(work.plan.deadline);
                        if tick >= anchor + self.config.complaint_ticks {
                            return Err(WindowClosed);
                        }
                    }
                    CaseKind::CustomerNonresponse => {
                        if *agent == work.plan.client {
                            return Err(WrongParty);
                        }
                        if a.delivery_acknowledged || !Self::acceptable(e, *contract_id) {
                            return Err(WrongState);
                        }
                        let ready = e.delivery_tick(*contract_id).ok_or(WrongState)?
                            + self.config.response_ticks;
                        if tick < ready {
                            return Err(TooEarly);
                        }
                        if tick >= ready + self.config.complaint_ticks {
                            return Err(WindowClosed);
                        }
                    }
                }
                if self.cases.len() >= MAX_CASES {
                    return Err(Capacity);
                }
                let eligible = self.eligible_reviewers(e, *contract_id, &BTreeSet::new());
                let independent: BTreeSet<_> = eligible
                    .iter()
                    .map(|r| self.reviewer_operator(*r))
                    .collect();
                if independent.len() < 3 {
                    return Err(NoIndependentPanel);
                }
                let max_span = self.config.evidence_ticks
                    + 2 * self.config.primary_review_ticks
                    + self.config.appeal_ticks
                    + self.config.appellate_review_ticks;
                if tick + max_span >= self.config.trust.ticks - 1 {
                    return Err(WindowClosed);
                }
                let id = self.cases.len() as u64;
                let reviewer = self.select(&eligible, id);
                self.cases.insert(
                    id,
                    ReviewCase {
                        id,
                        contract_id: *contract_id,
                        opener: *agent,
                        kind: *kind,
                        opened_tick: tick,
                        reason_digest: reason_digest.clone(),
                        evidence_until: tick + self.config.evidence_ticks,
                        primary_deadline: tick
                            + self.config.evidence_ticks
                            + self.config.primary_review_ticks,
                        primary_assignments: vec![reviewer],
                        primary: None,
                        appeal_until: None,
                        appellant: None,
                        appeal_reason: None,
                        appellate_reviewer: None,
                        appellate_evidence_until: None,
                        appellate_deadline: None,
                        appellate: None,
                        evidence: vec![],
                        status: CaseStatus::Evidence,
                        final_tick: None,
                        returned_tick: None,
                    },
                );
                self.by_contract.insert(*contract_id, id);
                self.emit(tick, id, CaseEventKind::Opened);
            }
            RecoveryCommand::SubmitEvidence {
                agent,
                case_id,
                evidence_digest,
            } => {
                let c = self.cases.get(case_id).ok_or(UnknownRecord)?;
                if !self.party(e, c.contract_id, *agent) {
                    return Err(WrongParty);
                }
                if !matches!(
                    c.status,
                    CaseStatus::Evidence | CaseStatus::AppellateEvidence
                ) {
                    return Err(WrongState);
                }
                if !valid_digest(evidence_digest) {
                    return Err(InvalidEvidence);
                }
                if c.evidence.len() >= 8 {
                    return Err(Capacity);
                }
                if c.evidence.iter().any(|x| x.digest == *evidence_digest) {
                    return Err(InvalidEvidence);
                }
                self.cases
                    .get_mut(case_id)
                    .expect("case exists")
                    .evidence
                    .push(CaseEvidence {
                        agent: *agent,
                        digest: evidence_digest.clone(),
                    });
                self.emit(tick, *case_id, CaseEventKind::EvidenceSubmitted);
            }
            RecoveryCommand::PrimaryVerdict {
                reviewer,
                case_id,
                verdict,
                binding,
                reason_digest,
            }
            | RecoveryCommand::AppellateVerdict {
                reviewer,
                case_id,
                verdict,
                binding,
                reason_digest,
            } => {
                let c = self.cases.get(case_id).ok_or(UnknownRecord)?;
                let appeal = matches!(cmd, RecoveryCommand::AppellateVerdict { .. });
                let (expected, status, ready) = if appeal {
                    (
                        c.appellate_reviewer,
                        CaseStatus::AppellateReview,
                        c.appellate_evidence_until.unwrap_or(u64::MAX),
                    )
                } else {
                    (
                        c.primary_assignments.last().copied(),
                        CaseStatus::PrimaryReview,
                        c.evidence_until,
                    )
                };
                if expected != Some(*reviewer) {
                    return Err(WrongReviewer);
                }
                if tick < ready {
                    return Err(TooEarly);
                }
                if c.status != status {
                    return Err(WrongState);
                }
                if !valid_digest(reason_digest) || !valid_digest(binding) {
                    return Err(InvalidEvidence);
                }
                if self.binding(e, *case_id).ok().as_ref() != Some(binding) {
                    return Err(BindingMismatch);
                }
                if *verdict == WorkVerdict::AcceptWork && !Self::acceptable(e, c.contract_id) {
                    return Err(WorkNotAcceptable);
                }
                let v = VerdictRecord {
                    reviewer: *reviewer,
                    tick,
                    verdict: *verdict,
                    binding: binding.clone(),
                    reason_digest: reason_digest.clone(),
                };
                let c = self.cases.get_mut(case_id).expect("case exists");
                if appeal {
                    c.appellate = Some(v);
                    c.status = if *verdict == WorkVerdict::AcceptWork {
                        CaseStatus::FinalAccepted
                    } else {
                        CaseStatus::FinalRejected
                    };
                    c.final_tick = Some(tick);
                    self.emit(tick, *case_id, CaseEventKind::AppellateDecision);
                } else {
                    c.primary = Some(v);
                    c.status = CaseStatus::Provisional;
                    c.appeal_until = Some(tick + self.config.appeal_ticks);
                    self.emit(tick, *case_id, CaseEventKind::PrimaryDecision);
                }
            }
            RecoveryCommand::Appeal {
                agent,
                case_id,
                reason_digest,
            } => {
                let c = self.cases.get(case_id).ok_or(UnknownRecord)?;
                if !self.party(e, c.contract_id, *agent) {
                    return Err(WrongParty);
                }
                if c.status != CaseStatus::Provisional {
                    return Err(WrongState);
                }
                if !valid_digest(reason_digest) {
                    return Err(InvalidEvidence);
                }
                let excluded = c
                    .primary_assignments
                    .iter()
                    .map(|r| self.reviewer_operator(*r))
                    .collect();
                let eligible = self.eligible_reviewers(e, c.contract_id, &excluded);
                if eligible.is_empty() {
                    return Err(NoIndependentPanel);
                }
                let reviewer = self.select(&eligible, *case_id);
                let c = self.cases.get_mut(case_id).expect("case exists");
                c.appellant = Some(*agent);
                c.appeal_reason = Some(reason_digest.clone());
                c.appellate_reviewer = Some(reviewer);
                c.appellate_evidence_until = Some(tick + self.config.evidence_ticks);
                c.appellate_deadline = Some(tick + self.config.appellate_review_ticks);
                c.status = CaseStatus::AppellateEvidence;
                self.emit(tick, *case_id, CaseEventKind::AppealFiled);
            }
            RecoveryCommand::Withdraw { agent, case_id } => {
                let c = self.cases.get(case_id).ok_or(UnknownRecord)?;
                if c.opener != *agent {
                    return Err(WrongParty);
                }
                if !matches!(c.status, CaseStatus::Evidence | CaseStatus::PrimaryReview)
                    || c.primary.is_some()
                {
                    return Err(WrongState);
                }
                let c = self.cases.get_mut(case_id).expect("case exists");
                c.status = CaseStatus::Withdrawn;
                c.final_tick = Some(tick);
                self.emit(tick, *case_id, CaseEventKind::Withdrawn);
            }
            RecoveryCommand::Advance {} => {}
            RecoveryCommand::Trust { .. } => return Err(WrongState),
        }
        Ok(())
    }
}
impl TrustControl for CaseBook {
    fn disposition(&self, tick: u64, c: &WorkContract, a: &Agreement) -> TrustDisposition {
        if a.payments_received > 0 && a.net_transferred() == 0 {
            return TrustDisposition::Ordinary;
        }
        if let Some(id) = self.by_contract.get(&c.plan.id) {
            let case = &self.cases[id];
            return match case.status {
                CaseStatus::FinalAccepted => {
                    let v = case
                        .appellate
                        .as_ref()
                        .or(case.primary.as_ref())
                        .expect("accepted verdict");
                    // Bind to the *current* facts, including later voluntary returns.
                    let binding = fingerprint(
                        b"ZOORA_AE017_REVIEW_BINDING_V1\0",
                        &(
                            case.id,
                            case.contract_id,
                            case.opener,
                            case.kind,
                            case.opened_tick,
                            &case.reason_digest,
                            &case.evidence,
                            &case.appeal_reason,
                            c.plan.digest().expect("plan serialization"),
                            &c.contributions,
                            a.payments_received.to_string(),
                            a.voluntary_refunds_received.to_string(),
                            &a.delivery_digest,
                            // The validated decision binds the only successful delivery tick.
                            self.delivery_ticks.get(&c.plan.id).copied(),
                        ),
                    )
                    .expect("binding serialization");
                    if binding == v.binding {
                        TrustDisposition::Accepted {
                            accepted_tick: case.final_tick.expect("final tick"),
                        }
                    } else {
                        TrustDisposition::Unresolved
                    }
                }
                CaseStatus::FinalRejected => TrustDisposition::Rejected,
                CaseStatus::Expired | CaseStatus::Stale => TrustDisposition::Unresolved,
                CaseStatus::Withdrawn | CaseStatus::Returned => TrustDisposition::Ordinary,
                _ => TrustDisposition::Pending,
            };
        }
        if tick >= c.plan.deadline && a.net_transferred() > 0 && !a.delivery_acknowledged {
            TrustDisposition::Unresolved
        } else {
            TrustDisposition::Ordinary
        }
    }
}

pub struct RecoveryEngine {
    config: RecoveryConfig,
    trust: TrustEngine,
    book: CaseBook,
    actions: Vec<RecoveryAction>,
    journal: Vec<RecoveryRecord>,
    clock: u64,
}
impl RecoveryEngine {
    pub fn new(config: RecoveryConfig) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            trust: TrustEngine::new(config.trust.clone())?,
            book: CaseBook {
                config: config.clone(),
                cases: BTreeMap::new(),
                by_contract: BTreeMap::new(),
                events: vec![],
                visible_actions: 0,
                delivery_ticks: BTreeMap::new(),
            },
            config,
            actions: vec![],
            journal: vec![],
            clock: 0,
        })
    }
    pub fn case(&self, id: u64) -> Option<&ReviewCase> {
        self.book.cases.get(&id)
    }
    pub fn binding(&self, id: u64) -> Result<String> {
        self.book.binding(&self.trust, id)
    }
    pub fn profiles(&self) -> Result<Vec<TrustProfile>> {
        self.trust.controlled_profiles(&self.book)
    }
    pub fn record(&mut self, action: RecoveryAction) -> Result<RecoveryOutcome> {
        if self.actions.len() >= MAX_ACTIONS
            || action.tick < self.clock
            || action.tick >= self.config.trust.ticks - 1
            || serde_json::to_vec(&action)
                .map_err(|_| SimulationError::Configuration("recovery action encoding"))?
                .len()
                > 16_384
        {
            return Err(SimulationError::Capacity(
                "recovery time or action bound exceeded",
            ));
        }
        self.clock = action.tick;
        self.trust.advance_control_clock(self.clock)?;
        self.book.visible_actions = self.actions.len();
        self.book.advance(self.clock, &self.trust)?;
        self.book.visible_actions = self.actions.len() + 1;
        let outcome = match &action.command {
            RecoveryCommand::Trust { actor, command } => {
                if matches!(
                    command,
                    TrustCommand::Direct {
                        command: DirectCommand::Dispute { .. }
                            | DirectCommand::RequestRefund { .. }
                            | DirectCommand::DeclineRefund { .. }
                    }
                ) {
                    RecoveryOutcome::Rejected {
                        reason: RecoveryRejection::UseCaseWorkflow,
                    }
                } else {
                    let outcome = self.trust.record_controlled(
                        TrustAction {
                            tick: self.clock,
                            actor: *actor,
                            command: command.clone(),
                        },
                        &self.book,
                    )?;
                    if outcome == (TrustOutcome::Applied {}) {
                        if let TrustCommand::Direct {
                            command: DirectCommand::Deliver { agreement_id, .. },
                        } = command
                        {
                            self.book.delivery_ticks.insert(*agreement_id, self.clock);
                        }
                    }
                    RecoveryOutcome::Trust { outcome }
                }
            }
            cmd => match self.book.apply(self.clock, cmd, &self.trust) {
                Ok(()) => RecoveryOutcome::Applied,
                Err(reason) => RecoveryOutcome::Rejected { reason },
            },
        };
        self.book.advance(self.clock, &self.trust)?;
        self.actions.push(action.clone());
        self.journal.push(RecoveryRecord {
            sequence: self.journal.len(),
            action,
            outcome,
            event_count_after: self.book.events.len(),
            profiles_after: self.profiles()?,
        });
        Ok(outcome)
    }
    pub fn finish(mut self) -> Result<RecoveryReport> {
        self.clock = self.config.trust.ticks - 1;
        self.trust.advance_control_clock(self.clock)?;
        self.book.visible_actions = self.actions.len();
        self.book.advance(self.clock, &self.trust)?;
        let trust = self.trust.into_transcript(&self.book)?;
        let mut r = RecoveryReport {
            schema_version: 1,
            model: "zoora-recovery-run/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            input: RecoveryInput {
                config: self.config,
                actions: self.actions,
            },
            journal: self.journal,
            cases: self.book.cases.into_values().collect(),
            events: self.book.events,
            trust,
            fingerprint: String::new(),
        };
        r.fingerprint = r.hash()?;
        Ok(r)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryReport {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub input: RecoveryInput,
    #[serde(deserialize_with = "journal")]
    pub journal: Vec<RecoveryRecord>,
    #[serde(deserialize_with = "cases")]
    pub cases: Vec<ReviewCase>,
    #[serde(deserialize_with = "events")]
    pub events: Vec<CaseEvent>,
    pub trust: TrustTranscript,
    pub fingerprint: String,
}
impl RecoveryReport {
    pub fn generate(input: RecoveryInput) -> Result<Self> {
        if input.actions.len() > MAX_ACTIONS {
            return Err(SimulationError::Capacity("recovery action budget"));
        }
        let mut e = RecoveryEngine::new(input.config)?;
        for a in input.actions {
            e.record(a)?;
        }
        e.finish()
    }
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE017_RECOVERY_RUN_V1\0",
            &(
                self.schema_version,
                &self.model,
                &self.classification,
                &self.input,
                &self.journal,
                &self.cases,
                &self.events,
                &self.trust,
            ),
        )
    }
    pub fn verify(&self) -> Result<()> {
        if self.fingerprint != self.hash()? || *self != Self::generate(self.input.clone())? {
            return Err(SimulationError::Replay(
                "recovery history, decisions, credit or admission differs",
            ));
        }
        self.trust.direct.verify()
    }
}
