//! Matched declared-owner admission experiments. All actors and receipts are fixtures.
use crate::{
    allocation::fingerprint,
    direct::{DirectCommand, Receipt},
    ownership::*,
    recovery::*,
    trust::*,
};
use serde::{Deserialize, Serialize};
use zoora_agent_economy_simulator::SimulationError;
type Result<T> = std::result::Result<T, SimulationError>;
pub const CASES: [&str; 13] = [
    "DECLARED_WALLET_ROTATION",
    "LARGE_SINGLE_OBLIGATION",
    "TIERED_OWNER_CAPACITY",
    "UNPAID_EXPIRY_RETRY",
    "PARTIAL_AND_FULL_RETURN",
    "LATE_RECEIPT_OVERAGE",
    "DISPUTE_HOLD_PROPAGATION",
    "COLLECTIVE_SAME_OWNER",
    "COLLECTIVE_DIFFERENT_OWNERS",
    "OWNER_DOWNGRADE",
    "UNVERIFIED_ALIAS",
    "LARGE_EXACT_TOTALS",
    "HIDDEN_COMMON_CONTROL",
];
fn digest(label: &str, id: u64, agent: u64) -> String {
    fingerprint(b"ZOORA_AE018_DEMO_REFERENCE_V1\0", &(label, id, agent)).expect("fixed fixture")
}
struct Builder {
    engine: OwnerEngine,
    config: OwnerConfig,
    tick: u64,
    next: u64,
}
impl Builder {
    fn new(c: &OwnerConfig) -> Result<Self> {
        let mut b = Self {
            engine: OwnerEngine::new(c.clone(), OwnerPolicy::AgentOnly)?,
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
            deadline: self.config.recovery.trust.ticks - 2,
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
        self.tick += self.config.recovery.trust.maturity_ticks;
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
    fn history(&mut self, n: u64, units: u64) -> Result<Vec<ContractPlan>> {
        let mut plans = vec![];
        for i in 0..n {
            let p = self.plan(1 + i % 2, units);
            self.complete(&p)?;
            plans.push(p);
        }
        Ok(plans)
    }
    fn done(self) -> Result<OwnerReport> {
        self.engine.finish()
    }
}
fn solo(mut p: ContractPlan, lead: u64) -> ContractPlan {
    p.lead = lead;
    p.shares = vec![WorkShare {
        agent: lead,
        basis_points: 10000,
    }];
    p
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerCase {
    pub name: String,
    pub config: OwnerConfig,
    #[serde(deserialize_with = "case_actions")]
    pub actions: Vec<RecoveryAction>,
    #[serde(deserialize_with = "runs")]
    pub runs: Vec<OwnerReport>,
}
fn case_actions<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<RecoveryAction>, D::Error> {
    crate::bounded::vec::<D, RecoveryAction, MAX_OWNER_ACTIONS>(d)
}
fn runs<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<OwnerReport>, D::Error> {
    crate::bounded::vec::<D, OwnerReport, 3>(d)
}
fn cases<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<OwnerCase>, D::Error> {
    crate::bounded::vec::<D, OwnerCase, 13>(d)
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerCampaign {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub config: OwnerConfig,
    #[serde(deserialize_with = "cases")]
    pub cases: Vec<OwnerCase>,
    pub fingerprint: String,
}
impl OwnerCampaign {
    pub fn generate(config: OwnerConfig) -> Result<Self> {
        config.validate()?;
        let mut cases = vec![];
        for name in CASES {
            let mut c = config.clone();
            if name == "LARGE_EXACT_TOTALS" {
                c.payment_caps = [u64::MAX; 3];
            }
            if name == "HIDDEN_COMMON_CONTROL" {
                c.recovery.trust.operators[5] = 50;
                c.recovery.trust.operators[7] = 70;
            }
            let mut b = Builder::new(&c)?;
            match name {
                "DECLARED_WALLET_ROTATION" | "HIDDEN_COMMON_CONTROL" => {
                    for lead in [0, 5, 7] {
                        let p = solo(b.plan(1, 10), lead);
                        b.open(&p)?;
                        b.fund(&p)?;
                    }
                }
                "LARGE_SINGLE_OBLIGATION" => {
                    let mut p = b.plan(1, 10);
                    p.payment_units = 101;
                    b.open(&p)?;
                    b.fund(&p)?;
                }
                "TIERED_OWNER_CAPACITY" => {
                    b.history(2, 50)?;
                    for lead in [5, 7, 0] {
                        let p = solo(b.plan(1, 1), lead);
                        b.open(&p)?;
                    }
                }
                "UNPAID_EXPIRY_RETRY" => {
                    let mut p = b.plan(1, 10);
                    p.deadline = 10;
                    b.open(&p)?;
                    let q = solo(b.plan(2, 10), 5);
                    b.open(&q)?;
                    b.tick = 10;
                    b.open(&q)?;
                }
                "PARTIAL_AND_FULL_RETURN" => {
                    let p = b.plan(1, 10);
                    b.open(&p)?;
                    b.fund(&p)?;
                    b.tick = 2;
                    b.refund(&p, 30, 1000)?;
                    let q = solo(b.plan(2, 10), 5);
                    b.open(&q)?;
                    b.tick = 3;
                    b.refund(&p, 70, 1001)?;
                    b.open(&q)?;
                    b.fund(&q)?;
                }
                "LATE_RECEIPT_OVERAGE" => {
                    let mut p = b.plan(1, 10);
                    p.deadline = 5;
                    b.open(&p)?;
                    b.tick = 5;
                    let q = solo(b.plan(2, 10), 5);
                    b.open(&q)?;
                    b.fund(&q)?;
                    b.fund(&p)?;
                    let r = solo(b.plan(1, 10), 7);
                    b.open(&r)?;
                }
                "DISPUTE_HOLD_PROPAGATION" => {
                    let plans = b.history(2, 50)?;
                    let p = &plans[1];
                    b.open_case(p, CaseKind::Complaint)?;
                    b.agent(
                        5,
                        TrustCommand::CreateGroup {
                            id: 9,
                            kind: GroupKind::Development,
                        },
                    )?;
                    b.tick += c.recovery.evidence_ticks;
                    b.verdict(0, WorkVerdict::AcceptWork, false)?;
                    b.tick += c.recovery.appeal_ticks + c.recovery.trust.maturity_ticks;
                    b.cmd(RecoveryCommand::Advance {})?;
                    b.agent(
                        5,
                        TrustCommand::CreateGroup {
                            id: 9,
                            kind: GroupKind::Development,
                        },
                    )?;
                }
                "COLLECTIVE_SAME_OWNER" | "COLLECTIVE_DIFFERENT_OWNERS" => {
                    let peer = if name == "COLLECTIVE_SAME_OWNER" {
                        5
                    } else {
                        3
                    };
                    b.agent(
                        0,
                        TrustCommand::CreateGroup {
                            id: 0,
                            kind: GroupKind::Development,
                        },
                    )?;
                    b.agent(peer, TrustCommand::JoinGroup { id: 0 })?;
                    let mut p = b.plan(1, 101);
                    p.group = Some(0);
                    p.shares = vec![
                        WorkShare {
                            agent: 0,
                            basis_points: 6000,
                        },
                        WorkShare {
                            agent: peer,
                            basis_points: 4000,
                        },
                    ];
                    b.open(&p)?;
                    b.fund(&p)?;
                    let q = solo(b.plan(2, 1), if peer == 5 { 7 } else { 4 });
                    b.open(&q)?;
                    if peer == 5 {
                        b.deliver(&p)?;
                        b.ack(&p)?;
                        b.tick += c.recovery.trust.maturity_ticks;
                        b.confirm(&p)?;
                    } else {
                        b.fund(&q)?;
                    }
                }
                "OWNER_DOWNGRADE" => {
                    b.history(5, 100)?;
                    for lead in [0, 0, 5, 7] {
                        let p = solo(b.plan(1, 1), lead);
                        b.open(&p)?;
                        b.fund(&p)?;
                    }
                    let p = b.plan(2, 1);
                    b.open(&p)?;
                    b.trust(
                        TrustActor::ReviewFixture {},
                        TrustCommand::ReviewAgent {
                            agent: 0,
                            approved: false,
                            evidence_digest: digest("revocation", 0, 0),
                        },
                    )?;
                    let p = b.plan(2, 1);
                    b.open(&p)?;
                    b.agent(
                        5,
                        TrustCommand::CreateGroup {
                            id: 10,
                            kind: GroupKind::Development,
                        },
                    )?;
                }
                "UNVERIFIED_ALIAS" => {
                    b.history(2, 50)?;
                    for lead in [5, 5, 7] {
                        let p = solo(b.plan(1, 1), lead);
                        b.open(&p)?;
                    }
                }
                "LARGE_EXACT_TOTALS" => {
                    b.history(2, 50)?;
                    for lead in [0, 5] {
                        let mut p = solo(b.plan(1, 1), lead);
                        p.payment_units = u64::MAX;
                        b.open(&p)?;
                        b.fund(&p)?;
                    }
                }
                _ => unreachable!(),
            }
            let baseline = b.done()?;
            let actions = baseline.input.actions.clone();
            let mut runs = vec![baseline];
            for policy in [OwnerPolicy::OwnerCount, OwnerPolicy::OwnerRisk] {
                runs.push(OwnerReport::generate(OwnerInput {
                    config: c.clone(),
                    policy,
                    actions: actions.clone(),
                })?);
            }
            cases.push(OwnerCase {
                name: name.into(),
                config: c,
                actions,
                runs,
            });
        }
        let mut r = Self {
            schema_version: 1,
            model: "zoora-owner-risk-campaign/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            config,
            cases,
            fingerprint: String::new(),
        };
        r.fingerprint = r.hash()?;
        Ok(r)
    }
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE018_OWNER_CAMPAIGN_V1\0",
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
                "owner matrix, policies or matched actions differ",
            ));
        }
        for c in &self.cases {
            for r in &c.runs {
                r.verify()?;
            }
        }
        Ok(())
    }
    pub fn csv(&self) -> Result<String> {
        self.verify()?;
        let mut out=String::from("case,classification,policy,operator,agents,tier,limit_source_agent,active_agreements,work_limit,reserved_payment_units,payment_limit,active_assigned_net_units,active_lead_net_units,dispute_hold,over_work_limit,over_payment_limit,run_owner_rejections,run_delegated_rejections,run_agreements_opened,run_total_payments,run_total_returns,run_total_net,run_fingerprint,campaign_fingerprint\n");
        for c in &self.cases {
            for r in &c.runs {
                let policy = serde_json::to_value(r.input.policy)
                    .map_err(|_| SimulationError::Integrity("policy encoding"))?;
                for o in &r.owners {
                    out.push_str(&format!("{},SYNTHETIC,{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",c.name,policy.as_str().unwrap_or("INVALID"),o.operator,o.agents.iter().map(u64::to_string).collect::<Vec<_>>().join(";"),o.tier,o.limit_source_agent,o.active_agreements.len(),o.work_limit,o.reserved_payment_units,o.payment_limit,o.active_assigned_net_units,o.active_lead_net_units,o.dispute_hold,o.over_work_limit,o.over_payment_limit,r.metrics.owner_rejections,r.metrics.delegated_rejections,r.metrics.agreements_opened,r.metrics.payments_recorded,r.metrics.voluntary_returns_recorded,r.metrics.net_transferred,r.fingerprint,self.fingerprint));
                }
            }
        }
        Ok(out)
    }
}
