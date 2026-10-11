//! Seeded scripted actors, not LLMs. Matched intentions survive admission failures without invented payments.
use crate::{
    allocation::fingerprint,
    community::*,
    direct::{DirectCommand, DirectMetrics, Receipt},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use zoora_agent_economy_simulator::{DeterministicRng, SimulationError, RNG_ALGORITHM};
type Result<T> = std::result::Result<T, SimulationError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Scenario {
    Balanced,
    SpamReservations,
    ProviderOffline,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkloadConfig {
    pub seed: u64,
    pub agents: usize,
    pub tasks: usize,
    pub max_pending_per_provider: usize,
    pub posts_per_agent_per_tick: usize,
}
impl WorkloadConfig {
    pub fn validate(&self) -> Result<()> {
        if !(4..=128).contains(&self.agents)
            || !(1..=500).contains(&self.tasks)
            || !(1..=32).contains(&self.max_pending_per_provider)
            || !(1..=10).contains(&self.posts_per_agent_per_tick)
        {
            return Err(SimulationError::Configuration(
                "invalid bounded community workload",
            ));
        }
        Ok(())
    }
    pub fn from_toml(text: &str) -> Result<Self> {
        let config: Self = toml::from_str(text)
            .map_err(|_| SimulationError::Configuration("invalid community workload TOML"))?;
        config.validate()?;
        Ok(config)
    }
    fn community(&self) -> CommunityConfig {
        CommunityConfig {
            agents: self.agents,
            max_pending_per_provider: self.max_pending_per_provider,
            posts_per_agent_per_tick: self.posts_per_agent_per_tick,
            ..CommunityConfig::default()
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IntendedOutcome {
    AcceptedDelivery,
    RefusedRefund,
    FullReturn,
    PartialReturn,
    MissingDelivery,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Intent {
    pub agreement_id: u64,
    pub provider: u64,
    pub client: u64,
    pub outcome: IntendedOutcome,
}
fn bounded_intents<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<Intent>, D::Error> {
    crate::bounded::vec::<D, Intent, 500>(d)
}
fn intents(config: &WorkloadConfig) -> Vec<Intent> {
    let mut rng = DeterministicRng::from_seed(config.seed);
    let providers = config.agents as u64 / 2;
    (0..config.tasks as u64)
        .map(|agreement_id| Intent {
            agreement_id,
            provider: rng.below(providers).expect("providers"),
            client: providers
                + rng
                    .below(config.agents as u64 - providers)
                    .expect("clients"),
            outcome: match rng.below(10000).expect("rate") {
                0..=5999 => IntendedOutcome::AcceptedDelivery,
                6000..=6999 => IntendedOutcome::RefusedRefund,
                7000..=7999 => IntendedOutcome::FullReturn,
                8000..=8999 => IntendedOutcome::PartialReturn,
                _ => IntendedOutcome::MissingDelivery,
            },
        })
        .collect()
}
fn agent(id: u64) -> Actor {
    Actor::Agent { agent_id: id }
}
fn workflow(e: &mut CommunityEngine, tick: u64, id: u64, command: DirectCommand) -> Result<()> {
    e.record(tick, agent(id), CommunityCommand::Workflow { command })
}
fn run(
    config: &WorkloadConfig,
    scenario: Scenario,
    workload: &[Intent],
) -> Result<CommunityReport> {
    let mut e = CommunityEngine::new(config.community())?;
    let providers = config.agents as u64 / 2;
    for id in 0..config.agents as u64 {
        e.record(
            0,
            Actor::Operator {
                operator_id: id / 2,
            },
            CommunityCommand::Register {
                registration: Registration {
                    agent_id: id,
                    operator_id: id / 2,
                    handle: format!("agent_{id}"),
                    wallet_label: format!("synthetic-wallet-{id}"),
                    capabilities: vec![if id % 2 == 0 {
                        "code".into()
                    } else {
                        "research".into()
                    }],
                },
            },
        )?;
    }
    for id in 0..providers {
        e.record(
            1,
            agent(id),
            CommunityCommand::CreateProject {
                project_id: id,
                title: format!("Creative project {id}"),
                summary: "Scripted research/code deliverables. Quality has not been assessed."
                    .into(),
            },
        )?;
        e.record(
            1,
            agent(id),
            CommunityCommand::AddContributor {
                project_id: id,
                agent_id: providers,
            },
        )?;
        e.record(
            1,
            agent(id),
            CommunityCommand::PublishOffer {
                offer_id: id,
                project_id: id,
                title: format!("Service offer {id}"),
                criteria_digest: "c".repeat(64),
                amount: 100,
                delivery_ticks: 6,
            },
        )?;
        e.record(1,agent(id),CommunityCommand::Post{post_id:id,project_id:Some(id),reply_to:None,body:"Synthetic offer published; no claim of useful output or independent agent identity.".into()})?;
    }
    e.record(
        2,
        Actor::Operator { operator_id: 0 },
        CommunityCommand::Rename {
            agent_id: 0,
            handle: "agent_zero".into(),
        },
    )?;
    e.record(
        2,
        agent(providers),
        CommunityCommand::PublishArtifact {
            project_id: 0,
            digest: "b".repeat(64),
        },
    )?;
    e.record(
        2,
        agent(providers),
        CommunityCommand::Post {
            post_id: 1000,
            project_id: Some(0),
            reply_to: Some(0),
            body:
                "Synthetic contributor update linked to the project; digest is not quality proof."
                    .into(),
        },
    )?;
    if scenario == Scenario::SpamReservations {
        for n in 0..config.posts_per_agent_per_tick + 2 {
            e.record(
                2,
                agent(providers),
                CommunityCommand::Post {
                    post_id: 2000 + n as u64,
                    project_id: None,
                    reply_to: None,
                    body: "Injected spam fixture.".into(),
                },
            )?;
        }
        for provider in 0..providers {
            for n in 0..config.max_pending_per_provider {
                e.record(
                    3,
                    agent(providers),
                    CommunityCommand::AcceptOffer {
                        offer_id: provider,
                        agreement_id: 10_000 + provider * 32 + n as u64,
                    },
                )?;
            }
        }
    } else if scenario == Scenario::ProviderOffline {
        for id in (0..providers).step_by(2) {
            e.record(
                3,
                Actor::Operator {
                    operator_id: id / 2,
                },
                CommunityCommand::SetActive {
                    agent_id: id,
                    active: false,
                },
            )?;
        }
    }
    for intent in workload {
        e.record(
            3,
            agent(intent.client),
            CommunityCommand::AcceptOffer {
                offer_id: intent.provider,
                agreement_id: intent.agreement_id,
            },
        )?;
    }
    let admitted: Vec<_> = workload
        .iter()
        .filter(|i| e.agreement(i.agreement_id).is_some())
        .cloned()
        .collect();
    for i in &admitted {
        workflow(
            &mut e,
            4,
            i.client,
            DirectCommand::PaymentReceipt {
                receipt: Receipt::synthetic(i.agreement_id, 0, i.client, i.provider, 100, 4),
            },
        )?;
    }
    for i in &admitted {
        match i.outcome {
            IntendedOutcome::AcceptedDelivery => workflow(
                &mut e,
                5,
                i.provider,
                DirectCommand::Deliver {
                    agreement_id: i.agreement_id,
                    provider: i.provider,
                    artifact_digest: "a".repeat(64),
                },
            )?,
            IntendedOutcome::RefusedRefund
            | IntendedOutcome::FullReturn
            | IntendedOutcome::PartialReturn => workflow(
                &mut e,
                5,
                i.client,
                DirectCommand::Dispute {
                    agreement_id: i.agreement_id,
                    client: i.client,
                    reason_digest: "d".repeat(64),
                },
            )?,
            IntendedOutcome::MissingDelivery => {}
        }
    }
    for i in &admitted {
        match i.outcome {
            IntendedOutcome::AcceptedDelivery => workflow(
                &mut e,
                6,
                i.client,
                DirectCommand::Acknowledge {
                    agreement_id: i.agreement_id,
                    client: i.client,
                },
            )?,
            IntendedOutcome::RefusedRefund
            | IntendedOutcome::FullReturn
            | IntendedOutcome::PartialReturn => workflow(
                &mut e,
                6,
                i.client,
                DirectCommand::RequestRefund {
                    agreement_id: i.agreement_id,
                    client: i.client,
                    amount: 100,
                    reason_digest: "f".repeat(64),
                },
            )?,
            IntendedOutcome::MissingDelivery => {}
        }
    }
    for i in &admitted {
        match i.outcome {
            IntendedOutcome::RefusedRefund => workflow(
                &mut e,
                7,
                i.provider,
                DirectCommand::DeclineRefund {
                    agreement_id: i.agreement_id,
                    provider: i.provider,
                },
            )?,
            IntendedOutcome::FullReturn | IntendedOutcome::PartialReturn => workflow(
                &mut e,
                7,
                i.provider,
                DirectCommand::VoluntaryRefundReceipt {
                    receipt: Receipt::synthetic(
                        i.agreement_id,
                        1,
                        i.provider,
                        i.client,
                        if i.outcome == IntendedOutcome::FullReturn {
                            100
                        } else {
                            50
                        },
                        7,
                    ),
                },
            )?,
            _ => {}
        }
    }
    e.finish()?;
    CommunityReport::from_engine(&e)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunReport {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub rng: String,
    pub config: WorkloadConfig,
    pub scenario: Scenario,
    #[serde(deserialize_with = "bounded_intents")]
    pub intents: Vec<Intent>,
    pub intentions_fingerprint: String,
    pub community: CommunityReport,
    pub fingerprint: String,
}
impl RunReport {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE005_RUN_V1\0",
            &(
                self.schema_version,
                &self.model,
                &self.classification,
                &self.rng,
                &self.config,
                &self.scenario,
                &self.intents,
                &self.intentions_fingerprint,
                &self.community,
            ),
        )
    }
    pub fn generate(config: WorkloadConfig, scenario: Scenario) -> Result<Self> {
        config.validate()?;
        let intents = intents(&config);
        let community = run(&config, scenario, &intents)?;
        let intentions_fingerprint = fingerprint(b"ZOORA_AE005_INTENTIONS_V1\0", &intents)?;
        let mut r = Self {
            schema_version: 1,
            model: "zoora-community-run/0.1.0".into(),
            classification: "SYNTHETIC".into(),
            rng: RNG_ALGORITHM.into(),
            config,
            scenario,
            intents,
            intentions_fingerprint,
            community,
            fingerprint: String::new(),
        };
        r.fingerprint = r.hash()?;
        Ok(r)
    }
    pub fn verify(&self) -> Result<()> {
        self.config.validate()?;
        if self.schema_version != 1
            || self.model != "zoora-community-run/0.1.0"
            || self.classification != "SYNTHETIC"
            || self.rng != RNG_ALGORITHM
            || self.fingerprint != self.hash()?
        {
            return Err(SimulationError::Replay(
                "community run identity or hash differs",
            ));
        }
        self.community.verify()?;
        if Self::generate(self.config.clone(), self.scenario)? != *self {
            return Err(SimulationError::Replay(
                "scripted community run regeneration differs",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BatchConfig {
    pub workload: WorkloadConfig,
    #[serde(deserialize_with = "bounded_seeds")]
    pub seeds: Vec<u64>,
    #[serde(deserialize_with = "bounded_scenarios")]
    pub scenarios: Vec<Scenario>,
}
fn bounded_seeds<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<u64>, D::Error> {
    crate::bounded::vec::<D, u64, 12>(d)
}
fn bounded_scenarios<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<Scenario>, D::Error> {
    crate::bounded::vec::<D, Scenario, 3>(d)
}
impl BatchConfig {
    pub fn validate(&self) -> Result<()> {
        self.workload.validate()?;
        if self.seeds.is_empty()
            || self.seeds.len() > 12
            || self.seeds.windows(2).any(|s| s[0] >= s[1])
            || self.scenarios.is_empty()
            || self.scenarios.len() > 3
            || self.scenarios.iter().collect::<BTreeSet<_>>().len() != self.scenarios.len()
        {
            return Err(SimulationError::Configuration(
                "batch needs distinct scenarios and sorted distinct bounded seeds",
            ));
        }
        Ok(())
    }
    pub fn from_toml(text: &str) -> Result<Self> {
        let c: Self = toml::from_str(text)
            .map_err(|_| SimulationError::Configuration("invalid community batch TOML"))?;
        c.validate()?;
        Ok(c)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunSummary {
    pub seed: u64,
    pub scenario: Scenario,
    pub intentions_fingerprint: String,
    pub report_fingerprint: String,
    pub community_fingerprint: String,
    pub metrics: CommunityMetrics,
    pub direct_metrics: DirectMetrics,
    pub acknowledged_delivery_bps: Option<u64>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BatchReport {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub rng: String,
    pub config: BatchConfig,
    #[serde(deserialize_with = "bounded_runs")]
    pub runs: Vec<RunSummary>,
    pub fingerprint: String,
}
fn bounded_runs<'de, D: serde::de::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<RunSummary>, D::Error> {
    crate::bounded::vec::<D, RunSummary, 36>(d)
}
impl BatchReport {
    pub fn hash(&self) -> Result<String> {
        fingerprint(
            b"ZOORA_AE005_BATCH_V1\0",
            &(
                self.schema_version,
                &self.model,
                &self.classification,
                &self.rng,
                &self.config,
                &self.runs,
            ),
        )
    }
    pub fn generate(config: BatchConfig) -> Result<Self> {
        config.validate()?;
        let mut runs = Vec::new();
        for seed in &config.seeds {
            for scenario in &config.scenarios {
                let mut c = config.workload.clone();
                c.seed = *seed;
                let r = RunReport::generate(c, *scenario)?;
                let m = &r.community.metrics;
                let acknowledged_delivery_bps =
                    (m.acknowledged_deliveries * 10000).checked_div(m.accepted_orders);
                runs.push(RunSummary {
                    seed: *seed,
                    scenario: *scenario,
                    intentions_fingerprint: r.intentions_fingerprint,
                    report_fingerprint: r.fingerprint,
                    community_fingerprint: r.community.fingerprint,
                    metrics: r.community.metrics,
                    direct_metrics: r.community.direct.metrics,
                    acknowledged_delivery_bps,
                });
            }
        }
        let mut r = Self {
            schema_version: 1,
            model: "zoora-community-batch/0.1.0".into(),
            classification: "SYNTHETIC".into(),
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
        if self.schema_version != 1
            || self.model != "zoora-community-batch/0.1.0"
            || self.classification != "SYNTHETIC"
            || self.rng != RNG_ALGORITHM
            || self.fingerprint != self.hash()?
            || Self::generate(self.config.clone())? != *self
        {
            return Err(SimulationError::Replay(
                "community batch regeneration differs",
            ));
        }
        Ok(())
    }
}
