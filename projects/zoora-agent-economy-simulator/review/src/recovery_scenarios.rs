//! Fixed adversarial examples. Reviewer identities and judgments are fixtures.
use crate::{
    allocation::fingerprint,
    direct::{DirectCommand, Receipt},
    recovery::*,
    trust::*,
};
use serde::{Deserialize, Serialize};
use zoora_agent_economy_simulator::SimulationError;
type Result<T> = std::result::Result<T, SimulationError>;
pub const CASES: [&str; 15] = [
    "FALSE_COMPLAINT_DISMISSED",
    "CUSTOMER_NONRESPONSE_ACCEPTED",
    "COMPLAINT_UPHELD",
    "APPEAL_OVERTURNS_REJECTION",
    "APPEAL_UPHOLDS_COMPLAINT",
    "REVIEWER_TIMEOUT_ESCALATION",
    "REVIEWERS_ALL_TIMEOUT",
    "APPEAL_TIMEOUT_UNRESOLVED",
    "RETURN_RESOLVES_PENDING",
    "STALE_ACCEPTANCE",
    "CONFLICTED_REVIEWERS",
    "UNFINISHED_PAID_WORK_HOLD",
    "COLLECTIVE_CONTESTED",
    "DEADLINE_BOUNDARIES",
    "FORGED_BINDINGS_AND_DUPLICATES",
];
fn digest(label: &str, id: u64, agent: u64) -> String {
    fingerprint(b"ZOORA_AE017_DEMO_REFERENCE_V1\0", &(label, id, agent)).expect("fixed fixture")
}
struct Builder {
    engine: RecoveryEngine,
    config: RecoveryConfig,
    tick: u64,
    next: u64,
}
impl Builder {
    fn new(c: &RecoveryConfig) -> Result<Self> {
        let mut b = Self {
            engine: RecoveryEngine::new(c.clone())?,
            config: c.clone(),
            tick: 0,
            next: 0,
        };
        for agent in [0, 1, 2, 3] {
            b.trust(
                TrustActor::ReviewFixture {},
                TrustCommand::ReviewAgent {
                    agent,
                    approved: true,
                    evidence_digest: digest("agent-review", agent, 0),
                },
            )?;
        }
        b.trust(
            TrustActor::ReviewFixture {},
            TrustCommand::DefineProject {
                id: 0,
                work_budget: 1000,
                scope_digest: digest("scope", 0, 0),
            },
        )?;
        Ok(b)
    }
    fn cmd(&mut self, command: RecoveryCommand) -> Result<()> {
        self.engine.record(RecoveryAction {
            tick: self.tick,
            command,
        })?;
        Ok(())
    }
    fn trust(&mut self, actor: TrustActor, command: TrustCommand) -> Result<()> {
        self.cmd(RecoveryCommand::Trust { actor, command })
    }
    fn agent(&mut self, agent: u64, command: TrustCommand) -> Result<()> {
        self.trust(TrustActor::Agent { agent }, command)
    }
    fn plan(&mut self, client: u64, units: u64) -> ContractPlan {
        let id = self.next;
        self.next += 1;
        ContractPlan {
            id,
            project: 0,
            client,
            lead: 0,
            group: None,
            payment_units: 100,
            work_units: units,
            deadline: self.config.trust.ticks - 2,
            criteria_digest: digest("criteria", id, 0),
            shares: vec![WorkShare {
                agent: 0,
                basis_points: 10000,
            }],
        }
    }
    fn open(&mut self, p: &ContractPlan) -> Result<()> {
        let plan_digest = p.digest()?;
        for agent in std::iter::once(p.client).chain(p.shares.iter().map(|s| s.agent)) {
            self.agent(
                agent,
                TrustCommand::Consent {
                    plan_digest: plan_digest.clone(),
                },
            )?;
        }
        self.agent(p.lead, TrustCommand::OpenContract { plan: p.clone() })
    }
    fn fund(&mut self, p: &ContractPlan) -> Result<()> {
        self.tick += 1;
        self.trust(
            TrustActor::ReceiptFixture {},
            TrustCommand::Direct {
                command: DirectCommand::PaymentReceipt {
                    receipt: Receipt::synthetic(
                        p.id,
                        p.id,
                        p.client,
                        p.lead,
                        p.payment_units,
                        self.tick,
                    ),
                },
            },
        )
    }
    fn deliver(&mut self, p: &ContractPlan) -> Result<()> {
        self.tick += 1;
        for s in &p.shares {
            self.agent(
                s.agent,
                TrustCommand::Contribute {
                    contract_id: p.id,
                    artifact_digest: digest("contribution", p.id, s.agent),
                },
            )?;
        }
        self.agent(
            p.lead,
            TrustCommand::Direct {
                command: DirectCommand::Deliver {
                    agreement_id: p.id,
                    provider: p.lead,
                    artifact_digest: digest("delivery", p.id, p.lead),
                },
            },
        )
    }
    fn ack(&mut self, p: &ContractPlan) -> Result<()> {
        self.tick += 1;
        self.agent(
            p.client,
            TrustCommand::Direct {
                command: DirectCommand::Acknowledge {
                    agreement_id: p.id,
                    client: p.client,
                },
            },
        )
    }
    fn confirm(&mut self, p: &ContractPlan) -> Result<()> {
        self.trust(
            TrustActor::ReviewFixture {},
            TrustCommand::ConfirmWork {
                contract_id: p.id,
                review_digest: digest("credit", p.id, 0),
            },
        )
    }
    fn complete(&mut self, p: &ContractPlan) -> Result<()> {
        self.open(p)?;
        self.fund(p)?;
        self.deliver(p)?;
        self.ack(p)?;
        self.tick += self.config.trust.maturity_ticks;
        self.confirm(p)
    }
    fn open_case(&mut self, p: &ContractPlan, kind: CaseKind) -> Result<()> {
        self.cmd(RecoveryCommand::OpenCase {
            agent: if kind == CaseKind::Complaint {
                p.client
            } else {
                p.lead
            },
            contract_id: p.id,
            kind,
            reason_digest: digest("case", p.id, 0),
        })
    }
    fn reviewer(&self, id: u64, appeal: bool) -> Result<u64> {
        let c = self.engine.case(id).ok_or(SimulationError::Configuration(
            "demo case was not admitted; use compatible timing and reviewer settings",
        ))?;
        let reviewer = if appeal {
            c.appellate_reviewer
        } else {
            c.primary_assignments.last().copied()
        };
        reviewer.ok_or(SimulationError::Configuration(
            "demo reviewer was not assigned; use compatible timing and reviewer settings",
        ))
    }
    fn verdict(&mut self, id: u64, verdict: WorkVerdict, appeal: bool) -> Result<()> {
        // Advance timers before querying the assigned backup or appellate fixture.
        self.cmd(RecoveryCommand::Advance {})?;
        let reviewer = self.reviewer(id, appeal)?;
        let binding = self.engine.binding(id)?;
        let reason_digest = digest("judgment", id, u64::from(appeal));
        self.cmd(if appeal {
            RecoveryCommand::AppellateVerdict {
                reviewer,
                case_id: id,
                verdict,
                binding,
                reason_digest,
            }
        } else {
            RecoveryCommand::PrimaryVerdict {
                reviewer,
                case_id: id,
                verdict,
                binding,
                reason_digest,
            }
        })
    }
    fn appeal(&mut self, id: u64, agent: u64) -> Result<()> {
        self.cmd(RecoveryCommand::Appeal {
            agent,
            case_id: id,
            reason_digest: digest("appeal", id, agent),
        })
    }
    fn refund(&mut self, p: &ContractPlan, amount: u64, reference: u64) -> Result<()> {
        self.trust(
            TrustActor::ReceiptFixture {},
            TrustCommand::Direct {
                command: DirectCommand::VoluntaryRefundReceipt {
                    receipt: Receipt::synthetic(
                        p.id, reference, p.lead, p.client, amount, self.tick,
                    ),
                },
            },
        )
    }
    fn done(self) -> Result<RecoveryReport> {
        self.engine.finish()
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryCase {
    pub name: String,
    pub run: RecoveryReport,
}
fn cases<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<RecoveryCase>, D::Error> {
    crate::bounded::vec::<D, RecoveryCase, 15>(d)
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryCampaign {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub config: RecoveryConfig,
    #[serde(deserialize_with = "cases")]
    pub cases: Vec<RecoveryCase>,
    pub fingerprint: String,
}
impl RecoveryCampaign {
    pub fn generate(config: RecoveryConfig) -> Result<Self> {
        config.validate()?;
        let mut cases = vec![];
        for name in CASES {
            let mut b = Builder::new(&config)?;
            let mut p = b.plan(1, 100);
            match name {
                "FALSE_COMPLAINT_DISMISSED" => {
                    // Two independent customers establish tier one before the complaint.
                    p.work_units = 50;
                    b.complete(&p)?;
                    let q = b.plan(2, 50);
                    b.complete(&q)?;
                    b.open_case(&q, CaseKind::Complaint)?;
                    let r = b.plan(1, 1);
                    b.open(&r)?; // deliberately held
                    b.tick += config.evidence_ticks;
                    b.verdict(0, WorkVerdict::AcceptWork, false)?;
                    b.tick += config.appeal_ticks;
                    b.cmd(RecoveryCommand::Advance {})?;
                    b.tick += config.trust.maturity_ticks;
                    b.cmd(RecoveryCommand::Advance {})?;
                }
                "UNFINISHED_PAID_WORK_HOLD" => {
                    p.deadline = 10;
                    b.open(&p)?;
                    b.fund(&p)?;
                    b.tick = 10;
                    b.cmd(RecoveryCommand::Advance {})?;
                    let q = b.plan(2, 1);
                    b.open(&q)?;
                    b.open_case(&p, CaseKind::Complaint)?;
                    b.tick += config.evidence_ticks;
                    b.verdict(0, WorkVerdict::AcceptWork, false)?; // no delivery: rejection
                    b.verdict(0, WorkVerdict::RejectWork, false)?;
                }
                "CUSTOMER_NONRESPONSE_ACCEPTED"
                | "REVIEWER_TIMEOUT_ESCALATION"
                | "REVIEWERS_ALL_TIMEOUT" => {
                    b.open(&p)?;
                    b.fund(&p)?;
                    b.deliver(&p)?;
                    b.tick += config.response_ticks;
                    b.open_case(&p, CaseKind::CustomerNonresponse)?;
                    if name != "REVIEWERS_ALL_TIMEOUT" {
                        if name == "REVIEWER_TIMEOUT_ESCALATION" {
                            let old = b.reviewer(0, false)?;
                            b.tick += config.evidence_ticks + config.primary_review_ticks;
                            b.cmd(RecoveryCommand::PrimaryVerdict {
                                reviewer: old,
                                case_id: 0,
                                verdict: WorkVerdict::AcceptWork,
                                binding: b.engine.binding(0)?,
                                reason_digest: digest("late", 0, 0),
                            })?;
                        } else {
                            b.tick += config.evidence_ticks;
                        }
                        b.verdict(0, WorkVerdict::AcceptWork, false)?;
                        b.tick += config.appeal_ticks;
                        b.cmd(RecoveryCommand::Advance {})?;
                        b.confirm(&p)?; // deliberately before credit maturity
                        b.tick += config.trust.maturity_ticks;
                        b.confirm(&p)?;
                    }
                }
                "COLLECTIVE_CONTESTED" => {
                    b.agent(
                        0,
                        TrustCommand::CreateGroup {
                            id: 0,
                            kind: GroupKind::Development,
                        },
                    )?;
                    b.agent(3, TrustCommand::JoinGroup { id: 0 })?;
                    p.group = Some(0);
                    p.work_units = 101;
                    p.shares = vec![
                        WorkShare {
                            agent: 0,
                            basis_points: 6000,
                        },
                        WorkShare {
                            agent: 3,
                            basis_points: 4000,
                        },
                    ];
                    b.complete(&p)?;
                    b.open_case(&p, CaseKind::Complaint)?;
                    b.agent(3, TrustCommand::LeaveGroup { id: 0 })?;
                    b.tick += config.evidence_ticks;
                    b.verdict(0, WorkVerdict::AcceptWork, false)?;
                    b.tick += config.appeal_ticks + config.trust.maturity_ticks;
                    b.cmd(RecoveryCommand::Advance {})?;
                    b.agent(3, TrustCommand::LeaveGroup { id: 0 })?;
                }
                _ => {
                    b.complete(&p)?;
                    b.open_case(&p, CaseKind::Complaint)?;
                    match name {
                        "RETURN_RESOLVES_PENDING" => {
                            b.refund(&p, 30, 1000)?;
                            b.refund(&p, 70, 1001)?;
                            b.tick += config.evidence_ticks;
                            b.verdict(0, WorkVerdict::AcceptWork, false)?;
                        }
                        "FORGED_BINDINGS_AND_DUPLICATES" => {
                            b.open_case(&p, CaseKind::Complaint)?;
                            b.cmd(RecoveryCommand::SubmitEvidence {
                                agent: 2,
                                case_id: 0,
                                evidence_digest: digest("outsider", 0, 2),
                            })?;
                            let old = b.engine.binding(0)?;
                            b.cmd(RecoveryCommand::SubmitEvidence {
                                agent: 0,
                                case_id: 0,
                                evidence_digest: digest("evidence", 0, 0),
                            })?;
                            b.tick += config.evidence_ticks;
                            let reviewer = b.reviewer(0, false)?;
                            b.cmd(RecoveryCommand::PrimaryVerdict {
                                reviewer,
                                case_id: 0,
                                verdict: WorkVerdict::AcceptWork,
                                binding: old,
                                reason_digest: digest("stale-binding", 0, 0),
                            })?;
                            b.verdict(0, WorkVerdict::AcceptWork, false)?;
                            b.verdict(0, WorkVerdict::RejectWork, false)?;
                            b.cmd(RecoveryCommand::Withdraw {
                                agent: 1,
                                case_id: 0,
                            })?;
                            b.agent(
                                1,
                                TrustCommand::Direct {
                                    command: DirectCommand::Dispute {
                                        agreement_id: 0,
                                        client: 1,
                                        reason_digest: digest("raw-claim", 0, 1),
                                    },
                                },
                            )?;
                        }
                        "DEADLINE_BOUNDARIES" => {
                            b.verdict(0, WorkVerdict::AcceptWork, false)?; // evidence period has not ended
                            b.tick += config.evidence_ticks;
                            b.verdict(0, WorkVerdict::AcceptWork, false)?;
                            b.tick += config.appeal_ticks;
                            b.appeal(0, 0)?; // exact close, already final
                            b.tick += config.trust.maturity_ticks;
                            b.cmd(RecoveryCommand::Advance {})?;
                        }
                        _ => {
                            if name == "CONFLICTED_REVIEWERS" {
                                b.tick += config.evidence_ticks;
                                b.cmd(RecoveryCommand::PrimaryVerdict {
                                    reviewer: 0,
                                    case_id: 0,
                                    verdict: WorkVerdict::AcceptWork,
                                    binding: b.engine.binding(0)?,
                                    reason_digest: digest("conflict", 0, 0),
                                })?;
                            } else {
                                b.tick += config.evidence_ticks;
                            }
                            let reject = matches!(
                                name,
                                "COMPLAINT_UPHELD"
                                    | "APPEAL_OVERTURNS_REJECTION"
                                    | "APPEAL_UPHOLDS_COMPLAINT"
                            );
                            b.verdict(
                                0,
                                if reject {
                                    WorkVerdict::RejectWork
                                } else {
                                    WorkVerdict::AcceptWork
                                },
                                false,
                            )?;
                            if matches!(
                                name,
                                "APPEAL_OVERTURNS_REJECTION"
                                    | "APPEAL_UPHOLDS_COMPLAINT"
                                    | "APPEAL_TIMEOUT_UNRESOLVED"
                                    | "CONFLICTED_REVIEWERS"
                            ) {
                                b.tick += 1;
                                b.appeal(0, 0)?;
                                if name != "APPEAL_TIMEOUT_UNRESOLVED" {
                                    b.cmd(RecoveryCommand::SubmitEvidence {
                                        agent: 0,
                                        case_id: 0,
                                        evidence_digest: digest("appeal-evidence", 0, 0),
                                    })?;
                                    b.tick += config.evidence_ticks;
                                    if name == "CONFLICTED_REVIEWERS" {
                                        b.cmd(RecoveryCommand::AppellateVerdict {
                                            reviewer: 2,
                                            case_id: 0,
                                            verdict: WorkVerdict::AcceptWork,
                                            binding: b.engine.binding(0)?,
                                            reason_digest: digest("same-operator", 0, 0),
                                        })?;
                                    }
                                    b.verdict(
                                        0,
                                        if name == "APPEAL_UPHOLDS_COMPLAINT" {
                                            WorkVerdict::RejectWork
                                        } else {
                                            WorkVerdict::AcceptWork
                                        },
                                        true,
                                    )?;
                                    b.tick += config.trust.maturity_ticks;
                                    b.cmd(RecoveryCommand::Advance {})?;
                                }
                            } else if name == "STALE_ACCEPTANCE" {
                                b.tick += 1;
                                b.refund(&p, 1, 1000)?;
                            }
                        }
                    }
                }
            }
            cases.push(RecoveryCase {
                name: name.into(),
                run: b.done()?,
            });
        }
        let mut c = Self {
            schema_version: 1,
            model: "zoora-recovery-campaign/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            config,
            cases,
            fingerprint: String::new(),
        };
        c.fingerprint = c.hash()?;
        Ok(c)
    }
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE017_RECOVERY_CAMPAIGN_V1\0",
            &(
                self.schema_version,
                &self.model,
                &self.classification,
                &self.config,
                &self.cases,
            ),
        )
    }
    pub fn verify(&self) -> Result<()> {
        if self.fingerprint != self.hash()? || *self != Self::generate(self.config.clone())? {
            return Err(SimulationError::Replay(
                "recovery matrix or history differs",
            ));
        }
        for c in &self.cases {
            c.run.verify()?;
        }
        Ok(())
    }
    pub fn csv(&self) -> Result<String> {
        self.verify()?;
        let mut out=String::from("case,classification,review_case,contract,status,final_tick,returned_tick,payments_received,returns_received,net_transferred,worker,earned_credit_microunits,credit_denominator,active_contracts,dispute_hold,run_fingerprint,campaign_fingerprint\n");
        for c in &self.cases {
            for case in &c.run.cases {
                let a = c
                    .run
                    .trust
                    .direct
                    .agreements
                    .iter()
                    .find(|a| a.terms.agreement_id == case.contract_id)
                    .ok_or(SimulationError::Integrity("case agreement missing"))?;
                let work = c
                    .run
                    .trust
                    .contracts
                    .iter()
                    .find(|w| w.plan.id == case.contract_id)
                    .ok_or(SimulationError::Integrity("case work missing"))?;
                let status = serde_json::to_value(case.status)
                    .map_err(|_| SimulationError::Integrity("status encoding"))?;
                for s in &work.plan.shares {
                    let p = &c.run.trust.profiles[s.agent as usize];
                    out.push_str(&format!(
                        "{},SYNTHETIC,{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
                        c.name,
                        case.id,
                        case.contract_id,
                        status.as_str().unwrap_or("INVALID"),
                        case.final_tick.map(|x| x.to_string()).unwrap_or_default(),
                        case.returned_tick
                            .map(|x| x.to_string())
                            .unwrap_or_default(),
                        a.payments_received,
                        a.voluntary_refunds_received,
                        a.net_transferred(),
                        s.agent,
                        p.earned_credit_microunits,
                        CREDIT_SCALE,
                        p.active_contracts,
                        p.dispute_hold,
                        c.run.fingerprint,
                        self.fingerprint
                    ));
                }
            }
        }
        Ok(out)
    }
}
