//! Deterministic, adversarial policy demonstrations, not forecasts or measured
//! autonomous-agent competence. Every action and failed attempt is retained.
use crate::{
    allocation::fingerprint,
    direct::{DirectCommand, Receipt},
    trust::*,
};
use serde::{Deserialize, Serialize};
use zoora_agent_economy_simulator::SimulationError;
type Result<T> = std::result::Result<T, SimulationError>;

pub const CASES: [&str; 15] = [
    "STARTER_LIMITS",
    "SMALL_TASKS",
    "ONE_LARGE_TASK",
    "BALANCED_HISTORY",
    "ESTABLISHED_HISTORY",
    "ROOT_TASK_SPLITTING",
    "HIGH_PAYMENT_VOLUME",
    "RELATED_CUSTOMER",
    "COLLECTIVE_ATTRIBUTION",
    "PREMATURE_CREDIT",
    "DISPUTE_AFTER_CREDIT",
    "REFUND_AFTER_CREDIT",
    "VERIFICATION_REVOKED",
    "WALLET_ROTATION",
    "REUSED_ARTIFACT",
];
fn digest(domain: &str, id: u64, agent: u64) -> String {
    fingerprint(b"ZOORA_AE016_DEMO_REFERENCE_V1\0", &(domain, id, agent)).expect("fixed fixture")
}
struct Builder {
    config: TrustConfig,
    tick: u64,
    next: u64,
    actions: Vec<TrustAction>,
}
impl Builder {
    fn new(config: &TrustConfig, approved: bool) -> Self {
        let mut b = Self {
            config: config.clone(),
            tick: 0,
            next: 0,
            actions: vec![],
        };
        for agent in [1, 2, 6] {
            b.review(agent, true);
        }
        if approved {
            b.review(0, true);
        }
        b.project(0, 1000);
        b
    }
    fn act(&mut self, actor: TrustActor, command: TrustCommand) {
        self.actions.push(TrustAction {
            tick: self.tick,
            actor,
            command,
        });
    }
    fn agent(&mut self, agent: u64, command: TrustCommand) {
        self.act(TrustActor::Agent { agent }, command);
    }
    fn authority(&mut self, command: TrustCommand) {
        self.act(TrustActor::ReviewFixture {}, command);
    }
    fn review(&mut self, agent: u64, approved: bool) {
        self.authority(TrustCommand::ReviewAgent {
            agent,
            approved,
            evidence_digest: digest("identity-review", agent, u64::from(approved)),
        });
    }
    fn project(&mut self, id: u64, budget: u64) {
        self.authority(TrustCommand::DefineProject {
            id,
            work_budget: budget,
            scope_digest: digest("scope", id, 0),
        });
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
            deadline: self.config.ticks - 2,
            criteria_digest: digest("criteria", id, 0),
            shares: vec![WorkShare {
                agent: 0,
                basis_points: 10_000,
            }],
        }
    }
    fn open(&mut self, p: &ContractPlan) {
        let hash = p.digest().expect("fixed fixture");
        for agent in std::iter::once(p.client).chain(p.shares.iter().map(|s| s.agent)) {
            self.agent(
                agent,
                TrustCommand::Consent {
                    plan_digest: hash.clone(),
                },
            );
        }
        self.agent(p.lead, TrustCommand::OpenContract { plan: p.clone() });
    }
    fn fund(&mut self, p: &ContractPlan) {
        self.tick += 1;
        self.act(
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
        );
    }
    fn deliver(&mut self, p: &ContractPlan, reused: Option<String>) {
        self.tick += 1;
        for s in &p.shares {
            self.agent(
                s.agent,
                TrustCommand::Contribute {
                    contract_id: p.id,
                    artifact_digest: reused
                        .clone()
                        .unwrap_or_else(|| digest("artifact", p.id, s.agent)),
                },
            );
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
        );
    }
    fn acknowledge(&mut self, p: &ContractPlan) {
        self.tick += 1;
        self.agent(
            p.client,
            TrustCommand::Direct {
                command: DirectCommand::Acknowledge {
                    agreement_id: p.id,
                    client: p.client,
                },
            },
        );
    }
    fn confirm(&mut self, p: &ContractPlan) {
        self.authority(TrustCommand::ConfirmWork {
            contract_id: p.id,
            review_digest: digest("work-review", p.id, 0),
        });
    }
    fn complete(&mut self, p: &ContractPlan, reused: Option<String>) {
        self.open(p);
        self.fund(p);
        self.deliver(p, reused);
        self.acknowledge(p);
        self.tick += self.config.maturity_ticks;
        self.confirm(p);
        self.tick += 1;
    }
    fn history(&mut self, n: u64, units: u64, one_customer: bool) {
        for i in 0..n {
            let p = self.plan(if one_customer { 1 } else { 1 + i % 2 }, units);
            self.complete(&p, None);
        }
    }
    fn refund(&mut self, p: &ContractPlan, amount: u64, reference: u64) {
        self.act(
            TrustActor::ReceiptFixture {},
            TrustCommand::Direct {
                command: DirectCommand::VoluntaryRefundReceipt {
                    receipt: Receipt::synthetic(
                        p.id, reference, p.lead, p.client, amount, self.tick,
                    ),
                },
            },
        );
    }
    fn done(self) -> Result<TrustReport> {
        TrustReport::generate(TrustInput {
            config: self.config,
            actions: self.actions,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustCase {
    pub name: String,
    pub run: TrustReport,
}
fn bounded_cases<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<TrustCase>, D::Error> {
    crate::bounded::vec::<D, TrustCase, 15>(d)
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustCampaign {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub config: TrustConfig,
    #[serde(deserialize_with = "bounded_cases")]
    pub cases: Vec<TrustCase>,
    pub fingerprint: String,
}
impl TrustCampaign {
    pub fn generate(config: TrustConfig) -> Result<Self> {
        config.validate()?;
        let mut cases = vec![];
        for name in CASES {
            let mut b = Builder::new(&config, name != "ESTABLISHED_HISTORY");
            match name {
                "STARTER_LIMITS" => {
                    for (id, kind) in [
                        (0, GroupKind::Development),
                        (1, GroupKind::Development),
                        (2, GroupKind::CommunityFunded),
                        (3, GroupKind::CommunityFunded),
                    ] {
                        b.agent(0, TrustCommand::CreateGroup { id, kind });
                    }
                    let p = b.plan(1, 10);
                    b.open(&p);
                    b.fund(&p);
                    let p = b.plan(2, 10);
                    b.open(&p);
                }
                "SMALL_TASKS" => {
                    b.history(10, 10, false);
                }
                "ONE_LARGE_TASK" => {
                    b.history(1, 100, true);
                }
                "BALANCED_HISTORY" => {
                    b.history(2, 50, false);
                    for _ in 0..2 {
                        let p = b.plan(1, 10);
                        b.open(&p);
                        b.fund(&p);
                    }
                    let p = b.plan(2, 10);
                    b.open(&p);
                }
                "ESTABLISHED_HISTORY" => {
                    b.history(5, 100, false);
                    // Experience can accumulate before review; approval is a separate gate.
                    b.review(0, true);
                    for _ in 0..4 {
                        let p = b.plan(1, 10);
                        b.open(&p);
                        b.fund(&p);
                    }
                    let p = b.plan(2, 10);
                    b.open(&p);
                }
                "ROOT_TASK_SPLITTING" => {
                    b.project(1, 100);
                    for i in 0..10 {
                        let mut p = b.plan(1 + i % 2, 10);
                        p.project = 1;
                        b.complete(&p, None);
                    }
                    let mut p = b.plan(2, 1);
                    p.project = 1;
                    b.open(&p);
                }
                "HIGH_PAYMENT_VOLUME" => {
                    for client in [1, 2] {
                        let mut p = b.plan(client, 1);
                        p.payment_units = u64::MAX;
                        b.complete(&p, None);
                    }
                }
                "RELATED_CUSTOMER" => {
                    b.review(5, true);
                    let p = b.plan(5, 500);
                    b.complete(&p, None);
                    // New client IDs with the same declared operator count once.
                    for client in [1, 6] {
                        let p = b.plan(client, 100);
                        b.complete(&p, None);
                    }
                }
                "COLLECTIVE_ATTRIBUTION" => {
                    b.review(3, true);
                    b.agent(
                        0,
                        TrustCommand::CreateGroup {
                            id: 0,
                            kind: GroupKind::Development,
                        },
                    );
                    b.agent(3, TrustCommand::JoinGroup { id: 0 });
                    for client in [1, 2] {
                        let mut p = b.plan(client, 101);
                        p.group = Some(0);
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
                        b.open(&p);
                        b.fund(&p);
                        let mut q = b.plan(2, 10);
                        q.lead = 3;
                        q.shares = vec![WorkShare {
                            agent: 3,
                            basis_points: 10_000,
                        }];
                        b.open(&q);
                        b.agent(3, TrustCommand::LeaveGroup { id: 0 });
                        b.deliver(&p, None);
                        b.acknowledge(&p);
                        b.tick += config.maturity_ticks;
                        b.confirm(&p);
                        b.tick += 1;
                    }
                }
                "PREMATURE_CREDIT" => {
                    let p = b.plan(1, 100);
                    b.open(&p);
                    b.fund(&p);
                    b.deliver(&p, None);
                    b.confirm(&p);
                    b.acknowledge(&p);
                    b.confirm(&p);
                    b.tick += config.maturity_ticks;
                    b.confirm(&p);
                }
                "DISPUTE_AFTER_CREDIT" => {
                    b.history(2, 50, false);
                    b.agent(
                        1,
                        TrustCommand::Direct {
                            command: DirectCommand::Dispute {
                                agreement_id: 0,
                                client: 1,
                                reason_digest: digest("dispute", 0, 1),
                            },
                        },
                    );
                    let p = b.plan(2, 10);
                    b.open(&p);
                }
                "REFUND_AFTER_CREDIT" => {
                    let p = b.plan(1, 50);
                    b.complete(&p, None);
                    let q = b.plan(2, 50);
                    b.complete(&q, None);
                    b.refund(&p, 30, 1000);
                    b.refund(&p, 70, 1001);
                }
                "VERIFICATION_REVOKED" => {
                    b.history(5, 100, false);
                    for _ in 0..4 {
                        let p = b.plan(1, 10);
                        b.open(&p);
                        b.fund(&p);
                    }
                    b.review(0, false);
                    let p = b.plan(2, 10);
                    b.open(&p);
                }
                "WALLET_ROTATION" => {
                    for agent in [0, 5, 7] {
                        let mut p = b.plan(1, 10);
                        p.lead = agent;
                        p.shares = vec![WorkShare {
                            agent,
                            basis_points: 10_000,
                        }];
                        b.open(&p);
                        b.fund(&p);
                    }
                }
                "REUSED_ARTIFACT" => {
                    let p = b.plan(1, 50);
                    b.complete(&p, None);
                    let q = b.plan(2, 50);
                    b.complete(&q, Some(digest("artifact", p.id, 0)));
                }
                _ => unreachable!(),
            }
            cases.push(TrustCase {
                name: name.into(),
                run: b.done()?,
            });
        }
        let mut c = Self {
            schema_version: 1,
            model: "zoora-trust-campaign/0.1.0".into(),
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
            b"ZOORA_AE016_TRUST_CAMPAIGN_V1\0",
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
                "trust scenario matrix or history differs",
            ));
        }
        for c in &self.cases {
            c.run.verify()?;
        }
        Ok(())
    }
    pub fn csv(&self) -> Result<String> {
        self.verify()?;
        let mut out=String::from("case,classification,agent,review_fixture_approved,tier,earned_credit_microunits,credit_denominator,confirmed_contracts,customer_operators,active_contracts,development_memberships,community_funded_memberships,dispute_hold,work_limit,development_limit,community_funded_limit,run_fingerprint,campaign_fingerprint\n");
        for c in &self.cases {
            for p in &c.run.profiles {
                out.push_str(&format!(
                    "{},SYNTHETIC,{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
                    c.name,
                    p.agent,
                    p.review_fixture_approved,
                    p.tier,
                    p.earned_credit_microunits,
                    CREDIT_SCALE,
                    p.confirmed_contracts,
                    p.customer_operators,
                    p.active_contracts,
                    p.development_memberships,
                    p.community_funded_memberships,
                    p.dispute_hold,
                    p.limits.work,
                    p.limits.development,
                    p.limits.community_funded,
                    c.run.fingerprint,
                    self.fingerprint
                ));
            }
        }
        Ok(out)
    }
}
